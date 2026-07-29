// Property-based tests del PLAN DE VENTA de tienda (calcularPlanVenta). Fija las
// invariantes de dinero que deben valer para CUALQUIER precio/interés/plazo:
// todo entero, nunca cobra menos que el capital, el residuo de redondeo del ceil
// está acotado. Complementa lib/venta.test.ts (casos por ejemplo).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { calcularPlanVenta } from "./venta";

const esEntero = (x: number) => Number.isInteger(x);

describe("calcularPlanVenta — invariantes de dinero (PBT)", () => {
  const arb = fc.record({
    precio: fc.integer({ min: 0, max: 5_000_000 }),
    interesPct: fc.integer({ min: 0, max: 300 }),
    cuotas: fc.integer({ min: 1, max: 365 }),
  });

  it("todo es entero, no negativo y coherente con la fórmula", () => {
    fc.assert(
      fc.property(arb, (t) => {
        const p = calcularPlanVenta(t);
        // 1) nunca float al dinero
        expect(esEntero(p.monto) && esEntero(p.cuota) && esEntero(p.totalDias) && esEntero(p.totalACobrar)).toBe(true);
        // 2) capital = round(precio); plazo = cuotas (≥1)
        expect(p.monto).toBe(Math.round(t.precio));
        expect(p.totalDias).toBe(t.cuotas);
        expect(p.totalDias).toBeGreaterThanOrEqual(1);
        // 3) el total cobrado es exactamente cuota × plazo
        expect(p.totalACobrar).toBe(p.cuota * p.totalDias);
      }),
    );
  });

  it("nunca cobra MENOS que el capital, y el residuo del ceil < nº de cuotas", () => {
    fc.assert(
      fc.property(arb, (t) => {
        const p = calcularPlanVenta(t);
        const conInteres = Math.round(t.precio * (1 + t.interesPct / 100));
        // 4) el total con cuotas cubre el total con interés (ceil hacia arriba)
        expect(p.totalACobrar).toBeGreaterThanOrEqual(conInteres);
        // 5) el exceso por el redondeo del ceil está acotado por el nº de cuotas
        expect(p.totalACobrar - conInteres).toBeLessThan(p.totalDias);
        // 6) con interés ≥ 0, el total siempre ≥ el capital financiado
        expect(p.totalACobrar).toBeGreaterThanOrEqual(p.monto);
      }),
    );
  });

  it("el plazo override manda sobre el del producto", () => {
    fc.assert(
      fc.property(arb, fc.integer({ min: 1, max: 365 }), (t, plazo) => {
        const p = calcularPlanVenta(t, plazo);
        expect(p.totalDias).toBe(plazo);
      }),
    );
  });
});
