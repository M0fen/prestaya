// Tests del núcleo PURO de la quiniela (promocional). Validación de número y
// cálculo de ganadores. Sin dinero real en ninguna parte.
import { describe, it, expect } from "vitest";
import { numeroValido, normalizarNumero, ganadores } from "./quiniela";

const rango = { min: 0, max: 99 };

describe("numeroValido", () => {
  it("acepta enteros dentro del rango", () => {
    expect(numeroValido(0, rango)).toBe(true);
    expect(numeroValido(99, rango)).toBe(true);
    expect(numeroValido(50, rango)).toBe(true);
  });
  it("rechaza fuera de rango o no enteros", () => {
    expect(numeroValido(-1, rango)).toBe(false);
    expect(numeroValido(100, rango)).toBe(false);
    expect(numeroValido(3.5, rango)).toBe(false);
  });
});

describe("normalizarNumero", () => {
  it("redondea y acota al rango", () => {
    expect(normalizarNumero(150, rango)).toBe(99);
    expect(normalizarNumero(-5, rango)).toBe(0);
    expect(normalizarNumero(42.7, rango)).toBe(43);
  });
});

describe("ganadores", () => {
  it("devuelve los clientes que eligieron el número sorteado", () => {
    const parts = [
      { clienteId: "A", numero: 7 },
      { clienteId: "B", numero: 13 },
      { clienteId: "C", numero: 7 },
    ];
    expect(ganadores(parts, 7)).toEqual(["A", "C"]);
    expect(ganadores(parts, 99)).toEqual([]);
  });
});
