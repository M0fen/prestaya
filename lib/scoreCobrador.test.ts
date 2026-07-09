// Tests del score de confianza del cobrador (núcleo puro). Verifican que cada
// señal de fuga resta lo esperado, las bandas y la tasa de no-pago.
import { describe, it, expect } from "vitest";
import {
  calcularConfianzaCobrador,
  penalNoPago,
  type SenalesCobrador,
} from "./scoreCobrador";

const LIMPIO: SenalesCobrador = {
  diasActivos: 20,
  rendiciones: 20,
  diasSinRendir: 0,
  faltantes: 0,
  montoFaltante: 0,
  cobros: 200,
  noPagos: 1,
  fueraDeZona: 0,
  sinGps: 0,
  diasAlerta: 0,
  diasObservar: 0,
  floatMaxSinRendir: 0,
};

describe("penalNoPago", () => {
  it("no penaliza con pocas gestiones", () => {
    expect(penalNoPago(3, 3)).toBe(0); // 6 < 10
  });
  it("penaliza proporcional a la tasa, con techo 25", () => {
    expect(penalNoPago(50, 50)).toBe(25); // 50% → 25 (techo)
    expect(penalNoPago(80, 20)).toBe(10); // 20% → 10
  });
});

describe("calcularConfianzaCobrador", () => {
  it("cobrador impecable → 100, intachable, sin motivos", () => {
    const r = calcularConfianzaCobrador(LIMPIO);
    expect(r.puntaje).toBe(100);
    expect(r.banda).toBe("intachable");
    expect(r.motivos).toHaveLength(0);
  });

  it("días sin rendir pegan fuerte", () => {
    const r = calcularConfianzaCobrador({ ...LIMPIO, diasSinRendir: 3 });
    expect(r.puntaje).toBe(100 - 36); // 3×12
    expect(r.motivos[0]).toMatch(/no rindió/);
  });

  it("faltantes: por cantidad + por monto", () => {
    const r = calcularConfianzaCobrador({ ...LIMPIO, faltantes: 2, montoFaltante: 30000 });
    // 2×8 = 16 + floor(30000/10000)=3 → 19
    expect(r.puntaje).toBe(100 - 19);
  });

  it("días de alerta de la bitácora restan", () => {
    const r = calcularConfianzaCobrador({ ...LIMPIO, diasAlerta: 2 });
    expect(r.puntaje).toBe(100 - 24);
    expect(r.banda).toBe("confiable"); // 76
  });

  it("acumula señales y cae a riesgo", () => {
    const r = calcularConfianzaCobrador({
      ...LIMPIO,
      diasSinRendir: 2, // −24
      faltantes: 2,
      montoFaltante: 50000, // −16 −5
      diasAlerta: 2, // −24
      fueraDeZona: 2, // −10
    });
    expect(r.puntaje).toBeLessThan(45);
    expect(r.banda).toBe("riesgo");
    expect(r.motivos.length).toBeGreaterThanOrEqual(4);
  });

  it("tasa de no-pago alta resta y aparece en motivos", () => {
    const r = calcularConfianzaCobrador({ ...LIMPIO, cobros: 40, noPagos: 60 });
    // 60% de 100 gestiones → penal 25 (techo)
    expect(r.puntaje).toBe(75);
    expect(r.tasaNoPago).toBeCloseTo(0.6, 5);
    expect(r.motivos.some((m) => /no pago/i.test(m))).toBe(true);
  });

  it("nunca baja de 0", () => {
    const r = calcularConfianzaCobrador({
      ...LIMPIO,
      diasSinRendir: 20,
      faltantes: 20,
      montoFaltante: 999999,
      diasAlerta: 20,
      fueraDeZona: 20,
      sinGps: 20,
      cobros: 0,
      noPagos: 100,
    });
    expect(r.puntaje).toBe(0);
    expect(r.banda).toBe("riesgo");
  });
});
