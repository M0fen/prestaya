// Test del núcleo de RENOVACIÓN: la cuota del nuevo crédito arrastra la tasa
// del anterior. Es dinero: se fija con números redondos y bordes inválidos.
import { describe, expect, it } from "vitest";
import {
  calcularCuotaRenovacion,
  tasaImplicita,
  evaluarRenovacion,
  RENOVACION_TOPE_PCT,
  RENOVACION_TOPE_ABS,
} from "./renovacion";

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

describe("evaluarRenovacion (tope de auto-aprobación)", () => {
  it("mismo monto o menos → auto-aprobable", () => {
    expect(evaluarRenovacion(50000, 50000).autoAprobable).toBe(true);
    expect(evaluarRenovacion(50000, 40000).autoAprobable).toBe(true);
  });

  it("aumento justo en el 20% → auto-aprobable (borde)", () => {
    // 50.000 → 60.000 = +20% y +$10.000 (dentro de ambos topes).
    const e = evaluarRenovacion(50000, 60000);
    expect(e.autoAprobable).toBe(true);
    expect(e.aumento).toBe(10000);
    expect(e.aumentoPct).toBeCloseTo(20, 6);
  });

  it("aumento del 21% → requiere aprobación (supera el %)", () => {
    const e = evaluarRenovacion(50000, 60500); // +21%
    expect(e.autoAprobable).toBe(false);
    expect(e.motivo).toContain(`${RENOVACION_TOPE_PCT}%`);
  });

  it("dentro del 20% pero aumento > $100.000 → requiere aprobación (tope absoluto)", () => {
    // 1.000.000 → 1.100.000 = +10% (ok en %) pero +$100.001 supera el tope abs.
    const e = evaluarRenovacion(1_000_000, 1_100_001);
    expect(e.autoAprobable).toBe(false);
    expect(e.aumento).toBe(100001);
    expect(e.motivo).toContain("100.000");
  });

  it("aumento de exactamente $100.000 dentro del % → auto-aprobable (borde)", () => {
    // 600.000 → 700.000 = +16,7% y +$100.000 (ambos en el límite).
    const e = evaluarRenovacion(600000, 700000);
    expect(e.aumento).toBe(RENOVACION_TOPE_ABS);
    expect(e.autoAprobable).toBe(true);
  });

  it("supera ambos topes → motivo menciona los dos", () => {
    const e = evaluarRenovacion(500000, 900000); // +80% y +$400.000
    expect(e.autoAprobable).toBe(false);
    expect(e.motivo).toContain("%");
    expect(e.motivo).toContain("100.000");
  });
});
