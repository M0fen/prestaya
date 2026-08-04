// Test de getLiquidacionDiaria: agrega por cobrador base/visitas/recaudo/retiros/
// ventas y deriva caja final + estado (cerrada si rindió). Mock del cliente
// Supabase con un query-builder encadenable que resuelve datasets por tabla.
import { describe, expect, it } from "vitest";
import { getLiquidacionDiaria } from "./liquidacion";

/** Builder encadenable: ignora los filtros (el dataset ya viene "de hoy"),
 *  resuelve {data, error} tanto al await directo (thenable) como en .range(). */
function fakeDb(tablas: Record<string, unknown[]>) {
  return {
    from(tabla: string) {
      const rows = tablas[tabla] ?? [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder, // filtro de origen (pagos nativos)
        gte: () => builder,
        order: () => builder,
        range: (from: number, to: number) =>
          Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
        then: (onF: (v: { data: unknown[]; error: null }) => unknown) =>
          onF({ data: rows, error: null }),
      };
      return builder;
    },
  } as unknown as Parameters<typeof getLiquidacionDiaria>[0];
}

const HOY = new Date("2026-07-08T12:00:00Z");

describe("getLiquidacionDiaria", () => {
  it("agrega por cobrador y deriva caja final + estado", async () => {
    const db = fakeDb({
      usuarios: [
        { id: "c1", nombre: "Ana" },
        { id: "c2", nombre: "Beto" },
      ],
      pagos: [
        { monto: 2000, registrado_por: "c1" },
        { monto: 1000, registrado_por: "c1" },
        { monto: 1000, registrado_por: "c2" },
        { monto: 500, registrado_por: null }, // sin cobrador → se ignora
      ],
      visitas: [
        { cobrador_id: "c1" },
        { cobrador_id: "c1" },
        { cobrador_id: "c2" },
      ],
      movimientos_caja: [
        { tipo: "ingreso", monto: 5000, cobrador_id: "c1" }, // base
        { tipo: "retiro", monto: 500, cobrador_id: "c1" },
        { tipo: "egreso", monto: 300, cobrador_id: "c1" },
        { tipo: "desembolso", monto: 9000, cobrador_id: "c2" }, // no cuenta como retiro
      ],
      prestamos: [{ cobrador_id: "c1" }],
      rendiciones: [{ cobrador_id: "c1" }], // c1 cerró
    });

    const liq = await getLiquidacionDiaria(db, HOY, { global: true });

    expect(liq.totalCobradores).toBe(2);
    expect(liq.cajasCerradas).toBe(1);
    expect(liq.recaudoTotal).toBe(4000);
    // c1: base 5000 + recaudo 3000 − retiros(500+300) = 7200 ; c2: 0 + 1000 − 0 = 1000
    expect(liq.cajaFinalTotal).toBe(8200);
    expect(liq.disponibleRendiciones).toBe(true);

    // Orden por recaudo desc: c1 primero.
    const [a, b] = liq.filas;
    expect(a.nombre).toBe("Ana");
    expect(a.base).toBe(5000);
    expect(a.visitas).toBe(2);
    expect(a.recaudo).toBe(3000);
    expect(a.retiros).toBe(800);
    expect(a.ventas).toBe(1);
    expect(a.cajaFinal).toBe(7200);
    expect(a.estado).toBe("cerrada");

    expect(b.nombre).toBe("Beto");
    expect(b.base).toBeNull(); // sin aporte de capital → "—"
    expect(b.recaudo).toBe(1000);
    expect(b.retiros).toBe(0);
    expect(b.cajaFinal).toBe(1000);
    expect(b.estado).toBe("abierta");
  });
});
