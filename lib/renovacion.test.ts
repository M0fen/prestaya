// Test del núcleo de RENOVACIÓN: la cuota del nuevo crédito arrastra la tasa
// del anterior. Es dinero: se fija con números redondos y bordes inválidos.
import { describe, expect, it } from "vitest";
import { calcularCuotaRenovacion, tasaImplicita } from "./renovacion";

// Anterior: prestó 10.000, cuota 400 × 30 días = 12.000 a pagar → tasa 1.2.
const ANT = { monto: 10000, cuota: 400, totalDias: 30 };

describe("tasaImplicita", () => {
  it("total a pagar / capital", () => {
    expect(tasaImplicita(ANT)).toBeCloseTo(1.2, 10);
  });
  it("monto anterior inválido → 0 (no divide por cero)", () => {
    expect(tasaImplicita({ monto: 0, cuota: 400, totalDias: 30 })).toBe(0);
  });
});

describe("calcularCuotaRenovacion", () => {
  it("mismo monto y días → misma cuota", () => {
    expect(calcularCuotaRenovacion(ANT, 10000, 30)).toBe(400);
  });

  it("sube el capital manteniendo la tasa (1.2) y los días", () => {
    // 15.000 × 1.2 / 30 = 600.
    expect(calcularCuotaRenovacion(ANT, 15000, 30)).toBe(600);
  });

  it("cambia los días → recalcula la cuota (redondeada a peso)", () => {
    // 10.000 × 1.2 / 24 = 500.
    expect(calcularCuotaRenovacion(ANT, 10000, 24)).toBe(500);
    // 10.000 × 1.2 / 40 = 300.
    expect(calcularCuotaRenovacion(ANT, 10000, 40)).toBe(300);
  });

  it("términos inválidos → 0 (el llamador rechaza)", () => {
    expect(calcularCuotaRenovacion(ANT, 0, 30)).toBe(0);
    expect(calcularCuotaRenovacion(ANT, 10000, 0)).toBe(0);
  });
});
