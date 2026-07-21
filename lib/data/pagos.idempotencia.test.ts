// ─────────────────────────────────────────────────────────────────────────
//  Idempotencia de cobros (Fase 0.3). Simula el caso real: el cobrador con mala
//  señal reintenta el MISMO pago (mismo `op_id`). El índice único parcial de la
//  migración 0006 (uniq_pagos_op) hace que el segundo insert falle con 23505;
//  la Server Action lo trata como éxito idempotente → queda UN solo pago.
//  Acá probamos la capa de datos con un doble Supabase que emula ese índice.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarPago } from "./pagos";
import type { NuevoPago } from "@/types/db";

/** Doble mínimo de Supabase para `insert().select().single()` que emula el
 *  índice único sobre `op_id` (23505 si el op_id ya existe). El `rpc()` devuelve
 *  "función no encontrada" (PGRST202) → registrarPago cae al INSERT plano, que es
 *  el camino que estos tests ejercitan (y el fallback real si 0079 no corrió). */
function fakePagosDb() {
  const filas: Record<string, unknown>[] = [];
  const opIds = new Set<string>();
  const db = {
    rpc() {
      return Promise.resolve({ data: null, error: { code: "PGRST202" } });
    },
    from() {
      return {
        insert(row: Record<string, unknown>) {
          return {
            select() {
              return {
                single() {
                  const opId = row.op_id as string | undefined;
                  if (opId && opIds.has(opId)) {
                    // Violación de índice único (Postgres 23505).
                    return Promise.resolve({
                      data: null,
                      error: { code: "23505", message: "duplicate key value" },
                    });
                  }
                  if (opId) opIds.add(opId);
                  const guardada = { id: `pago-${filas.length + 1}`, anulado: false, ...row };
                  filas.push(guardada);
                  return Promise.resolve({ data: guardada, error: null });
                },
              };
            },
          };
        },
      };
    },
    _filas: filas,
  };
  return db as unknown as SupabaseClient & { _filas: Record<string, unknown>[] };
}

const base: NuevoPago = {
  prestamo_id: "prestamo-1",
  dia_credito: 3,
  monto: 500,
  registrado_por: "cobrador-1",
  gps_lat: null,
  gps_lng: null,
  registrado_en: null,
  op_id: "op-abc-123",
};

describe("idempotencia de pagos (op_id)", () => {
  it("un primer envío inserta el pago", async () => {
    const db = fakePagosDb();
    const p = await registrarPago(db, base);
    expect(p.monto).toBe(500);
    expect(db._filas).toHaveLength(1);
  });

  it("el MISMO op_id reenviado no crea un segundo pago (falla con 23505)", async () => {
    const db = fakePagosDb();
    await registrarPago(db, base);
    // Reintento del mismo cobro (mala señal): mismo op_id.
    await expect(registrarPago(db, base)).rejects.toMatchObject({ code: "23505" });
    // Sigue habiendo UN solo pago: la app trata el 23505 como éxito idempotente.
    expect(db._filas).toHaveLength(1);
  });

  it("dos cobros DISTINTOS (op_id distinto) sí generan dos pagos", async () => {
    const db = fakePagosDb();
    await registrarPago(db, { ...base, op_id: "op-1" });
    await registrarPago(db, { ...base, op_id: "op-2" });
    expect(db._filas).toHaveLength(2);
  });
});

// ── Chokepoint money-critical: el libro de pagos es ENTERO ─────────────────
//  La cuota importada de Disapp puede ser fraccionaria (numeric(12,2)). Ningún
//  float debe entrar al libro inmutable: registrarPago redondea a peso ANTES de
//  insertar, venga del cobrador o del panel. Se fija con test para que un cambio
//  futuro no vuelva a colar decimales al dinero.
describe("registrarPago — redondeo del monto a peso entero", () => {
  it("cuota fraccionaria se redondea (428,57 → 429)", async () => {
    const db = fakePagosDb();
    const p = await registrarPago(db, { ...base, monto: 428.57, op_id: "r1" });
    expect(p.monto).toBe(429);
    expect(Number.isInteger(p.monto)).toBe(true);
    expect(db._filas[0].monto).toBe(429); // lo GUARDADO también es entero
  });

  it("redondea hacia abajo bajo .5 (399,4 → 399) y hacia arriba desde .5 (400,5 → 401)", async () => {
    const db = fakePagosDb();
    const abajo = await registrarPago(db, { ...base, monto: 399.4, op_id: "r2" });
    const arriba = await registrarPago(db, { ...base, monto: 400.5, op_id: "r3" });
    expect(abajo.monto).toBe(399);
    expect(arriba.monto).toBe(401);
  });

  it("un entero exacto queda intacto", async () => {
    const db = fakePagosDb();
    const p = await registrarPago(db, { ...base, monto: 500, op_id: "r4" });
    expect(p.monto).toBe(500);
  });
});
