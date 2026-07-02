// Tests del núcleo de RENDICIÓN: esperado = recaudado − gastos (>=0), y
// diferencia/estado según lo entregado (cuadra / faltante / sobrante).
import { describe, expect, it } from "vitest";
import { calcularRendicion } from "./rendicion";

describe("calcularRendicion", () => {
  it("entrega exacto lo recaudado (sin gastos) → cuadra", () => {
    const r = calcularRendicion(30000, 0, 30000);
    expect(r.esperado).toBe(30000);
    expect(r.diferencia).toBe(0);
    expect(r.estado).toBe("cuadra");
  });

  it("gastos de ruta bajan lo que debe entregar", () => {
    const r = calcularRendicion(30000, 2000, 28000);
    expect(r.esperado).toBe(28000); // 30.000 − 2.000
    expect(r.diferencia).toBe(0);
    expect(r.estado).toBe("cuadra");
  });

  it("entrega de menos → faltante (diferencia negativa, señal anti-fuga)", () => {
    const r = calcularRendicion(30000, 0, 25000);
    expect(r.esperado).toBe(30000);
    expect(r.diferencia).toBe(-5000);
    expect(r.estado).toBe("faltante");
  });

  it("entrega de más → sobrante", () => {
    const r = calcularRendicion(30000, 1000, 30000);
    expect(r.esperado).toBe(29000);
    expect(r.diferencia).toBe(1000);
    expect(r.estado).toBe("sobrante");
  });

  it("gastos mayores que lo recaudado no dejan un esperado negativo", () => {
    const r = calcularRendicion(1000, 5000, 0);
    expect(r.esperado).toBe(0);
    expect(r.diferencia).toBe(0);
    expect(r.estado).toBe("cuadra");
  });

  it("redondea a peso entero (nada de float)", () => {
    const r = calcularRendicion(1000.6, 0.2, 1000.4);
    expect(Number.isInteger(r.esperado)).toBe(true);
    expect(Number.isInteger(r.diferencia)).toBe(true);
  });
});
