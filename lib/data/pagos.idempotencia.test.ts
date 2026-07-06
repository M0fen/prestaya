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
 *  índice único sobre `op_id` (23505 si el op_id ya existe). */
function fakePagosDb() {
  const filas: Record<string, unknown>[] = [];
  const opIds = new Set<string>();
  const db = {
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
