// Tests del núcleo PURO de la línea de comportamiento (caritas). Deriva del
// cartón; umbral configurable. Sin React, sin IO.
import { describe, it, expect } from "vitest";
import {
  comportamientoGeneral,
  caritasUltimas,
  caritaDeDia,
  UMBRAL_ROJA,
} from "./comportamiento";
import type { EstadoDia } from "@/types/cartones";

// Helper: arma días a partir de una lista de estados.
const dias = (estados: EstadoDia[]) =>
  estados.map((estado, i) => ({ dia: i + 1, estado, esHoy: false }));

describe("comportamientoGeneral", () => {
  it("al día (solo pagados y futuros) → verde", () => {
    const g = comportamientoGeneral(dias(["pagado", "pagado", "futuro", "futuro"]));
    expect(g.nivel).toBe("verde");
    expect(g.atrasados).toBe(0);
    expect(g.pendientes).toBe(0);
  });

  it("con un pendiente (abono parcial / hoy) → naranja", () => {
    const g = comportamientoGeneral(dias(["pagado", "pendiente", "futuro"]));
    expect(g.nivel).toBe("naranja");
  });

  it("atraso LEVE (1..umbral−1 días) → naranja", () => {
    const g = comportamientoGeneral(dias(["pagado", "atrasado", "atrasado", "futuro"]));
    expect(g.atrasados).toBe(2);
    expect(g.nivel).toBe("naranja"); // 2 < UMBRAL_ROJA (3)
  });

  it("atraso SERIO (≥ umbral días) → roja", () => {
    const g = comportamientoGeneral(dias(["atrasado", "atrasado", "atrasado"]));
    expect(g.atrasados).toBe(3);
    expect(g.nivel).toBe("roja");
    expect(g.color).toBe("#E06A6A"); // rojo SUAVE (sin alarma)
  });

  it("el umbral es configurable", () => {
    const d = dias(["atrasado", "atrasado"]);
    expect(comportamientoGeneral(d, 2).nivel).toBe("roja"); // baja el umbral
    expect(comportamientoGeneral(d, 5).nivel).toBe("naranja"); // lo sube
  });

  it("UMBRAL_ROJA por defecto es 3", () => {
    expect(UMBRAL_ROJA).toBe(3);
  });
});

describe("caritasUltimas", () => {
  it("excluye los días FUTUROS y toma los últimos n transcurridos", () => {
    const d = dias(["pagado", "pagado", "pendiente", "atrasado", "futuro", "futuro"]);
    const c = caritasUltimas(d, 3);
    expect(c).toHaveLength(3);
    // Últimos 3 transcurridos: pagado(2), pendiente(3), atrasado(4).
    expect(c.map((x) => x.estado)).toEqual(["pagado", "pendiente", "atrasado"]);
    // Ninguno futuro.
    expect(c.some((x) => x.estado === "futuro")).toBe(false);
  });

  it("si hay menos que n, devuelve los que haya", () => {
    const c = caritasUltimas(dias(["pagado"]), 8);
    expect(c).toHaveLength(1);
  });
});

describe("caritaDeDia", () => {
  it("mapea cada estado a una carita y color", () => {
    expect(caritaDeDia({ dia: 1, estado: "pagado", esHoy: false }).color).toBe("#1FA971");
    expect(caritaDeDia({ dia: 2, estado: "pendiente", esHoy: false }).color).toBe("#E8A317");
    expect(caritaDeDia({ dia: 3, estado: "atrasado", esHoy: false }).color).toBe("#E06A6A");
  });
});
