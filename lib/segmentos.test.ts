import { describe, it, expect } from "vitest";
import {
  clienteEnSegmento,
  esSegmentoTodos,
  normalizarSegmento,
  describirSegmento,
  type ClienteSegmentable,
  type DefinicionSegmento,
} from "./segmentos";

const cli = (over: Partial<ClienteSegmentable> = {}): ClienteSegmentable => ({
  id: "cli-1",
  calificacion: "bueno",
  zonaId: "zona-centro",
  cobradorId: "cob-9",
  alDia: true,
  ...over,
});

describe("esSegmentoTodos", () => {
  it("null / vacío / estado 'todos' → todos", () => {
    expect(esSegmentoTodos(null)).toBe(true);
    expect(esSegmentoTodos(undefined)).toBe(true);
    expect(esSegmentoTodos({})).toBe(true);
    expect(esSegmentoTodos({ estadoCredito: "todos", calificaciones: [], zonas: [] })).toBe(true);
  });
  it("con cualquier dimensión → no es 'todos'", () => {
    expect(esSegmentoTodos({ calificaciones: ["excelente"] })).toBe(false);
    expect(esSegmentoTodos({ estadoCredito: "al_dia" })).toBe(false);
    expect(esSegmentoTodos({ excluir: ["x"] })).toBe(false);
  });
});

describe("clienteEnSegmento — default seguro", () => {
  it("segmento nulo/vacío le llega a TODOS", () => {
    expect(clienteEnSegmento(cli(), null)).toBe(true);
    expect(clienteEnSegmento(cli(), {})).toBe(true);
    expect(clienteEnSegmento(cli(), { estadoCredito: "todos" })).toBe(true);
  });
});

describe("clienteEnSegmento — dimensiones (AND entre ellas, OR dentro)", () => {
  it("calificación: entra solo si está en la lista", () => {
    expect(clienteEnSegmento(cli({ calificacion: "excelente" }), { calificaciones: ["excelente", "bueno"] })).toBe(true);
    expect(clienteEnSegmento(cli({ calificacion: "riesgo" }), { calificaciones: ["excelente", "bueno"] })).toBe(false);
    expect(clienteEnSegmento(cli({ calificacion: null }), { calificaciones: ["excelente"] })).toBe(false);
  });
  it("zona: entra solo si su zona está en la lista", () => {
    expect(clienteEnSegmento(cli({ zonaId: "zona-centro" }), { zonas: ["zona-centro"] })).toBe(true);
    expect(clienteEnSegmento(cli({ zonaId: "zona-sur" }), { zonas: ["zona-centro"] })).toBe(false);
    expect(clienteEnSegmento(cli({ zonaId: null }), { zonas: ["zona-centro"] })).toBe(false);
  });
  it("cobrador: entra solo si su cobrador está en la lista", () => {
    expect(clienteEnSegmento(cli({ cobradorId: "cob-9" }), { cobradores: ["cob-9", "cob-3"] })).toBe(true);
    expect(clienteEnSegmento(cli({ cobradorId: "cob-1" }), { cobradores: ["cob-9"] })).toBe(false);
  });
  it("estado del crédito: al_dia / con_pendientes", () => {
    expect(clienteEnSegmento(cli({ alDia: true }), { estadoCredito: "al_dia" })).toBe(true);
    expect(clienteEnSegmento(cli({ alDia: false }), { estadoCredito: "al_dia" })).toBe(false);
    expect(clienteEnSegmento(cli({ alDia: false }), { estadoCredito: "con_pendientes" })).toBe(true);
    expect(clienteEnSegmento(cli({ alDia: true }), { estadoCredito: "con_pendientes" })).toBe(false);
  });
  it("AND entre dimensiones: debe cumplir TODAS", () => {
    const def: DefinicionSegmento = { calificaciones: ["excelente"], zonas: ["zona-centro"], estadoCredito: "al_dia" };
    expect(clienteEnSegmento(cli({ calificacion: "excelente", zonaId: "zona-centro", alDia: true }), def)).toBe(true);
    // Falla una sola (zona) → fuera.
    expect(clienteEnSegmento(cli({ calificacion: "excelente", zonaId: "zona-sur", alDia: true }), def)).toBe(false);
    // Falla otra (estado) → fuera.
    expect(clienteEnSegmento(cli({ calificacion: "excelente", zonaId: "zona-centro", alDia: false }), def)).toBe(false);
  });
});

describe("clienteEnSegmento — overrides individuales", () => {
  it("excluir gana sobre todo (incluso si cumple las reglas)", () => {
    const def: DefinicionSegmento = { calificaciones: ["bueno"], excluir: ["cli-1"] };
    expect(clienteEnSegmento(cli({ id: "cli-1", calificacion: "bueno" }), def)).toBe(false);
  });
  it("incluir mete a alguien que NO cumple las reglas", () => {
    const def: DefinicionSegmento = { calificaciones: ["excelente"], incluir: ["cli-1"] };
    expect(clienteEnSegmento(cli({ id: "cli-1", calificacion: "riesgo" }), def)).toBe(true);
  });
  it("excluir gana sobre incluir (seguridad)", () => {
    const def: DefinicionSegmento = { incluir: ["cli-1"], excluir: ["cli-1"] };
    expect(clienteEnSegmento(cli({ id: "cli-1" }), def)).toBe(false);
  });
});

describe("normalizarSegmento — saneo de entrada cruda", () => {
  it("descarta calificaciones inválidas y listas vacías", () => {
    const n = normalizarSegmento({ calificaciones: ["excelente", "fantasma"], zonas: [], incluir: ["a", "a", "b"] });
    expect(n.calificaciones).toEqual(["excelente"]);
    expect(n.zonas).toBeNull();
    expect(n.incluir).toEqual(["a", "b"]); // dedup
    expect(n.estadoCredito).toBe("todos");
  });
  it("estadoCredito inválido → 'todos'", () => {
    expect(normalizarSegmento({ estadoCredito: "cualquiera" }).estadoCredito).toBe("todos");
    expect(normalizarSegmento({ estadoCredito: "al_dia" }).estadoCredito).toBe("al_dia");
  });
  it("entrada basura no rompe", () => {
    expect(normalizarSegmento(null).estadoCredito).toBe("todos");
    expect(normalizarSegmento(undefined).calificaciones).toBeNull();
  });
});

describe("describirSegmento — resumen humano", () => {
  it("vacío → 'Todos los clientes'", () => {
    expect(describirSegmento(null)).toBe("Todos los clientes");
    expect(describirSegmento({})).toBe("Todos los clientes");
  });
  it("compone las dimensiones presentes", () => {
    const s = describirSegmento(
      { calificaciones: ["excelente"], zonas: ["z1"], estadoCredito: "al_dia" },
      { zonas: { z1: "Centro" } },
    );
    expect(s).toContain("Excelente");
    expect(s).toContain("Zona Centro");
    expect(s).toContain("Al día");
  });
});
