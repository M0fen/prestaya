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

  // ── Base de caja (0105): esperado = base + recaudado − gastos ──
  it("sin base explícita se comporta EXACTO como antes (cero regresión)", () => {
    // 4 args con base=0 ≡ 3 args.
    expect(calcularRendicion(30000, 2000, 28000, 0)).toEqual(calcularRendicion(30000, 2000, 28000));
  });

  it("la base sube el esperado: debe devolver base + cobros − gastos", () => {
    // Arrancó con $5.000 de base, cobró $30.000, gastó $2.000 → debe entregar 33.000.
    const r = calcularRendicion(30000, 2000, 33000, 5000);
    expect(r.esperado).toBe(33000);
    expect(r.diferencia).toBe(0);
    expect(r.estado).toBe("cuadra");
  });

  it("con base, si NO devuelve la base → faltante (se la quedó)", () => {
    // Mismo caso pero entrega solo lo cobrado − gastos (28.000): falta la base.
    const r = calcularRendicion(30000, 2000, 28000, 5000);
    expect(r.esperado).toBe(33000);
    expect(r.diferencia).toBe(-5000);
    expect(r.estado).toBe("faltante");
  });

  it("base con gastos > base+recaudado no deja esperado negativo", () => {
    const r = calcularRendicion(1000, 9000, 0, 2000);
    expect(r.esperado).toBe(0); // max(0, 2000+1000−9000)
    expect(r.estado).toBe("cuadra");
  });
});
