// Tests del núcleo PURO de la mascota: catálogo, decaimiento del cariño (nunca
// baja de 0, es suave), ánimo/mensaje amable y desbloqueo de accesorios.
import { describe, expect, it } from "vitest";
import {
  ESPECIES,
  especiePorId,
  ESPECIE_DEFAULT,
  accesoriosDisponibles,
  accesorioPorId,
  carinoActual,
  estadoAnimo,
  aplicarInteraccion,
  CARINO_MAX,
} from "./mascota";

describe("mascota — catálogo", () => {
  it("hay al menos 3 especies elegibles y todas tienen paleta y orejas", () => {
    expect(ESPECIES.length).toBeGreaterThanOrEqual(3);
    for (const e of ESPECIES) {
      expect(e.paleta.cuerpo).toMatch(/^#/);
      expect(e.orejas).toBeTruthy();
    }
  });

  it("especiePorId cae al default si el id no existe", () => {
    expect(especiePorId("michi").id).toBe("michi");
    expect(especiePorId("no-existe")).toBe(ESPECIE_DEFAULT);
    expect(especiePorId(null)).toBe(ESPECIE_DEFAULT);
  });

  it("los accesorios se desbloquean por etapa (crecimiento por pagos reales)", () => {
    expect(accesoriosDisponibles(0).some((a) => a.id === "corona")).toBe(false);
    expect(accesoriosDisponibles(3).some((a) => a.id === "corona")).toBe(true);
    expect(accesorioPorId("corona").etapaMin).toBe(3);
  });
});

describe("mascota — cariño (decaimiento suave, sin culpa)", () => {
  const HOY = new Date("2026-07-02T12:00:00Z");

  it("sin última interacción, el cariño es el guardado", () => {
    expect(carinoActual(80, null, HOY)).toBe(80);
  });

  it("decae con las horas pero nunca baja de 0", () => {
    const hace10h = new Date(HOY.getTime() - 10 * 3_600_000).toISOString();
    const c = carinoActual(80, hace10h, HOY);
    expect(c).toBeLessThan(80);
    expect(c).toBeGreaterThan(0);

    const hace1semana = new Date(HOY.getTime() - 7 * 24 * 3_600_000).toISOString();
    expect(carinoActual(80, hace1semana, HOY)).toBe(0);
  });

  it("es suave: tras una noche (12 h) sigue habiendo bastante cariño", () => {
    const hace12h = new Date(HOY.getTime() - 12 * 3_600_000).toISOString();
    expect(carinoActual(90, hace12h, HOY)).toBeGreaterThan(60);
  });

  it("interactuar sube el cariño con tope en el máximo", () => {
    expect(aplicarInteraccion(50, "jugar")).toBe(61);
    expect(aplicarInteraccion(CARINO_MAX - 2, "jugar")).toBe(CARINO_MAX);
  });
});

describe("mascota — ánimo y mensaje", () => {
  it("cariño alto → feliz; cariño muy bajo → mensaje cálido, no culpa", () => {
    expect(estadoAnimo(90, "Kiwi").animo).toBe("feliz");
    const bajo = estadoAnimo(3, "Kiwi");
    expect(bajo.animo).toBe("dormido");
    expect(bajo.mensaje.toLowerCase()).not.toContain("no pag");
    expect(bajo.mensaje).toContain("Kiwi");
  });

  it("usa un nombre por defecto si está vacío", () => {
    expect(estadoAnimo(90, "").mensaje).toContain("tu mascota");
  });
});
