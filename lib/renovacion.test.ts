// Test del núcleo de RENOVACIÓN: la cuota del nuevo crédito arrastra la tasa
// del anterior. Es dinero: se fija con números redondos y bordes inválidos.
import { describe, expect, it } from "vitest";
import {
  calcularCuotaRenovacion,
  tasaImplicita,
  evaluarRenovacion,
  topeAumentoPct,
  RENOVACION_CAP_TOTAL,
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

describe("topeAumentoPct (escalonado por tramo del monto anterior)", () => {
  it("≤ 30.000 → 20%", () => {
    expect(topeAumentoPct(30000)).toBe(20);
    expect(topeAumentoPct(10000)).toBe(20);
  });
  it("30.001–60.000 → 15%", () => {
    expect(topeAumentoPct(30001)).toBe(15);
    expect(topeAumentoPct(60000)).toBe(15);
  });
  it("60.001–90.000 → 10%", () => {
    expect(topeAumentoPct(60001)).toBe(10);
    expect(topeAumentoPct(90000)).toBe(10);
  });
  it("> 90.000 → 0% (ya en el máximo)", () => {
    expect(topeAumentoPct(90001)).toBe(0);
    expect(topeAumentoPct(100000)).toBe(0);
  });
});

describe("evaluarRenovacion (tramo escalonado + cap $100.000)", () => {
  it("mismo monto o menos → auto-aprobable", () => {
    expect(evaluarRenovacion(50000, 50000).autoAprobable).toBe(true);
    expect(evaluarRenovacion(50000, 40000).autoAprobable).toBe(true);
  });

  it("tramo ≤30k: +20% en el borde → auto-aprobable; +21% → excede", () => {
    const ok = evaluarRenovacion(25000, 30000); // +20%
    expect(ok.autoAprobable).toBe(true);
    expect(ok.topePct).toBe(20);
    const no = evaluarRenovacion(25000, 30250); // +21%
    expect(no.autoAprobable).toBe(false);
    expect(no.excedePct).toBe(true);
    expect(no.motivo).toContain("20%");
  });

  it("tramo 31–60k: máximo +15%", () => {
    expect(evaluarRenovacion(50000, 57500).autoAprobable).toBe(true); // +15%
    const no = evaluarRenovacion(50000, 58000); // +16%
    expect(no.autoAprobable).toBe(false);
    expect(no.motivo).toContain("15%");
  });

  it("tramo 61–90k: máximo +10%", () => {
    expect(evaluarRenovacion(80000, 88000).autoAprobable).toBe(true); // +10%
    expect(evaluarRenovacion(80000, 89000).autoAprobable).toBe(false); // +11,25%
  });

  it("tramo >90k: sin aumento (0%); mismo monto sí, más no", () => {
    expect(evaluarRenovacion(95000, 95000).autoAprobable).toBe(true);
    const no = evaluarRenovacion(95000, 96000);
    expect(no.autoAprobable).toBe(false);
    expect(no.topePct).toBe(0);
  });

  it("CAP $100.000: superar el total marca superaCap (duro para todos)", () => {
    const e = evaluarRenovacion(90000, 100001);
    expect(e.superaCap).toBe(true);
    expect(e.autoAprobable).toBe(false);
    expect(e.motivo).toContain("100.000");
    // Exactamente en el cap NO lo supera.
    expect(evaluarRenovacion(90000, RENOVACION_CAP_TOTAL).superaCap).toBe(false);
  });
});
