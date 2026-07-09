// Tests del núcleo PURO de raspaditas (promocional, server-decided). Cubren la
// ruleta ponderada (determinista dado rnd) y el tope "una por pago".
import { describe, it, expect } from "vitest";
import {
  elegirPremio,
  raspaditasDisponibles,
  segmentoParaScore,
  resultadoRaspadita,
  scoreAPorcentaje,
  type PremioRaspa,
  type SegmentoRaspa,
} from "./raspadita";

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

// ── Tramos de scoring ──────────────────────────────────────────────────────
const SEG = (
  id: string,
  scoreMin: number,
  scoreMax: number,
  probGanar: number,
  esDefault = false,
  orden = 0,
  activo = true,
): SegmentoRaspa => ({ id, nombre: id, scoreMin, scoreMax, probGanar, esDefault, activo, orden });

describe("scoreAPorcentaje (puntaje 0..1000 → % 0..100)", () => {
  it("mapea /10 y clampa", () => {
    expect(scoreAPorcentaje(900)).toBe(90);
    expect(scoreAPorcentaje(1000)).toBe(100);
    expect(scoreAPorcentaje(0)).toBe(0);
    expect(scoreAPorcentaje(1234)).toBe(100); // clamp
  });
});

describe("segmentoParaScore (elige el tramo por score)", () => {
  const vip = SEG("vip", 90, 100, 100, false, 0);
  const medio = SEG("medio", 50, 89, 40, false, 1);
  const otros = SEG("otros", 0, 100, 10, true, 100);
  const segs = [otros, medio, vip]; // desordenados a propósito

  it("un score en un tramo específico gana ese tramo", () => {
    expect(segmentoParaScore(95, segs)?.id).toBe("vip");
    expect(segmentoParaScore(90, segs)?.id).toBe("vip"); // borde inferior inclusivo
    expect(segmentoParaScore(70, segs)?.id).toBe("medio");
  });

  it("un score sin tramo específico cae en 'Los demás' (default)", () => {
    expect(segmentoParaScore(30, segs)?.id).toBe("otros");
    expect(segmentoParaScore(0, segs)?.id).toBe("otros");
  });

  it("el default NO gana si hay un específico que matchea (aunque también lo cubra)", () => {
    // otros cubre 0..100 pero vip (específico) manda en 95.
    expect(segmentoParaScore(95, segs)?.id).toBe("vip");
  });

  it("ignora tramos inactivos", () => {
    const inactivo = [SEG("vip", 90, 100, 100, false, 0, false), otros];
    expect(segmentoParaScore(95, inactivo)?.id).toBe("otros"); // vip inactivo → default
  });

  it("sin tramos → null", () => {
    expect(segmentoParaScore(95, [])).toBeNull();
  });
});

describe("resultadoRaspadita (probGanar + premio por peso)", () => {
  const premios = [P("desc", 1), P("gracia", 1)]; // 2 beneficios

  it("prob 100 → siempre gana (regalado); elige premio por peso", () => {
    const vip = SEG("vip", 90, 100, 100);
    expect(resultadoRaspadita(vip, [P("regalado", 1)], 0.99, 0)?.id).toBe("regalado");
    expect(resultadoRaspadita(vip, premios, 0.99, 0)?.id).toBe("desc");
    expect(resultadoRaspadita(vip, premios, 0.5, 0.9)?.id).toBe("gracia");
  });

  it("prob 40 → gana si rndGanar<0.4, si no null (nada)", () => {
    const s = SEG("s", 0, 89, 40);
    expect(resultadoRaspadita(s, premios, 0.2, 0)?.id).toBe("desc"); // gana
    expect(resultadoRaspadita(s, premios, 0.4, 0)).toBeNull(); // 0.4 no < 0.4 → pierde
    expect(resultadoRaspadita(s, premios, 0.7, 0)).toBeNull(); // pierde
  });

  it("prob 0 → nunca gana", () => {
    expect(resultadoRaspadita(SEG("s", 0, 100, 0), premios, 0, 0)).toBeNull();
  });

  it("ignora premios 'nada' del pool de ganancia", () => {
    const s = SEG("s", 0, 100, 100);
    // Solo hay un 'nada' → aunque gane por prob, no hay beneficio → null.
    expect(resultadoRaspadita(s, [P("nada", 5)], 0, 0)).toBeNull();
  });

  it("sin tramo → null", () => {
    expect(resultadoRaspadita(null, premios, 0, 0)).toBeNull();
  });
});
