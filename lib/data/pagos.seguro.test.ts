// ─────────────────────────────────────────────────────────────────────────
//  Tests del camino ATÓMICO de registrarPago (RPC registrar_pago_seguro, 0079).
//  El RPC serializa por crédito (advisory lock) y re-chequea el sobre-pago con el
//  pagado_acum fresco → dos cobros concurrentes al mismo crédito no se pisan. Acá
//  se prueba el RUTEO de registrarPago sobre el RPC: éxito, sobre-pago rechazado
//  (P0409 → esSobrePago), op_id repetido (23505 → idempotente en el llamador) y el
//  FALLBACK al insert plano si el RPC no está (PGRST202).
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarPago, esSobrePago } from "./pagos";
import type { NuevoPago } from "@/types/db";

/** Doble de Supabase con un RPC `registrar_pago_seguro` que emula al de 0079:
 *  · candado + total/acum del crédito → rechaza el sobre-pago con P0409;
 *  · op_id repetido → 23505;
 *  · si `rpcAusente`, devuelve PGRST202 (registrarPago cae al insert plano). */
function fakeDb(opts: { total: number; acum: number; rpcAusente?: boolean }) {
  const opIds = new Set<string>();
  const inserts: Record<string, unknown>[] = [];
  let acum = opts.acum;
  const db = {
    rpc(_name: string, p: Record<string, unknown>) {
      if (opts.rpcAusente) return Promise.resolve({ data: null, error: { code: "PGRST202" } });
      const opId = p.p_op_id as string | null;
      if (opId && opIds.has(opId))
        return Promise.resolve({ data: null, error: { code: "23505", message: "dup op" } });
      const monto = Math.round(p.p_monto as number);
      // Anti sobre-pago atómico con la tolerancia de 1 peso (igual que el RPC real).
      if (acum + monto > opts.total + 1)
        return Promise.resolve({ data: null, error: { code: "P0409", message: "sobre-pago" } });
      if (opId) opIds.add(opId);
      acum += monto;
      const row = { id: `pago-${inserts.length + 1}`, anulado: false, ...p, monto, prestamo_id: p.p_prestamo_id, dia_credito: p.p_dia_credito };
      inserts.push(row);
      return Promise.resolve({ data: row, error: null });
    },
    // Insert plano (solo se usa en el fallback PGRST202).
    from() {
      return {
        insert(row: Record<string, unknown>) {
          return { select() { return { single() {
            const r = { id: `plano-${inserts.length + 1}`, anulado: false, ...row };
            inserts.push(r);
            return Promise.resolve({ data: r, error: null });
          } }; } };
        },
      };
    },
    _inserts: inserts,
  };
  return db as unknown as SupabaseClient & { _inserts: Record<string, unknown>[] };
}

const base: NuevoPago = {
  prestamo_id: "prestamo-1",
  dia_credito: 3,
  monto: 500,
  registrado_por: "cobrador-1",
  gps_lat: null,
  gps_lng: null,
  registrado_en: null,
  op_id: "op-1",
};

describe("registrarPago vía RPC seguro (0079)", () => {
  it("un pago dentro del saldo se registra (monto entero)", async () => {
    const db = fakeDb({ total: 10000, acum: 9000 }); // falta 1000
    const p = await registrarPago(db, { ...base, monto: 1000, op_id: "a" });
    expect(p.monto).toBe(1000);
    expect(db._inserts).toHaveLength(1);
  });

  it("SOBRE-PAGO bajo el candado → rechaza (P0409, esSobrePago) y NO inserta", async () => {
    // El crédito ya está saldado (acum == total): un 2º pago concurrente cae acá.
    const db = fakeDb({ total: 10000, acum: 10000 });
    await expect(registrarPago(db, { ...base, monto: 1000, op_id: "b" })).rejects.toMatchObject({ code: "P0409" });
    expect(db._inserts).toHaveLength(0); // nunca entró el sobre-cobro
    // esSobrePago reconoce tanto el código P0409 como la marca sobrepago.
    expect(esSobrePago({ code: "P0409" })).toBe(true);
    expect(esSobrePago({ sobrepago: true })).toBe(true);
    expect(esSobrePago({ code: "23505" })).toBe(false);
  });

  it("residuo sub-peso legítimo (cuota fraccionaria) NO se rechaza", async () => {
    // total 8424,96 (351,04×24); acum 8424; último peso → 8425 ≤ total+1.
    const db = fakeDb({ total: 8424.96, acum: 8424 });
    const p = await registrarPago(db, { ...base, monto: 1, op_id: "c" });
    expect(p.monto).toBe(1);
  });

  it("op_id repetido → 23505 (el llamador lo trata como éxito idempotente)", async () => {
    const db = fakeDb({ total: 10000, acum: 0 });
    await registrarPago(db, { ...base, monto: 500, op_id: "dup" });
    await expect(registrarPago(db, { ...base, monto: 500, op_id: "dup" })).rejects.toMatchObject({ code: "23505" });
    expect(db._inserts).toHaveLength(1);
  });

  it("RPC ausente (0079 sin correr) → fallback al insert plano", async () => {
    const db = fakeDb({ total: 10000, acum: 0, rpcAusente: true });
    const p = await registrarPago(db, { ...base, monto: 500, op_id: "x" });
    expect(p.monto).toBe(500);
    expect(db._inserts[0].id).toMatch(/^plano-/); // pasó por el camino plano
  });
});
