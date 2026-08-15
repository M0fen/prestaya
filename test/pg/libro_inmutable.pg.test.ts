// ─────────────────────────────────────────────────────────────────────────
//  0126 — LIBRO INMUTABLE a nivel base, contra Postgres REAL.
//  Verifica que los triggers de la migración hagan exactamente lo prometido:
//   · prestamos: términos congelados por la API, máquina de estados que solo
//     avanza, pagado_acum solo por vías de confianza, borrar vetado.
//   · pagos: des-anulación one-way (con escotilla explícita).
//   · clientes: token_acceso congelado para los roles de API.
//  Y — tan importante — que los flujos LEGÍTIMOS sigan andando: finalizar un
//  crédito, mantener pagado_acum desde el libro, reparar con la RPC 0119.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  withRollback,
  comoRol,
  esperaErrorPg,
  mkGestorConAuth,
  mkCliente,
  mkPrestamo,
  n,
} from "./db";

describe("0126 · prestamos congelado para la API", () => {
  it("un gestor NO puede cambiar cuota/días/monto por REST (P0403)", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const cliente = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cliente, cuotaDiaria: 500, totalDias: 24 });

      for (const set of ["cuota_diaria = 600", "total_dias = 40", "monto_prestado = 99999", "fecha_inicio = '2026-01-15'"]) {
        await comoRol(c, "authenticated", admin.authUserId, () =>
          esperaErrorPg(c, "P0403", () => c.query(`update prestamos set ${set} where id = $1`, [pid])),
      );
      }
      // Los términos siguen intactos.
      const r = await c.query("select cuota_diaria, total_dias from prestamos where id=$1", [pid]);
      expect(n(r.rows[0].cuota_diaria)).toBe(500);
      expect(r.rows[0].total_dias).toBe(24);
    });
  });

  it("pagado_acum NO se maquilla a mano, pero el LIBRO sí lo mueve", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const cliente = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cliente, cuotaDiaria: 500, totalDias: 24 });

      await comoRol(c, "authenticated", admin.authUserId, () =>
        esperaErrorPg(c, "P0403", () => c.query("update prestamos set pagado_acum = 999999 where id = $1", [pid])),
      );

      // El camino legítimo: un pago INSERT → el trigger 0063 (definer) suma solo.
      await c.query(
        "insert into pagos (prestamo_id, dia_credito, monto) values ($1, 1, 500)",
        [pid],
      );
      const r = await c.query("select pagado_acum from prestamos where id=$1", [pid]);
      expect(n(r.rows[0].pagado_acum)).toBe(500);
    });
  });

  it("la RPC de reparación (0119): el ADMIN logueado repara; el supervisor rebota en el guard", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const sup = await mkGestorConAuth(c, "supervisor");
      const cliente = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cliente, cuotaDiaria: 500, totalDias: 24 });
      await c.query("insert into pagos (prestamo_id, dia_credito, monto) values ($1, 1, 500)", [pid]);
      // Fabricamos drift como superusuario (vía de confianza, igual que un incidente real).
      await c.query("update prestamos set pagado_acum = 9999 where id=$1", [pid]);

      // ⚠️ Lo que este test cazó (15-08): la 0142 había revocado EXECUTE a
      // authenticated, y como el guard interno exige el JWT de un admin, NADIE
      // podía llamarla — la herramienta de reparación de INV1 quedó muerta sin
      // aviso. La 0145 devuelve el grant: el guard interno ES la defensa.
      await comoRol(c, "authenticated", sup.authUserId, () =>
        esperaErrorPg(c, "P0001", () => c.query("select app_reparar_pagado_acum($1)", [pid])),
      );
      const rep = await comoRol(c, "authenticated", admin.authUserId, () =>
        c.query("select app_reparar_pagado_acum($1) as reparados", [pid]),
      );
      expect(rep.rows[0].reparados).toBe(1);
      const r = await c.query("select pagado_acum from prestamos where id=$1", [pid]);
      expect(n(r.rows[0].pagado_acum)).toBe(500);
    });
  });

  it("estado: avanza (activo→finalizado ✓) pero NO se resucita por la API", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const cliente = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cliente, cuotaDiaria: 500, totalDias: 24 });

      // Avanzar: permitido (es lo que hace la renovación por sesión).
      await comoRol(c, "authenticated", admin.authUserId, () =>
        c.query("update prestamos set estado='finalizado', finalizado_en=now() where id=$1", [pid]),
      );
      const r1 = await c.query("select estado from prestamos where id=$1", [pid]);
      expect(r1.rows[0].estado).toBe("finalizado");

      // Resucitar por la API: vetado.
      await comoRol(c, "authenticated", admin.authUserId, () =>
        esperaErrorPg(c, "P0403", () => c.query("update prestamos set estado='activo', finalizado_en=null where id=$1", [pid])),
      );

      // La COMPENSACIÓN de la renovación va por service_role: permitida.
      await comoRol(c, "service_role", null, () =>
        c.query("update prestamos set estado='activo', finalizado_en=null where id=$1", [pid]),
      );
      const r2 = await c.query("select estado from prestamos where id=$1", [pid]);
      expect(r2.rows[0].estado).toBe("activo");
    });
  });

  it("finalizado_en no se edita suelto (solo junto con el estado)", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const cliente = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cliente, cuotaDiaria: 500, totalDias: 24 });
      await comoRol(c, "authenticated", admin.authUserId, () =>
        esperaErrorPg(c, "P0403", () => c.query("update prestamos set finalizado_en = now() where id=$1", [pid])),
      );
    });
  });

  it("cobrador_id (la ruta) SIGUE siendo editable por el gestor", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const otro = await mkGestorConAuth(c, "admin");
      const cliente = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cliente, cuotaDiaria: 500, totalDias: 24 });
      await comoRol(c, "authenticated", admin.authUserId, () =>
        c.query("update prestamos set cobrador_id = $2 where id=$1", [pid, otro.id]),
      );
      const r = await c.query("select cobrador_id from prestamos where id=$1", [pid]);
      expect(r.rows[0].cobrador_id).toBe(otro.id);
    });
  });

  it("borrar un crédito está vetado sin escotilla; con escotilla, permitido", async () => {
    await withRollback(async (c) => {
      const cliente = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cliente, cuotaDiaria: 500, totalDias: 24 });

      // Sin escotilla: ni el superusuario puede (borrar historia jamás es rutina).
      await esperaErrorPg(c, "P0403", () =>
        c.query("delete from prestamos where id=$1", [pid]),
      );

      // Con la escotilla explícita, el borrado administrativo deliberado sale.
      await c.query("select set_config('app.permitir_borrado_prestamos', 'on', true)");
      await c.query("delete from prestamos where id=$1", [pid]);
      const r = await c.query("select count(*)::int as k from prestamos where id=$1", [pid]);
      expect(r.rows[0].k).toBe(0);
    });
  });
});

describe("0126 · pagos: des-anulación one-way", () => {
  it("anular funciona; revertir la anulación exige la escotilla", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const cliente = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cliente, cuotaDiaria: 500, totalDias: 24 });
      const pago = await c.query<{ id: string }>(
        "insert into pagos (prestamo_id, dia_credito, monto) values ($1, 1, 500) returning id",
        [pid],
      );
      const pagoId = pago.rows[0].id;

      // Anular (one-way permitido): completa (quién/cuándo/por qué — lo exige el
      // CHECK chk_pago_anulacion_completa, igual que hace flipAnulado en la app).
      await c.query(
        "update pagos set anulado = true, anulado_por = $2, anulado_en = now(), motivo_anulacion = 'test' where id=$1",
        [pagoId, admin.id],
      );
      let r = await c.query("select pagado_acum from prestamos where id=$1", [pid]);
      expect(n(r.rows[0].pagado_acum)).toBe(0);

      // Des-anular sin escotilla: vetado (incluso para service_role).
      await comoRol(c, "service_role", null, () =>
        esperaErrorPg(c, "P0403", () => c.query("update pagos set anulado = false where id=$1", [pagoId])),
      );

      // Con la escotilla: sale, y el trigger 0063 re-suma la plata al crédito.
      await c.query("select set_config('app.permitir_desanulacion', 'on', true)");
      await c.query("update pagos set anulado = false where id=$1", [pagoId]);
      r = await c.query("select pagado_acum from prestamos where id=$1", [pid]);
      expect(n(r.rows[0].pagado_acum)).toBe(500);
    });
  });
});

describe("0126 · clientes.token_acceso congelado para la API", () => {
  it("un gestor no puede reescribir el token; service_role (rotación) sí", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const cliente = await mkCliente(c);
      const antes = (await c.query("select token_acceso from clientes where id=$1", [cliente])).rows[0].token_acceso;

      await comoRol(c, "authenticated", admin.authUserId, () =>
        esperaErrorPg(c, "P0403", () => c.query("update clientes set token_acceso = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678deadbeef' where id=$1", [cliente])),
      );
      const sigue = (await c.query("select token_acceso from clientes where id=$1", [cliente])).rows[0].token_acceso;
      expect(sigue).toBe(antes);

      // La rotación real del admin corre con service_role (lib/acciones/token.ts).
      await comoRol(c, "service_role", null, () =>
        c.query("update clientes set token_acceso = 'ffffffffffffffffffffffffffffffffffffffffffffffff' where id=$1", [cliente]),
      );
      const rotado = (await c.query("select token_acceso from clientes where id=$1", [cliente])).rows[0].token_acceso;
      expect(rotado).not.toBe(antes);

      // Y otros campos del cliente SIGUEN editables por el gestor (no rompimos la ficha).
      await comoRol(c, "authenticated", admin.authUserId, () =>
        c.query("update clientes set telefono = '099111222' where id=$1", [cliente]),
      );
      const tel = (await c.query("select telefono from clientes where id=$1", [cliente])).rows[0].telefono;
      expect(tel).toBe("099111222");
    });
  });
});
