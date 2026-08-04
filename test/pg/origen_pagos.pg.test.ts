// ─────────────────────────────────────────────────────────────────────────
//  0127/0128 — el ORIGEN del pago separa la plata del negocio del trabajo en
//  la app, contra Postgres REAL. Desde el empalme con Disapp conviven pagos
//  NATIVOS (origen NULL) e IMPORTADOS/AJUSTES (origen no nulo); estas RPCs son
//  las que pagan comisiones y puntúan la custodia:
//   · app_comision_por_ruta (0127): comisiona SOLO trabajo en la app.
//   · app_vigilancia_pagos (0128): "recaudó y no rindió" SOLO con nativos.
//   · app_desempeno_rango (0128): cobranza real (nativo + disapp_import),
//     nunca asientos sintéticos de reconciliación.
//  El caso que fija cada test es el bug cuantificado en vivo el 08-04:
//  liquidar agosto habría pagado ~$116.589 sobre una base 100% importada.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import type pg from "pg";
import { withRollback, comoRol, mkGestorConAuth, mkCobradorConAuth, mkCliente, mkPrestamo, n } from "./db";

/** Siembra un pago con origen explícito (NULL = nativo de la app). */
async function mkPago(
  c: pg.PoolClient,
  prestamoId: string,
  monto: number,
  registradoPor: string,
  origen: string | null,
) {
  await c.query(
    `insert into pagos (prestamo_id, dia_credito, monto, registrado_por, registrado_en, origen, disapp_pago_id)
     values ($1, 1, $2, $3, now(), $4, $5)`,
    [prestamoId, monto, registradoPor, origen, origen ? `t-${Math.random().toString(36).slice(2, 10)}` : null],
  );
}

describe("0127 · app_comision_por_ruta comisiona SOLO trabajo en la app", () => {
  it("nativo suma; disapp_import / reconciliacion / ajuste_migracion NO", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const cob = await mkCobradorConAuth(c);
      const cliente = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cliente, cobradorId: cob.id, cuotaDiaria: 500, totalDias: 24 });

      await mkPago(c, pid, 500, cob.id, null); // trabajo EN la app
      await mkPago(c, pid, 700, cob.id, "disapp_import"); // mundo viejo
      await mkPago(c, pid, 900, cob.id, "reconciliacion_0804"); // asiento
      await mkPago(c, pid, 1100, cob.id, "ajuste_migracion"); // asiento

      const r = await comoRol(c, "authenticated", admin.authUserId, () =>
        c.query("select * from app_comision_por_ruta(now() - interval '1 day', now() + interval '1 day')"),
      );
      const fila = r.rows.find((x: { cobrador_id: string }) => x.cobrador_id === cob.id);
      // Solo el pago nativo comisiona: $500, 1 cobro. Los $2.700 importados/
      // ajustados ya fueron comisionados (o son asientos) en el mundo viejo.
      expect(fila).toBeTruthy();
      expect(n(fila.recaudado)).toBe(500);
      expect(Number(fila.cobros)).toBe(1);
    });
  });

  it("un pago anulado tampoco comisiona (ni siquiera nativo)", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const cob = await mkCobradorConAuth(c);
      const cliente = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cliente, cobradorId: cob.id, cuotaDiaria: 500, totalDias: 24 });
      await mkPago(c, pid, 500, cob.id, null);
      await c.query(
        `update pagos set anulado = true, anulado_por = $2, anulado_en = now(), motivo_anulacion = 'test'
         where prestamo_id = $1`,
        [pid, admin.id],
      );
      const r = await comoRol(c, "authenticated", admin.authUserId, () =>
        c.query("select * from app_comision_por_ruta(now() - interval '1 day', now() + interval '1 day')"),
      );
      expect(r.rows.find((x: { cobrador_id: string }) => x.cobrador_id === cob.id)).toBeUndefined();
    });
  });
});

describe("0128 · app_vigilancia_pagos: custodia = solo nativos", () => {
  it("los días importados no fabrican 'recaudó y no rindió'", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const cob = await mkCobradorConAuth(c);
      const cliente = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cliente, cobradorId: cob.id, cuotaDiaria: 500, totalDias: 24 });

      await mkPago(c, pid, 500, cob.id, null);
      await mkPago(c, pid, 9999, cob.id, "disapp_import");

      const r = await comoRol(c, "authenticated", admin.authUserId, () =>
        c.query("select * from app_vigilancia_pagos(now() - interval '1 day')"),
      );
      const filas = r.rows.filter((x: { cobrador_id: string }) => x.cobrador_id === cob.id);
      expect(filas).toHaveLength(1);
      // Solo el pago nativo cuenta como efectivo en mano del cobrador.
      expect(n(filas[0].monto)).toBe(500);
    });
  });
});

describe("0128 · app_desempeno_rango: cobranza real, sin asientos sintéticos", () => {
  it("nativo + disapp_import suman; reconciliacion_* no", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const cob = await mkCobradorConAuth(c);
      const cliente = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cliente, cobradorId: cob.id, cuotaDiaria: 500, totalDias: 24 });

      await mkPago(c, pid, 500, cob.id, null); // app
      await mkPago(c, pid, 700, cob.id, "disapp_import"); // cobró en la calle (mundo viejo)
      await mkPago(c, pid, 9000, cob.id, "reconciliacion_0804"); // asiento contable

      const r = await comoRol(c, "authenticated", admin.authUserId, () =>
        c.query("select app_desempeno_rango(now() - interval '1 day', now() + interval '1 day') as d"),
      );
      const porCob = (r.rows[0].d.por_cobrador as { cobrador_id: string; recaudado: number }[]).find(
        (x) => x.cobrador_id === cob.id,
      );
      // Evaluación de la persona: lo que cobró de verdad ($500 app + $700
      // Disapp) — el asiento de $9.000 fechado hoy no es cobranza de hoy.
      expect(porCob).toBeTruthy();
      expect(n(porCob!.recaudado)).toBe(1200);
    });
  });
});
