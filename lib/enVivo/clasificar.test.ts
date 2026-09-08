import { describe, expect, it } from "vitest";
import {
  AHORA_MIN,
  RECIENTE_MIN,
  estadoPresencia,
  hace,
  mezclarFeed,
  ordenarPersonas,
  resumenDe,
  type ItemFeed,
  type PersonaVivo,
} from "./clasificar";

const T0 = Date.parse("2026-09-07T13:00:00.000Z");
const hace_ = (min: number) => new Date(T0 - min * 60_000).toISOString();

const persona = (p: Partial<PersonaVivo>): PersonaVivo => ({
  id: p.id ?? "x",
  nombre: p.nombre ?? "X",
  rol: p.rol ?? "cobrador",
  zona: null,
  estado: p.estado ?? "sin_senal",
  ultimaSenalIso: p.ultimaSenalIso ?? null,
  seccionActual: null,
  pathActual: null,
  vistasHoy: p.vistasHoy ?? 0,
  hechosHoy: p.hechosHoy ?? 0,
  cobrosHoy: p.cobrosHoy ?? 0,
  cobradoHoy: p.cobradoHoy ?? 0,
  ultimoHecho: null,
});

const item = (id: string, cuando: string, clase: ItemFeed["clase"] = "hecho", alerta = false): ItemFeed => ({
  id,
  clase,
  tipo: clase === "nav" ? "nav" : "cobro",
  cuando,
  actorId: "a",
  actor: "A",
  rol: "cobrador",
  titulo: id,
  monto: null,
  detalle: null,
  alerta,
});

describe("estadoPresencia", () => {
  it("sin señal → sin_senal", () => {
    expect(estadoPresencia(null, T0)).toBe("sin_senal");
  });
  it("dentro de los 10 min → ahora (el límite incluido)", () => {
    expect(estadoPresencia(hace_(0), T0)).toBe("ahora");
    expect(estadoPresencia(hace_(AHORA_MIN), T0)).toBe("ahora");
  });
  it("entre 10 y 60 min → reciente", () => {
    expect(estadoPresencia(hace_(AHORA_MIN + 1), T0)).toBe("reciente");
    expect(estadoPresencia(hace_(RECIENTE_MIN), T0)).toBe("reciente");
  });
  it("más de una hora (pero hoy) → hoy", () => {
    expect(estadoPresencia(hace_(RECIENTE_MIN + 1), T0)).toBe("hoy");
    expect(estadoPresencia(hace_(600), T0)).toBe("hoy");
  });
});

describe("hace", () => {
  it("dice recién / minutos / horas / días", () => {
    expect(hace(null, T0)).toBe("nunca");
    expect(hace(hace_(0.5), T0)).toBe("recién");
    expect(hace(hace_(3), T0)).toBe("hace 3 min");
    expect(hace(hace_(125), T0)).toBe("hace 2 h");
    expect(hace(hace_(60 * 49), T0)).toBe("hace 2 d");
  });
});

describe("mezclarFeed", () => {
  it("funde fuentes del más nuevo al más viejo, sin repetir ids, con tope", () => {
    const a = [item("h1", hace_(5)), item("h2", hace_(50))];
    const b = [item("n1", hace_(1), "nav"), item("h1", hace_(5))]; // h1 repetido
    const out = mezclarFeed([a, b], 10);
    expect(out.map((i) => i.id)).toEqual(["n1", "h1", "h2"]);
    expect(mezclarFeed([a, b], 2).map((i) => i.id)).toEqual(["n1", "h1"]);
  });
});

describe("resumenDe", () => {
  it("cuenta ahora / hoy / cobrando / hechos / navegaciones", () => {
    const personas = [
      persona({ id: "1", estado: "ahora", cobrosHoy: 3, cobradoHoy: 1500 }),
      persona({ id: "2", estado: "reciente" }),
      persona({ id: "3", estado: "hoy", cobrosHoy: 1, cobradoHoy: 400 }),
      persona({ id: "4", estado: "sin_senal" }),
    ];
    const feed = [item("h1", hace_(1)), item("n1", hace_(2), "nav"), item("h2", hace_(3))];
    expect(resumenDe(personas, feed)).toEqual({
      ahora: 1,
      hoy: 3,
      cobrando: 2,
      cobrado: 1900,
      cobros: 4,
      hechos: 2,
      navegaciones: 1,
      total: 4,
    });
  });
});

describe("ordenarPersonas", () => {
  it("los que están ahora primero; dentro del grupo, la señal más nueva arriba", () => {
    const out = ordenarPersonas([
      persona({ id: "viejo-hoy", estado: "hoy", ultimaSenalIso: hace_(300) }),
      persona({ id: "ahora-2", estado: "ahora", ultimaSenalIso: hace_(8) }),
      persona({ id: "nadie", estado: "sin_senal" }),
      persona({ id: "ahora-1", estado: "ahora", ultimaSenalIso: hace_(1) }),
      persona({ id: "reciente", estado: "reciente", ultimaSenalIso: hace_(30) }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["ahora-1", "ahora-2", "reciente", "viejo-hoy", "nadie"]);
  });
});
