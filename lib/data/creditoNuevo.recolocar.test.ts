// ─────────────────────────────────────────────────────────────────────────
//  DESHACER Y VOLVER A COLOCAR — la plata que no salía.
//
//  El caso real de la calle: el cobrador coloca $5.000, ve el dedazo, toca
//  "Deshacer" (el crédito queda 'cancelado') y vuelve a colocar el MISMO monto y
//  plazo ese mismo día. El op_id determinista se arma con (cliente, monto,
//  cuota, cuotas, fecha, cobrador): al repetir esos datos vuelve a dar el mismo
//  valor, chocaba con el índice único y la app respondía «Ya estaba hecho ✓ — no
//  le des la plata de nuevo» señalando un crédito DESHECHO. El cliente se
//  quedaba sin plata y sin crédito, y el cobrador convencido de que ya estaba.
//
//  La regla que fija este archivo: un crédito CANCELADO nunca existió
//  financieramente (la misma que ya rige para el techo del +20%), así que no
//  puede hacer de "ya estaba hecho". La idempotencia real —dos toques del mismo
//  submit— se mantiene intacta.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearCreditoNuevoDb } from "./creditoNuevo";

const ALTA = {
  clienteId: "cli-1",
  cobradorId: "u-maria",
  monto: 5_000,
  cuota: 250,
  totalDias: 24,
  frecuencia: "diario" as const,
  fechaInicio: "2026-09-04",
  interesPct: 20,
  creadoPor: "u-maria",
  opId: "11111111-1111-4111-8111-111111111111",
};

/** Violación de índice único, como la devuelve PostgREST. */
const CHOQUE = { code: "23505", message: "duplicate key value violates unique constraint" };

/**
 * Doble de Supabase para `prestamos`: guarda las filas insertadas y rechaza con
 * 23505 cuando el op_id ya existe (igual que el índice único parcial de 0101).
 */
function crearDb(existentes: { id: string; op_id: string; estado: string }[] = []) {
  const filas = [...existentes];
  const insertados: Record<string, unknown>[] = [];
  const db = {
    from(tabla: string) {
      if (tabla === "asignaciones") {
        return { upsert: () => Promise.resolve({ error: null }) };
      }
      let eqOp: string | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => {
          if (c === "op_id") eqOp = String(v);
          return b;
        },
        neq: () => b,
        in: () => b,
        update: () => b,
        limit: () =>
          Promise.resolve({ data: filas.filter((f) => f.op_id === eqOp).map((f) => ({ ...f })), error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
        insert(fila: Record<string, unknown>) {
          const op = String(fila.op_id);
          const choca = filas.some((f) => f.op_id === op);
          return {
            select: () => ({
              single: () => {
                if (choca) return Promise.resolve({ data: null, error: CHOQUE });
                const id = `nuevo-${filas.length + 1}`;
                filas.push({ id, op_id: op, estado: String(fila.estado) });
                insertados.push(fila);
                return Promise.resolve({ data: { id }, error: null });
              },
            }),
          };
        },
      };
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, filas, insertados };
}

describe("crearCreditoNuevoDb — idempotencia que no confunde 'deshecho' con 'ya hecho'", () => {
  it("alta normal: crea el crédito", async () => {
    const { db, insertados } = crearDb();
    const r = await crearCreditoNuevoDb(db, ALTA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repetido).toBe(false);
    expect(insertados).toHaveLength(1);
  });

  it("el MISMO submit dos veces (doble toque / reintento sin señal) NO duplica el capital", async () => {
    const { db, insertados } = crearDb([{ id: "ya", op_id: ALTA.opId, estado: "activo" }]);
    const r = await crearCreditoNuevoDb(db, ALTA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.repetido).toBe(true);
      expect(r.prestamoId).toBe("ya"); // devuelve el que YA existe
    }
    expect(insertados).toHaveLength(0); // no se colocó capital de nuevo
  });

  it("⚠️ EL CASO REAL: tras DESHACER, volver a colocar lo mismo CREA el crédito", async () => {
    // El crédito viejo quedó 'cancelado'. No puede hacer de "ya estaba hecho":
    // el cliente todavía no tiene su plata.
    const { db, insertados } = crearDb([{ id: "deshecho", op_id: ALTA.opId, estado: "cancelado" }]);
    const r = await crearCreditoNuevoDb(db, ALTA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.repetido).toBe(false); // ← antes decía true y la plata no salía
      expect(r.prestamoId).not.toBe("deshecho");
    }
    expect(insertados).toHaveLength(1);
    // Y nace con otro op_id, porque el viejo sigue ocupado por el cancelado.
    expect(insertados[0].op_id).not.toBe(ALTA.opId);
  });

  it("el doble toque de ESA recolocación tampoco duplica (el op_id derivado es determinista)", async () => {
    const { db } = crearDb([{ id: "deshecho", op_id: ALTA.opId, estado: "cancelado" }]);
    const primera = await crearCreditoNuevoDb(db, ALTA);
    const segunda = await crearCreditoNuevoDb(db, ALTA);
    expect(primera.ok && segunda.ok).toBe(true);
    if (primera.ok && segunda.ok) {
      expect(segunda.repetido).toBe(true);
      expect(segunda.prestamoId).toBe(primera.prestamoId); // el MISMO crédito
    }
  });

  it("un crédito FINALIZADO sí es 'ya estaba hecho' (no se recoloca solo)", async () => {
    const { db, insertados } = crearDb([{ id: "pagado", op_id: ALTA.opId, estado: "finalizado" }]);
    const r = await crearCreditoNuevoDb(db, ALTA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repetido).toBe(true);
    expect(insertados).toHaveLength(0);
  });
});
