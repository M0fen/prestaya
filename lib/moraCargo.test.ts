// Tests del RECARGO por mora: modos off/fijo/pct, gracia y tope. Redondeo peso.
import { describe, expect, it } from "vitest";
import { calcularRecargoMora, type ConfigMora } from "./moraCargo";

const cfg = (o: Partial<ConfigMora>): ConfigMora => ({
  modo: "off",
  valor: 0,
  cuotasGracia: 1,
  topePct: 30,
  ...o,
});

describe("calcularRecargoMora", () => {
  it("modo off → siempre 0", () => {
    expect(calcularRecargoMora(10000, 10, cfg({ modo: "off" }))).toBe(0);
  });

  it("respeta la gracia: dentro de la gracia no cobra", () => {
    const c = cfg({ modo: "fijo", valor: 100, cuotasGracia: 2 });
    expect(calcularRecargoMora(10000, 2, c)).toBe(0); // 2 vencidas, 2 de gracia
    expect(calcularRecargoMora(10000, 3, c)).toBe(100); // 1 excede
  });

  it("modo fijo: $ por cuota vencida excedente", () => {
    const c = cfg({ modo: "fijo", valor: 50, cuotasGracia: 0, topePct: 0 });
    expect(calcularRecargoMora(10000, 4, c)).toBe(200); // 50 × 4
  });

  it("modo pct: % de la deuda vencida", () => {
    const c = cfg({ modo: "pct", valor: 10, cuotasGracia: 0, topePct: 0 });
    expect(calcularRecargoMora(8000, 3, c)).toBe(800); // 10% de 8.000
  });

  it("el tope acota el recargo (freno de usura)", () => {
    const c = cfg({ modo: "fijo", valor: 1000, cuotasGracia: 0, topePct: 20 });
    // 1000 × 10 = 10.000, pero tope 20% de 5.000 = 1.000
    expect(calcularRecargoMora(5000, 10, c)).toBe(1000);
  });

  it("sin deuda vencida no hay recargo", () => {
    expect(calcularRecargoMora(0, 5, cfg({ modo: "pct", valor: 10 }))).toBe(0);
  });
});
