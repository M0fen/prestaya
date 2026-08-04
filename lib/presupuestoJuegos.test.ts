// ─────────────────────────────────────────────────────────────────────────
//  La calculadora de presupuesto decide cuánta plata se deja en la calle:
//  si miente, el dueño regala de más creyendo que gasta poco. Estos tests
//  fijan la matemática contra el sorteo REAL del servidor (lib/raspadita.ts).
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  costoDeTramo,
  simularRegalo,
  proyectarMes,
  semaforo,
  totalDe,
  type PremioConCosto,
} from "./presupuestoJuegos";
import type { SegmentoRaspa } from "./raspadita";

const tramo = (p: Partial<SegmentoRaspa> = {}): SegmentoRaspa => ({
  id: "t1",
  nombre: "Los demás",
  scoreMin: 0,
  scoreMax: 100,
  probGanar: 40,
  esDefault: true,
  activo: true,
  orden: 0,
  ...p,
});

const premio = (p: Partial<PremioConCosto> = {}): PremioConCosto => ({
  id: `p-${Math.random()}`,
  label: "premio",
  tipo: "beneficio",
  peso: 1,
  activo: true,
  costo: 0,
  ...p,
});

describe("costoDeTramo — el costo promedio de UNA jugada", () => {
  it("pondera por PESO, igual que la ruleta del servidor", () => {
    // 75% de las veces sale el de $100, 25% el de $500 → si gana, $200 promedio.
    // Con 50% de chance de ganar, la jugada cuesta $100 en promedio.
    const r = costoDeTramo(tramo({ probGanar: 50 }), [
      premio({ peso: 75, costo: 100 }),
      premio({ peso: 25, costo: 500 }),
    ]);
    expect(r.costoSiGana).toBe(200);
    expect(r.costoEsperado).toBe(100);
    expect(r.costoMaximo).toBe(500); // el peor caso de una jugada
  });

  it("los premios 'nada' NO cuestan (no entran a la ruleta)", () => {
    const r = costoDeTramo(tramo({ probGanar: 100 }), [
      premio({ tipo: "nada", peso: 60, costo: 9999 }),
      premio({ peso: 40, costo: 300 }),
    ]);
    expect(r.costoSiGana).toBe(300);
    expect(r.costoEsperado).toBe(300);
  });

  it("un premio inactivo o con peso 0 no se puede ganar → no cuesta", () => {
    const r = costoDeTramo(tramo({ probGanar: 100 }), [
      premio({ peso: 10, costo: 100 }),
      premio({ peso: 0, costo: 5000 }),
      premio({ peso: 50, costo: 7000, activo: false }),
    ]);
    expect(r.costoEsperado).toBe(100);
    expect(r.premiosActivos).toBe(1);
  });

  it("probGanar 0 → no se gasta nada, aunque haya premios carísimos", () => {
    const r = costoDeTramo(tramo({ probGanar: 0 }), [premio({ peso: 1, costo: 100000 })]);
    expect(r.costoEsperado).toBe(0);
  });

  it("CAZA LA CONFIG ROTA: puede ganar pero no hay premios cargados", () => {
    const r = costoDeTramo(tramo({ probGanar: 40 }), [premio({ tipo: "nada", peso: 10, costo: 0 })]);
    expect(r.sinPremios).toBe(true); // el cliente raspa y no recibe nada
  });
});

describe("simularRegalo — cuánto dejo en la calle ANTES de confirmar", () => {
  it("proyecta el costo esperado y el techo del peor caso", () => {
    const t = costoDeTramo(tramo({ probGanar: 40 }), [
      premio({ peso: 75, costo: 200 }),
      premio({ peso: 25, costo: 1000 }),
    ]);
    // si gana: 0,75×200 + 0,25×1000 = 400 → esperado por jugada: 40% × 400 = 160
    const s = simularRegalo(500, t);
    expect(s.costoEsperado).toBe(80_000); // 500 × 160
    expect(s.costoPeorCaso).toBe(500_000); // 500 × 1000 (todas ganan lo más caro)
    expect(s.ganadoresEsperados).toBe(200); // 40% de 500
  });

  it("avisa cuando los premios no tienen costo cargado (la proyección sería mentira)", () => {
    const t = costoDeTramo(tramo({ probGanar: 50 }), [premio({ peso: 1, costo: 0 })]);
    const s = simularRegalo(100, t);
    expect(s.costoEsperado).toBe(0);
    expect(s.avisos.join(" ")).toMatch(/no tienen costo cargado/i);
  });

  it("regalar 0 no cuesta nada", () => {
    const t = costoDeTramo(tramo(), [premio({ peso: 1, costo: 500 })]);
    expect(simularRegalo(0, t).costoEsperado).toBe(0);
  });
});

describe("proyectarMes", () => {
  it("estima el cierre del mes con lo que va corrido", () => {
    expect(proyectarMes(5000, 5, 30)).toBe(30_000);
  });

  it("nunca proyecta MENOS de lo ya gastado (lo gastado es un piso)", () => {
    expect(proyectarMes(90_000, 30, 30)).toBe(90_000);
  });
});

describe("semaforo del tope mensual", () => {
  it("sin tope no inventa alarmas", () => {
    expect(semaforo(50_000, 0).estado).toBe("sin-tope");
  });

  it("avisa CERCA desde el 80% (cuando todavía se puede decidir)", () => {
    expect(semaforo(80_000, 100_000).estado).toBe("cerca");
    expect(semaforo(79_000, 100_000).estado).toBe("ok");
  });

  it("marca excedido y dice por cuánto", () => {
    const s = semaforo(120_000, 100_000);
    expect(s.estado).toBe("excedido");
    expect(s.disponible).toBe(0);
    expect(s.mensaje).toContain("20.000");
  });
});

describe("totalDe", () => {
  it("suma los cuatro juegos", () => {
    const t = totalDe({
      etiqueta: "Hoy",
      raspaditas: 3, raspaditasCosto: 600,
      quinielas: 1, quinielasCosto: 1000,
      rifas: 0, rifasCosto: 0,
      estrellas: 2, estrellasCosto: 400,
    });
    expect(t.total).toBe(2000);
  });
});
