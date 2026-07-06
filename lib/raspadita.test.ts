// Tests del núcleo PURO de raspaditas (promocional, server-decided). Cubren la
// ruleta ponderada (determinista dado rnd) y el tope "una por pago".
import { describe, it, expect } from "vitest";
import { elegirPremio, raspaditasDisponibles, type PremioRaspa } from "./raspadita";

const P = (id: string, peso: number, activo = true): PremioRaspa => ({
  id, label: id, tipo: peso > 0 && id !== "nada" ? "beneficio" : "nada", peso, activo,
});

describe("elegirPremio (ruleta ponderada)", () => {
  const premios = [P("a", 1), P("b", 1), P("c", 2)]; // total 4

  it("respeta los tramos de peso según rnd", () => {
    expect(elegirPremio(premios, 0.0)?.id).toBe("a"); // [0,1)/4 → 0..0.25
    expect(elegirPremio(premios, 0.3)?.id).toBe("b"); // 0.25..0.5
    expect(elegirPremio(premios, 0.6)?.id).toBe("c"); // 0.5..1.0
    expect(elegirPremio(premios, 0.999)?.id).toBe("c");
  });

  it("ignora premios inactivos o con peso 0", () => {
    const ps = [P("x", 0), P("y", 5), P("z", 3, false)];
    // Solo "y" es válido → siempre sale "y".
    expect(elegirPremio(ps, 0)?.id).toBe("y");
    expect(elegirPremio(ps, 0.99)?.id).toBe("y");
  });

  it("sin premios válidos → null (no hay jugada)", () => {
    expect(elegirPremio([P("x", 0), P("z", 3, false)], 0.5)).toBeNull();
  });

  it("clampa rnd fuera de rango", () => {
    expect(elegirPremio(premios, -1)?.id).toBe("a");
    expect(elegirPremio(premios, 2)?.id).toBe("c");
  });
});

describe("raspaditasDisponibles (una por pago, con tope de acumulación)", () => {
  it("disponibles = pagos − jugadas, nunca negativo", () => {
    expect(raspaditasDisponibles(5, 2)).toBe(3);
    expect(raspaditasDisponibles(3, 3)).toBe(0);
    expect(raspaditasDisponibles(2, 5)).toBe(0); // nunca negativo
  });

  it("acota al tope de acumulación (no se juntan decenas)", () => {
    // 50 pagos, 0 jugadas → sin tope serían 50; con tope 3, solo 3.
    expect(raspaditasDisponibles(50, 0)).toBe(3);
    expect(raspaditasDisponibles(50, 0, 5)).toBe(5); // tope configurable
    expect(raspaditasDisponibles(50, 48)).toBe(2); // pagos−jugadas < tope manda
  });
});
