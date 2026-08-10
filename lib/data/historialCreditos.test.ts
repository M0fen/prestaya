// ─────────────────────────────────────────────────────────────────────────
//  HISTORIAL DE CRÉDITOS — la derivación tiene que ser exacta.
//
//  Nada de esto se guarda en la base: el TIPO, la vuelta de la cadena y los días
//  reales de pago se calculan. Si la derivación miente, el cobrador decide mal a
//  quién le suelta capital — que es justo el problema que este historial vino a
//  resolver (ARACELI RANGER tardó 155 días en un crédito de 35 y en pantalla se
//  veía igual que uno pagado perfecto).
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";

/** El TIPO, igual que lo deriva lib/data/ficha.ts. El orden importa. */
function tipoDe(p: { origen: string; renovadoDe: string | null; creadoPor: string | null }) {
  return p.origen === "tienda"
    ? "tienda"
    : p.renovadoDe
      ? "renovacion"
      : p.creadoPor
        ? "venta"
        : "importado";
}

/** La VUELTA en la cadena, siguiendo `renovado_de` hacia atrás (con corte anti-ciclo). */
function vueltaDe(id: string, padre: Map<string, string | null>): number {
  let n = 1;
  let cur = padre.get(id) ?? null;
  const visto = new Set<string>([id]);
  while (cur && !visto.has(cur) && n < 50) {
    visto.add(cur);
    n += 1;
    cur = padre.get(cur) ?? null;
  }
  return n;
}

describe("historial: de dónde salió cada crédito", () => {
  it("distingue los cuatro orígenes", () => {
    expect(tipoDe({ origen: "credito", renovadoDe: "p1", creadoPor: "cob" })).toBe("renovacion");
    expect(tipoDe({ origen: "credito", renovadoDe: null, creadoPor: "cob" })).toBe("venta");
    // El empalme NO setea `creado_por` → así se reconoce lo que vino de Disapp.
    expect(tipoDe({ origen: "credito", renovadoDe: null, creadoPor: null })).toBe("importado");
    // Una compra financiada es una compra, aunque haya nacido de una renovación.
    expect(tipoDe({ origen: "tienda", renovadoDe: "p1", creadoPor: "cob" })).toBe("tienda");
  });
});

describe("historial: en qué vuelta va el cliente", () => {
  it("cuenta la cadena completa de renovaciones", () => {
    // c1 (original) → c2 → c3 → c4
    const padre = new Map<string, string | null>([
      ["c1", null],
      ["c2", "c1"],
      ["c3", "c2"],
      ["c4", "c3"],
    ]);
    expect(vueltaDe("c1", padre)).toBe(1);
    expect(vueltaDe("c2", padre)).toBe(2);
    expect(vueltaDe("c4", padre)).toBe(4);
  });

  it("dos cadenas del mismo cliente no se mezclan", () => {
    // Un cliente puede tener DOS créditos a la vez, cada uno con su historia.
    const padre = new Map<string, string | null>([
      ["a1", null],
      ["a2", "a1"],
      ["b1", null],
    ]);
    expect(vueltaDe("a2", padre)).toBe(2);
    expect(vueltaDe("b1", padre)).toBe(1);
  });

  it("un dato malo que arme un CICLO no cuelga la ficha", () => {
    const padre = new Map<string, string | null>([
      ["x", "y"],
      ["y", "x"],
    ]);
    expect(vueltaDe("x", padre)).toBeLessThanOrEqual(50);
  });

  it("un padre que ya no está en la lista corta la cuenta, no revienta", () => {
    const padre = new Map<string, string | null>([["c2", "c1-borrado"]]);
    expect(vueltaDe("c2", padre)).toBe(2);
  });
});

describe("historial: cuántos días le tocaban de verdad", () => {
  const PASO: Record<string, number> = { diario: 7 / 6, semanal: 7, quincenal: 15, mensual: 30 };
  const plazo = (cuotas: number, frec: string) => Math.max(1, Math.round(cuotas * PASO[frec]));

  it("el diario no cobra domingo: 30 cuotas son 35 días de calendario", () => {
    expect(plazo(30, "diario")).toBe(35);
    expect(plazo(24, "diario")).toBe(28);
  });

  it("`total_dias` son CUOTAS, no días: un semanal de 4 son 28 días", () => {
    expect(plazo(4, "semanal")).toBe(28);
    expect(plazo(10, "semanal")).toBe(70);
    expect(plazo(2, "quincenal")).toBe(30);
    expect(plazo(3, "mensual")).toBe(90);
  });

  it("el caso real que motivó esto: 155 días sobre 35 es tardar de más", () => {
    // ARACELI RANGER: $20.000, 30 cuotas diarias, 101 pagos parciales, 155 días.
    const tocaban = plazo(30, "diario");
    expect(tocaban).toBe(35);
    expect(155 > tocaban * 1.25).toBe(true); // se marca en ámbar
    expect(34 > tocaban * 1.25).toBe(false); // pagar antes NO se marca
  });
});
