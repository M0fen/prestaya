// Tests del núcleo PURO de la quiniela (promocional). Validación de número y
// cálculo de ganadores. Sin dinero real en ninguna parte.
import { describe, it, expect } from "vitest";
import { numeroValido, normalizarNumero, ganadores, numeroSuerte, formatearSuerte, numeroGanadorAlAzar } from "./quiniela";

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

  it("modalidad mixta: FORZAR una persona la hace ganar aunque no tenga el número", () => {
    const parts = [
      { clienteId: "A", numero: 7 },
      { clienteId: "B", numero: 13 },
      { clienteId: "C", numero: 7 },
    ];
    // Sale el 7 (ganan A y C) y además el admin fuerza a B → B gana igual.
    expect(new Set(ganadores(parts, 7, ["B"]))).toEqual(new Set(["A", "C", "B"]));
    // Forzar a alguien que YA tenía el número no lo duplica.
    expect(ganadores(parts, 7, ["A"]).sort()).toEqual(["A", "C"]);
    // Forzar a quien NO participó no lo premia (no se puede premiar a quien no jugó).
    expect(ganadores(parts, 99, ["Z"])).toEqual([]);
    // Solo forzados (número que nadie tiene): gana únicamente el forzado real.
    expect(ganadores(parts, 500, ["B"])).toEqual(["B"]);
  });
});

describe("numeroGanadorAlAzar — sortea ENTRE participantes (siempre hay ganador)", () => {
  it("sin participantes → null (no se puede sortear)", () => {
    expect(numeroGanadorAlAzar([])).toBeNull();
  });

  it("SIEMPRE devuelve un número que ALGUIEN tiene (nunca 'sin ganador')", () => {
    const nums = [42, 7, 999, 500];
    // Barremos todo el rango de aleatorio(): cualquier valor cae en un participante.
    for (const r of [0, 0.24, 0.25, 0.5, 0.74, 0.99]) {
      const g = numeroGanadorAlAzar(nums, () => r);
      expect(nums).toContain(g);
    }
  });

  it("mapea el azar al índice correcto", () => {
    const nums = [10, 20, 30, 40];
    expect(numeroGanadorAlAzar(nums, () => 0)).toBe(10); // primer índice
    expect(numeroGanadorAlAzar(nums, () => 0.5)).toBe(30); // mitad
    expect(numeroGanadorAlAzar(nums, () => 0.999)).toBe(40); // último
  });

  it("aleatorio()==1 (borde) no se sale del arreglo", () => {
    expect(numeroGanadorAlAzar([5, 6, 7], () => 1)).toBe(7);
  });

  it("el número sorteado siempre produce ≥1 ganador con ganadores()", () => {
    const parts = [
      { clienteId: "A", numero: 42 },
      { clienteId: "B", numero: 7 },
      { clienteId: "C", numero: 42 },
    ];
    const g = numeroGanadorAlAzar(parts.map((p) => p.numero), () => 0); // → 42
    expect(ganadores(parts, g!).length).toBeGreaterThanOrEqual(1);
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
