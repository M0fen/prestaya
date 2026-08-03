import { describe, it, expect } from "vitest";
import {
  calcularCuotaCreditoNuevo,
  interesDeBase,
  INTERES_DEFECTO_PCT,
} from "./creditoNuevo";
import { calcularCuotaRenovacion } from "./renovacion";

// Base típica de la cartera real: prestó 10.000, devuelve 12.000 en 24 cuotas (20%).
const BASE = { monto: 10_000, cuota: 500, totalDias: 24 };

describe("interesDeBase", () => {
  it("deriva el interés total del crédito anterior", () => {
    expect(interesDeBase(BASE)).toBe(20); // 500×24 = 12.000 sobre 10.000
  });

  it("reconoce el 0% de la cartera VIP/refinanciada", () => {
    expect(interesDeBase({ monto: 12_000, cuota: 500, totalDias: 24 })).toBe(0);
  });

  it("devuelve null sin base utilizable (no inventa una tasa)", () => {
    expect(interesDeBase(null)).toBeNull();
    expect(interesDeBase({ monto: 0, cuota: 500, totalDias: 24 })).toBeNull();
    expect(interesDeBase({ monto: 10_000, cuota: 0, totalDias: 24 })).toBeNull();
    expect(interesDeBase({ monto: 10_000, cuota: 500, totalDias: 0 })).toBeNull();
  });
});

describe("calcularCuotaCreditoNuevo — CON historial", () => {
  it("arrastra la tasa del último crédito: idéntico a una renovación", () => {
    // El que vuelve no estrena condiciones: paga la misma tasa que ya tenía.
    for (const monto of [5_000, 10_000, 15_000, 37_500, 99_999]) {
      for (const dias of [20, 24, 30]) {
        expect(calcularCuotaCreditoNuevo(BASE, monto, dias, 999)).toBe(
          calcularCuotaRenovacion(BASE, monto, dias),
        );
      }
    }
  });

  it("IGNORA el interés que mande el formulario (la tasa la manda el historial)", () => {
    const conBasura = calcularCuotaCreditoNuevo(BASE, 10_000, 24, 0);
    const conOtraBasura = calcularCuotaCreditoNuevo(BASE, 10_000, 24, 80);
    expect(conBasura).toBe(500);
    expect(conOtraBasura).toBe(500);
  });

  it("mantiene el 0% de un cliente de cartera VIP", () => {
    const vip = { monto: 12_000, cuota: 500, totalDias: 24 };
    expect(calcularCuotaCreditoNuevo(vip, 24_000, 24, 20)).toBe(1_000); // sin interés
  });
});

describe("calcularCuotaCreditoNuevo — SIN historial", () => {
  it("aplica el interés explícito", () => {
    // 10.000 al 20% = 12.000 en 24 cuotas → 500.
    expect(calcularCuotaCreditoNuevo(null, 10_000, 24, 20)).toBe(500);
    // 10.000 al 0% en 20 cuotas → 500.
    expect(calcularCuotaCreditoNuevo(null, 10_000, 20, 0)).toBe(500);
  });

  it("el default de la cartera es 20%", () => {
    expect(INTERES_DEFECTO_PCT).toBe(20);
    expect(calcularCuotaCreditoNuevo(null, 10_000, 24, INTERES_DEFECTO_PCT)).toBe(500);
  });

  it("trata un interés inválido o negativo como 0% (nunca cobra de más por basura)", () => {
    expect(calcularCuotaCreditoNuevo(null, 10_000, 20, Number.NaN)).toBe(500);
    expect(calcularCuotaCreditoNuevo(null, 10_000, 20, -50)).toBe(500);
    expect(calcularCuotaCreditoNuevo(null, 10_000, 20, Infinity)).toBe(500);
  });

  it("una base incompleta cae al camino sin historial (no divide por cero)", () => {
    const cuota = calcularCuotaCreditoNuevo({ monto: 0, cuota: 0, totalDias: 0 }, 10_000, 24, 20);
    expect(cuota).toBe(500);
  });
});

describe("calcularCuotaCreditoNuevo — invariantes de dinero", () => {
  it("SIEMPRE devuelve un entero (nunca centavos en el libro)", () => {
    const casos: [number, number, number][] = [
      [7_333, 23, 17], [1, 30, 20], [99_999, 24, 20], [12_345, 7, 33],
    ];
    for (const [monto, dias, i] of casos) {
      expect(Number.isInteger(calcularCuotaCreditoNuevo(null, monto, dias, i))).toBe(true);
      expect(Number.isInteger(calcularCuotaCreditoNuevo(BASE, monto, dias, i))).toBe(true);
    }
  });

  it("devuelve 0 con términos inválidos (el llamador corta antes de escribir)", () => {
    expect(calcularCuotaCreditoNuevo(BASE, 0, 24, 20)).toBe(0);
    expect(calcularCuotaCreditoNuevo(BASE, -10_000, 24, 20)).toBe(0);
    expect(calcularCuotaCreditoNuevo(BASE, 10_000, 0, 20)).toBe(0);
    expect(calcularCuotaCreditoNuevo(null, 10_000, -5, 20)).toBe(0);
  });

  it("nunca produce una cuota negativa", () => {
    for (const monto of [1, 100, 50_000]) {
      for (const dias of [1, 24, 400]) {
        expect(calcularCuotaCreditoNuevo(null, monto, dias, 20)).toBeGreaterThanOrEqual(0);
        expect(calcularCuotaCreditoNuevo(BASE, monto, dias, 20)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
