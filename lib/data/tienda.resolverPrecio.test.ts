// ─────────────────────────────────────────────────────────────────────────
//  Test de resolverPrecioCliente — la PRIORIDAD del precio de la tienda por
//  segmento (0078). Es plata que ve el cliente: la regla "más específico gana"
//  (individual > zona > calificación > base) se fija con test para que un cambio
//  futuro no invierta el orden y le muestre a alguien el precio equivocado.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { resolverPrecioCliente } from "./tienda";

const BASE = { precio: 10000, interesPct: 20, cuotas: 12 };
const CALIF = { precio: 9500, interesPct: 18, cuotas: 12 };
const ZONA = { precio: 9000, interesPct: 15, cuotas: 12 };
const INDIV = { precio: 8000, interesPct: 10, cuotas: 10 };

describe("resolverPrecioCliente — prioridad individual > zona > calificación > base", () => {
  it("sin overrides → precio base", () => {
    const r = resolverPrecioCliente(BASE, {});
    expect(r.origen).toBe("base");
    expect(r.precio).toBe(10000);
  });

  it("solo calificación → gana la calificación", () => {
    const r = resolverPrecioCliente(BASE, { calificacion: CALIF });
    expect(r.origen).toBe("calificacion");
    expect(r.precio).toBe(9500);
  });

  it("zona presente gana sobre calificación", () => {
    const r = resolverPrecioCliente(BASE, { zona: ZONA, calificacion: CALIF });
    expect(r.origen).toBe("zona");
    expect(r.precio).toBe(9000);
    expect(r.interesPct).toBe(15);
    expect(r.cuotas).toBe(12);
  });

  it("individual gana sobre TODO (zona y calificación)", () => {
    const r = resolverPrecioCliente(BASE, { individual: INDIV, zona: ZONA, calificacion: CALIF });
    expect(r.origen).toBe("individual");
    expect(r.precio).toBe(8000);
    expect(r.cuotas).toBe(10);
  });

  it("individual sin zona/calificación también gana", () => {
    const r = resolverPrecioCliente(BASE, { individual: INDIV });
    expect(r.origen).toBe("individual");
    expect(r.precio).toBe(8000);
  });

  it("overrides null/undefined se ignoran (caen al siguiente en prioridad)", () => {
    const r = resolverPrecioCliente(BASE, { individual: null, zona: undefined, calificacion: CALIF });
    expect(r.origen).toBe("calificacion");
    expect(r.precio).toBe(9500);
  });

  it("cualquier origen distinto de base marca precio personalizado (origen !== 'base')", () => {
    expect(resolverPrecioCliente(BASE, {}).origen === "base").toBe(true);
    expect(resolverPrecioCliente(BASE, { calificacion: CALIF }).origen !== "base").toBe(true);
    expect(resolverPrecioCliente(BASE, { zona: ZONA }).origen !== "base").toBe(true);
    expect(resolverPrecioCliente(BASE, { individual: INDIV }).origen !== "base").toBe(true);
  });
});
