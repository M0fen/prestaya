// Tests del núcleo de COMISIÓN: % sobre lo recaudado, redondeo a peso, clamp.
import { describe, expect, it } from "vitest";
import { calcularComision } from "./comision";

describe("calcularComision", () => {
  it("5% de 30.000 = 1.500", () => {
    expect(calcularComision(30000, 5)).toBe(1500);
  });
  it("0% = 0", () => {
    expect(calcularComision(30000, 0)).toBe(0);
  });
  it("redondea a peso entero", () => {
    expect(calcularComision(10000, 3.33)).toBe(333); // 333.0
    expect(Number.isInteger(calcularComision(12345, 7))).toBe(true);
  });
  it("acota el pct fuera de rango", () => {
    expect(calcularComision(1000, 150)).toBe(1000); // tope 100%
    expect(calcularComision(1000, -5)).toBe(0);
  });
  it("recaudado 0 → comisión 0", () => {
    expect(calcularComision(0, 10)).toBe(0);
  });
});
