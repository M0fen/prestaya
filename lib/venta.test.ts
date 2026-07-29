import { describe, it, expect } from "vitest";
import { calcularPlanVenta } from "./venta";

describe("calcularPlanVenta — plan de una venta de tienda (money-critical)", () => {
  it("hornea el interés en la cuota y usa ceil (igual que la vitrina)", () => {
    // Heladera $20.000, 20% interés, 24 cuotas.
    // conInteres = round(20000 * 1.2) = 24000 ; cuota = ceil(24000/24) = 1000.
    const p = calcularPlanVenta({ precio: 20_000, interesPct: 20, cuotas: 24 });
    expect(p.monto).toBe(20_000); // capital financiado
    expect(p.cuota).toBe(1_000);
    expect(p.totalDias).toBe(24);
    expect(p.totalACobrar).toBe(24_000); // cuota × cuotas
  });

  it("todo entero, nunca float (redondea precio, interés y cuota)", () => {
    // 15% sobre 13.333 → 15332.95 → round 15333 ; ceil(15333/12)=1278.
    const p = calcularPlanVenta({ precio: 13_333, interesPct: 15, cuotas: 12 });
    expect(Number.isInteger(p.monto)).toBe(true);
    expect(Number.isInteger(p.cuota)).toBe(true);
    expect(Number.isInteger(p.totalACobrar)).toBe(true);
    expect(p.cuota).toBe(1_278);
    expect(p.totalACobrar).toBe(1_278 * 12);
  });

  it("el total cobrado (cuota×cuotas) NUNCA es menor que el precio con interés", () => {
    // Propiedad clave: con ceil, el negocio nunca cobra de menos (residuo ≥ 0).
    for (const precio of [10_000, 17_777, 25_500, 48_912, 99_999]) {
      for (const interes of [0, 10, 15, 20, 33]) {
        for (const cuotas of [1, 7, 12, 20, 24, 30, 40]) {
          const p = calcularPlanVenta({ precio, interesPct: interes, cuotas });
          const conInteres = Math.round(precio * (1 + interes / 100));
          expect(p.totalACobrar).toBeGreaterThanOrEqual(conInteres);
          // ...pero el residuo por redondeo es acotado (< una cuota).
          expect(p.totalACobrar - conInteres).toBeLessThan(p.cuota);
        }
      }
    }
  });

  it("respeta el plazo override del admin (cuotas distintas al producto)", () => {
    const p = calcularPlanVenta({ precio: 24_000, interesPct: 0, cuotas: 24 }, 12);
    expect(p.totalDias).toBe(12);
    expect(p.cuota).toBe(2_000); // ceil(24000/12)
  });

  it("blinda entradas inválidas: cuotas < 1 cae a 1, precio negativo a 0", () => {
    expect(calcularPlanVenta({ precio: 5_000, interesPct: 10, cuotas: 0 }).totalDias).toBe(1);
    expect(calcularPlanVenta({ precio: -100, interesPct: 10, cuotas: 5 }).monto).toBe(0);
  });
});
