// ─────────────────────────────────────────────────────────────────────────
//  SESIÓN DE CAOS (Fase 4 del plan QA, 15-08) — los ataques del arsenal
//  adversarial que se sellan contra Postgres REAL y no tenían test:
//   · Baja con sesión viva: activo=false anula la identidad (app_usuario_id
//     exige activo=true) aunque el JWT siga siendo válido.
//   · POST directo del cobrador a /rest/v1: prestamos (0129), pagos a nombre
//     de otro (0092), aperturas_caja (0105) y asignaciones (0031).
//   · Supervisor NO cruza su zona: solicitudes_renovacion (0140) y
//     solicitudes_anulacion (0143) — aplicadas en la base viva y hasta hoy
//     verificadas solo contra pg_policies, nunca ejecutadas.
//   · anon (la llave pública del navegador) no toca el dinero (0142).
//   · El circuito de solicitudes no se forja: nace pendiente y sin firmas
//     (0137) y como mucho UNA pendiente por (crédito, tipo) (0141).
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  withRollback,
  comoRol,
  esperaErrorPg,
  mkGestorConAuth,
  mkCobradorConAuth,
  mkCliente,
  mkPrestamo,
  mkAsignacion,
} from "./db";
import type pg from "pg";

// ── Fixtures de zona (usuarios.zona_id + supervisor_zonas) ──────────────────
async function mkZona(c: pg.PoolClient, nombre: string): Promise<string> {
  const r = await c.query<{ id: string }>("insert into zonas (nombre) values ($1) returning id", [nombre]);
  return r.rows[0].id;
}
async function supervisaZona(c: pg.PoolClient, supervisorId: string, zonaId: string): Promise<void> {
  await c.query("insert into supervisor_zonas (supervisor_id, zona_id) values ($1,$2)", [supervisorId, zonaId]);
}
async function conZona(c: pg.PoolClient, usuarioId: string, zonaId: string): Promise<void> {
  await c.query("update usuarios set zona_id = $2 where id = $1", [usuarioId, zonaId]);
}

/** Cobrador de zona B con SU cliente, su crédito y todo asignado. */
async function escenarioZonaAjena(c: pg.PoolClient) {
  const zonaA = await mkZona(c, "Caos A");
  const zonaB = await mkZona(c, "Caos B");
  // Supervisores CON zona: sin ella, app_supervisor_sin_zonas() los deja ver todo.
  const supA = await mkGestorConAuth(c, "supervisor");
  await supervisaZona(c, supA.id, zonaA);
  const supB = await mkGestorConAuth(c, "supervisor");
  await supervisaZona(c, supB.id, zonaB);
  const cobB = await mkCobradorConAuth(c);
  await conZona(c, cobB.id, zonaB);
  const cliB = await mkCliente(c);
  await mkAsignacion(c, cobB.id, cliB);
  const prestamoB = await mkPrestamo(c, { clienteId: cliB, cobradorId: cobB.id, cuotaDiaria: 500, totalDias: 24 });
  return { supA, supB, cobB, cliB, prestamoB };
}

describe("caos · baja con sesión viva (activo=false mata la identidad)", () => {
  it("el cobrador activo registra su pago; dado de baja, el MISMO JWT rebota (42501)", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      await mkAsignacion(c, cob.id, cli);
      const pid = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: 100, totalDias: 20 });
      // Activo: el camino honesto entra (registrado_por = él mismo, cliente suyo).
      await comoRol(c, "authenticated", cob.authUserId, () =>
        c.query("insert into pagos (prestamo_id, dia_credito, monto, registrado_por) values ($1,1,100,$2)", [pid, cob.id]),
      );
      // Baja: mismo token, misma operación → app_usuario_id() ya no lo resuelve.
      await c.query("update usuarios set activo = false where id = $1", [cob.id]);
      await comoRol(c, "authenticated", cob.authUserId, () =>
        esperaErrorPg(c, "42501", () =>
          c.query("insert into pagos (prestamo_id, dia_credito, monto, registrado_por) values ($1,2,100,$2)", [pid, cob.id]),
        ),
      );
    });
  });

  it("un gestor dado de baja tampoco escribe en el libro de caja", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      await c.query("update usuarios set activo = false where id = $1", [admin.id]);
      await comoRol(c, "authenticated", admin.authUserId, () =>
        esperaErrorPg(c, "42501", () =>
          c.query(
            "insert into movimientos_caja (tipo, monto, categoria, registrado_por) values ('egreso', 100, 'Comisión', $1)",
            [admin.id],
          ),
        ),
      );
    });
  });
});

describe("caos · POST directo del cobrador a /rest/v1", () => {
  it("no se coloca capital a sí mismo: INSERT en prestamos → 42501 (0129)", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      await mkAsignacion(c, cob.id, cli);
      await comoRol(c, "authenticated", cob.authUserId, () =>
        esperaErrorPg(c, "42501", () =>
          c.query(
            `insert into prestamos (cliente_id, cobrador_id, monto_prestado, cuota_diaria, total_dias, fecha_inicio)
             values ($1,$2,50000,2500,24,'2026-08-01')`,
            [cli, cob.id],
          ),
        ),
      );
    });
  });

  it("no registra un pago A NOMBRE DE OTRO (anti-framing, 0092)", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      const victima = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      await mkAsignacion(c, cob.id, cli);
      const pid = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: 100, totalDias: 20 });
      await comoRol(c, "authenticated", cob.authUserId, () =>
        esperaErrorPg(c, "42501", () =>
          c.query("insert into pagos (prestamo_id, dia_credito, monto, registrado_por) values ($1,1,100,$2)", [
            pid,
            victima.id,
          ]),
        ),
      );
    });
  });

  it("no se fabrica su propia base de caja: INSERT en aperturas_caja → 42501", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      await comoRol(c, "authenticated", cob.authUserId, () =>
        esperaErrorPg(c, "42501", () =>
          c.query("insert into aperturas_caja (cobrador_id, base) values ($1, 999999)", [cob.id]),
        ),
      );
    });
  });

  it("no se auto-asigna clientes: INSERT en asignaciones → 42501", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      const ajeno = await mkCliente(c);
      await comoRol(c, "authenticated", cob.authUserId, () =>
        esperaErrorPg(c, "42501", () =>
          c.query("insert into asignaciones (cobrador_id, cliente_id, activo) values ($1,$2,true)", [cob.id, ajeno]),
        ),
      );
    });
  });
});

describe("caos · el supervisor no cruza la frontera de su zona", () => {
  it("solicitudes_renovacion (0140): ni ve ni resuelve pedidos de otra zona; el de la zona sí", async () => {
    await withRollback(async (c) => {
      const { supA, supB, cliB, prestamoB } = await escenarioZonaAjena(c);
      const sol = await c.query<{ id: string }>(
        `insert into solicitudes_renovacion (cliente_id, prestamo_anterior_id, monto, total_dias, frecuencia)
         values ($1,$2,12000,24,'diario') returning id`,
        [cliB, prestamoB],
      );
      const solId = sol.rows[0].id;
      // Supervisor de la zona A: la solicitud de la zona B no existe para él.
      await comoRol(c, "authenticated", supA.authUserId, async () => {
        const ve = await c.query("select 1 from solicitudes_renovacion where id = $1", [solId]);
        expect(ve.rowCount).toBe(0);
        const upd = await c.query(
          "update solicitudes_renovacion set estado='rechazada', motivo_rechazo='ajeno' where id = $1",
          [solId],
        );
        expect(upd.rowCount).toBe(0); // RLS la filtra: el UPDATE no encuentra la fila
      });
      // Control positivo: el supervisor de la zona B sí la resuelve.
      await comoRol(c, "authenticated", supB.authUserId, async () => {
        const upd = await c.query(
          "update solicitudes_renovacion set estado='rechazada', motivo_rechazo='propio' where id = $1",
          [solId],
        );
        expect(upd.rowCount).toBe(1);
      });
    });
  });

  it("solicitudes_anulacion (0143): misma frontera, llaveada por el pago", async () => {
    await withRollback(async (c) => {
      const { supA, supB, cobB, prestamoB } = await escenarioZonaAjena(c);
      const pago = await c.query<{ id: string }>(
        "insert into pagos (prestamo_id, dia_credito, monto, registrado_por) values ($1,1,500,$2) returning id",
        [prestamoB, cobB.id],
      );
      const sol = await c.query<{ id: string }>(
        "insert into solicitudes_anulacion (pago_id, motivo) values ($1,'caos') returning id",
        [pago.rows[0].id],
      );
      const solId = sol.rows[0].id;
      await comoRol(c, "authenticated", supA.authUserId, async () => {
        const upd = await c.query("update solicitudes_anulacion set estado='rechazada' where id = $1", [solId]);
        expect(upd.rowCount).toBe(0);
      });
      await comoRol(c, "authenticated", supB.authUserId, async () => {
        const upd = await c.query("update solicitudes_anulacion set estado='rechazada' where id = $1", [solId]);
        expect(upd.rowCount).toBe(1);
      });
    });
  });

  it("los PAGOS de la zona ajena ni se ven (policy 0031, ejecutada)", async () => {
    await withRollback(async (c) => {
      const { supA, supB, cobB, prestamoB } = await escenarioZonaAjena(c);
      await c.query(
        "insert into pagos (prestamo_id, dia_credito, monto, registrado_por) values ($1,1,500,$2)",
        [prestamoB, cobB.id],
      );
      await comoRol(c, "authenticated", supA.authUserId, async () => {
        const r = await c.query("select 1 from pagos where prestamo_id = $1", [prestamoB]);
        expect(r.rowCount).toBe(0); // zona ajena: el libro no existe para él
      });
      await comoRol(c, "authenticated", supB.authUserId, async () => {
        const r = await c.query("select 1 from pagos where prestamo_id = $1", [prestamoB]);
        expect(r.rowCount).toBe(1); // su zona: lo ve
      });
    });
  });
});

describe("caos · anon (la llave pública del navegador) no toca el dinero", () => {
  it("la RPC de pagos no se puede ni EJECUTAR sin sesión (0142)", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: 100, totalDias: 20 });
      await comoRol(c, "anon", null, () =>
        esperaErrorPg(c, "42501", () =>
          c.query("select * from registrar_pago_seguro($1,1,100,$2,null,null,null,null)", [pid, cob.id]),
        ),
      );
    });
  });

  it("tampoco INSERT directo al libro de pagos", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: 100, totalDias: 20 });
      await comoRol(c, "anon", null, () =>
        esperaErrorPg(c, "42501", () =>
          c.query("insert into pagos (prestamo_id, dia_credito, monto, registrado_por) values ($1,1,100,$2)", [pid, cob.id]),
        ),
      );
    });
  });

  it("ni LEER: clientes y pagos devuelven 0 filas para anon (vigila que nadie agregue una policy por accidente)", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: 100, totalDias: 20 });
      await c.query("insert into pagos (prestamo_id, dia_credito, monto, registrado_por) values ($1,1,100,$2)", [pid, cob.id]);
      await comoRol(c, "anon", null, async () => {
        // La vista del cliente va por service_role tras validar el token; el rol
        // anon del navegador no tiene policies → RLS filtra todo (0 filas, sin error).
        const cs = await c.query("select 1 from clientes where id = $1", [cli]);
        expect(cs.rowCount).toBe(0);
        const ps = await c.query("select 1 from pagos where prestamo_id = $1", [pid]);
        expect(ps.rowCount).toBe(0);
      });
    });
  });
});

describe("caos · el circuito de solicitudes no se forja", () => {
  it("una solicitud 'aprobada' de fábrica NACE pendiente y sin firmas (0137)", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      await mkAsignacion(c, cob.id, cli);
      const pid = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: 500, totalDias: 24 });
      const r = await c.query<{ estado: string; resuelto_por: string | null; resuelto_en: string | null }>(
        `insert into solicitudes_renovacion
           (cliente_id, prestamo_anterior_id, monto, total_dias, frecuencia, estado, resuelto_por, resuelto_en)
         values ($1,$2,12000,24,'diario','aprobada',$3, now())
         returning estado, resuelto_por, resuelto_en`,
        [cli, pid, admin.id],
      );
      expect(r.rows[0].estado).toBe("pendiente");
      expect(r.rows[0].resuelto_por).toBeNull();
      expect(r.rows[0].resuelto_en).toBeNull();
    });
  });

  it("como mucho UNA pendiente por (crédito, tipo); venta y renovación conviven (0141)", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      await mkAsignacion(c, cob.id, cli);
      const pid = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: 500, totalDias: 24 });
      const insertar = (tipo: string) =>
        c.query(
          `insert into solicitudes_renovacion (cliente_id, prestamo_anterior_id, monto, total_dias, frecuencia, tipo)
           values ($1,$2,12000,24,'diario',$3)`,
          [cli, pid, tipo],
        );
      await insertar("renovacion");
      await esperaErrorPg(c, "23505", () => insertar("renovacion")); // el duplicado rebota
      await insertar("venta"); // otro TIPO sobre el mismo crédito: convive
      const k = await c.query<{ k: number }>(
        "select count(*)::int as k from solicitudes_renovacion where prestamo_anterior_id = $1 and estado='pendiente'",
        [pid],
      );
      expect(k.rows[0].k).toBe(2);
    });
  });
});
