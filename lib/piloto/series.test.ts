import { describe, expect, it } from "vitest";
import { acumular, esDomingo, etiquetaDia, resumenSerie, serieDe, ultimosDias } from "./series";

describe("ultimosDias", () => {
  it("devuelve n días ascendentes terminando en hoy, cruzando el mes", () => {
    expect(ultimosDias("2026-09-02", 4)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
  });
});

describe("serieDe / acumular", () => {
  it("un día sin datos vale 0 (la barra vacía es información)", () => {
    const m = new Map<string, number>();
    acumular(m, "2026-09-01", 500);
    acumular(m, "2026-09-01", 250);
    acumular(m, "2026-09-03");
    expect(serieDe(["2026-09-01", "2026-09-02", "2026-09-03"], m)).toEqual([
      { dia: "2026-09-01", valor: 750 },
      { dia: "2026-09-02", valor: 0 },
      { dia: "2026-09-03", valor: 1 },
    ]);
  });
});

describe("domingos y etiquetas", () => {
  it("2026-09-06 es domingo; 2026-09-07 es lunes", () => {
    expect(esDomingo("2026-09-06")).toBe(true);
    expect(esDomingo("2026-09-07")).toBe(false);
    expect(etiquetaDia("2026-09-07")).toBe("lun 7");
  });
});

describe("resumenSerie", () => {
  it("el promedio hábil no cuenta domingos, el total sí", () => {
    const s = [
      { dia: "2026-09-05", valor: 100 }, // sáb
      { dia: "2026-09-06", valor: 10 }, // dom
      { dia: "2026-09-07", valor: 200 }, // lun
    ];
    expect(resumenSerie(s)).toEqual({ total: 310, promedioHabil: 155, max: 200 });
  });
});
