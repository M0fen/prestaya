// ─────────────────────────────────────────────────────────────────────────
//  Seguridad del acceso por token (Fase 0.2). La vista de cliente resuelve el
//  token → UN cliente y TODO lo demás se consulta por ese `cliente_id`/
//  `prestamo_id`. Este test prueba el límite: con el token del cliente A NO se
//  puede llegar a los datos del cliente B. Si alguien quitara el filtro por
//  token (o por prestamo_id), estos asserts fallan.
//  Doble de Supabase en memoria que respeta los `.eq()` acumulados.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientePorToken } from "./clientes";
import { getPrestamoActivoPorCliente } from "./prestamos";
import { getPagosDePrestamo } from "./pagos";

type Fila = Record<string, unknown>;

/** Query-builder mínimo: filtra por los `.eq(col,val)` acumulados; termina en
 *  `.maybeSingle()` (uno), `.order()` (lista) o `.order().limit(n)` (top-n). */
function fakeDb(tablas: Record<string, Fila[]>) {
  return {
    from(nombre: string) {
      const filas = tablas[nombre] ?? [];
      const conds: Array<[string, unknown]> = [];
      const aplica = () => filas.filter((r) => conds.every(([c, v]) => r[c] === v));
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          conds.push([col, val]);
          return builder;
        },
        maybeSingle: () => Promise.resolve({ data: aplica()[0] ?? null, error: null }),
        // `.order()` es awaitable (lista completa) y además encadena `.limit(n)`.
        order: () => {
          const p = Promise.resolve({ data: aplica(), error: null }) as Promise<{
            data: Fila[];
            error: null;
          }> & { limit?: (n: number) => Promise<{ data: Fila[]; error: null }> };
          p.limit = (n: number) => Promise.resolve({ data: aplica().slice(0, n), error: null });
          return p;
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

// Dos clientes con su propio token, préstamo y pagos.
const clientes: Fila[] = [
  { id: "A", nombre: "Ana", token_acceso: "tok-A", activo: true, calificacion: "buena", gps_lat: null, gps_lng: null, creado_en: "", actualizado_en: "" },
  { id: "B", nombre: "Beto", token_acceso: "tok-B", activo: true, calificacion: "buena", gps_lat: null, gps_lng: null, creado_en: "", actualizado_en: "" },
];
const prestamos: Fila[] = [
  { id: "pA", cliente_id: "A", estado: "activo", monto_prestado: 100, cuota_diaria: 10, total_dias: 10, fecha_inicio: "2026-07-01", creado_en: "", actualizado_en: "" },
  { id: "pB", cliente_id: "B", estado: "activo", monto_prestado: 200, cuota_diaria: 20, total_dias: 10, fecha_inicio: "2026-07-01", creado_en: "", actualizado_en: "" },
];
const pagos: Fila[] = [
  { id: "gA1", prestamo_id: "pA", dia_credito: 1, monto: 10, anulado: false },
  { id: "gB1", prestamo_id: "pB", dia_credito: 1, monto: 20, anulado: false },
];

describe("acceso por token — aislamiento entre clientes", () => {
  const db = fakeDb({ clientes, prestamos, pagos });

  it("cada token resuelve SOLO a su cliente", async () => {
    expect((await getClientePorToken(db, "tok-A"))?.id).toBe("A");
    expect((await getClientePorToken(db, "tok-B"))?.id).toBe("B");
  });

  it("un token desconocido no devuelve ningún cliente (no filtra al primero)", async () => {
    expect(await getClientePorToken(db, "tok-INEXISTENTE")).toBeNull();
  });

  it("con el token de A NO se llega al préstamo ni a los pagos de B", async () => {
    // Camino real de la vista: token → cliente → préstamo → pagos.
    const a = await getClientePorToken(db, "tok-A");
    expect(a?.id).toBe("A");
    const prestamoA = await getPrestamoActivoPorCliente(db, a!.id);
    expect(prestamoA?.id).toBe("pA"); // nunca pB
    const pagosA = await getPagosDePrestamo(db, prestamoA!.id);
    expect(pagosA.map((p) => p.id)).toEqual(["gA1"]); // jamás gB1
    expect(pagosA.some((p) => p.id === "gB1")).toBe(false);
  });

  it("el préstamo de A pedido para el cliente B no existe (scoping por cliente_id)", async () => {
    // Aunque tuvieras el id del préstamo de A, la consulta se hace por cliente_id.
    const prestamoDeB = await getPrestamoActivoPorCliente(db, "B");
    expect(prestamoDeB?.id).toBe("pB");
    expect(prestamoDeB?.id).not.toBe("pA");
  });
});
