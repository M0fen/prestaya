// Tests del núcleo PURO de la quiniela (promocional). Validación de número y
// cálculo de ganadores. Sin dinero real en ninguna parte.
import { describe, it, expect } from "vitest";
import { numeroValido, normalizarNumero, ganadores, numeroSuerte, formatearSuerte } from "./quiniela";

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

describe("numeroSuerte (últimos 3 dígitos del número de registro)", () => {
  it("toma los últimos 3 dígitos", () => {
    expect(numeroSuerte(1042)).toBe(42);   // registro 1042 → 042
    expect(numeroSuerte(1000)).toBe(0);     // → 000
    expect(numeroSuerte(1999)).toBe(999);
    expect(numeroSuerte(13579)).toBe(579);
  });
  it("null/indefinido/NaN → null (sin registro aún)", () => {
    expect(numeroSuerte(null)).toBeNull();
    expect(numeroSuerte(undefined)).toBeNull();
    expect(numeroSuerte(Number.NaN)).toBeNull();
  });
});

describe("formatearSuerte (3 dígitos con ceros)", () => {
  it("rellena con ceros a la izquierda", () => {
    expect(formatearSuerte(42)).toBe("042");
    expect(formatearSuerte(0)).toBe("000");
    expect(formatearSuerte(999)).toBe("999");
  });
  it("null → guion", () => {
    expect(formatearSuerte(null)).toBe("—");
  });
});
