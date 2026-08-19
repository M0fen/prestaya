import { describe, it, expect } from "vitest";
import { aResumen, pedidosNuevos, pctAumento, hace, lineaPedido, tituloFranja, nombreCorto, MAX_ITEMS } from "./avisosPedidos";
import type { SolicitudRenovacion } from "@/lib/data/solicitudesRenovacion";

const AHORA = new Date("2026-08-19T15:00:00Z").getTime();

function sol(p: Partial<SolicitudRenovacion> & { id: string; solicitadoEn: string }): SolicitudRenovacion {
  return {
    id: p.id,
    clienteId: p.clienteId ?? "c-" + p.id,
    clienteNombre: p.clienteNombre ?? "CLIENTE " + p.id,
    prestamoAnteriorId: p.prestamoAnteriorId ?? "p-" + p.id,
    tipo: p.tipo ?? "renovacion",
    monto: p.monto ?? 5_000,
    totalDias: p.totalDias ?? 24,
    frecuencia: p.frecuencia ?? "diario",
    montoAnterior: p.montoAnterior ?? 4_000,
    solicitadoPorNombre: "solicitadoPorNombre" in p ? (p.solicitadoPorNombre ?? null) : "Víctor Moralez",
    solicitadoPor: p.solicitadoPor ?? "u-victor",
    solicitadoEn: p.solicitadoEn,
    colocadoDespues: p.colocadoDespues ?? null,
  };
}

describe("aResumen — la cola completa al resumen de la franja", () => {
  it("vacía → total 0, sin items, sin más viejo", () => {
    expect(aResumen([])).toEqual({ total: 0, items: [], ids: [], masViejoEn: null });
  });

  it("`ids` trae TODOS los pendientes aunque `items` corte a 5 — el 6º no puede sonar como nuevo al drenar la cola", () => {
    const muchos = Array.from({ length: 7 }, (_, i) =>
      sol({ id: `s${i}`, solicitadoEn: `2026-08-19T0${i}:00:00Z` }),
    );
    const r1 = aResumen(muchos);
    expect(r1.ids).toHaveLength(7);
    // El navegador siembra `conocidos` con r1.ids. Se resuelve el más nuevo →
    // el viejo s0 entra a la ventana de items… y NO es nuevo.
    const r2 = aResumen(muchos.filter((s) => s.id !== "s6"));
    expect(pedidosNuevos(new Set(r1.ids), r2)).toEqual([]);
  });

  it("ordena del más nuevo al más viejo y marca el más viejo aunque la fuente venga desordenada", () => {
    const r = aResumen([
      sol({ id: "a", solicitadoEn: "2026-08-19T10:00:00Z" }),
      sol({ id: "b", solicitadoEn: "2026-08-19T14:00:00Z" }),
      sol({ id: "c", solicitadoEn: "2026-08-18T00:00:00Z" }),
    ]);
    expect(r.total).toBe(3);
    expect(r.items.map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(r.masViejoEn).toBe("2026-08-18T00:00:00Z");
  });

  it("corta los items a MAX_ITEMS pero el total sigue diciendo cuántos hay", () => {
    const muchos = Array.from({ length: 12 }, (_, i) => sol({ id: `s${i}`, solicitadoEn: `2026-08-19T0${i % 10}:00:00Z` }));
    const r = aResumen(muchos);
    expect(r.total).toBe(12);
    expect(r.items).toHaveLength(MAX_ITEMS);
  });

  it("redondea montos a peso entero (nunca float en pantalla)", () => {
    const r = aResumen([sol({ id: "x", solicitadoEn: "2026-08-19T10:00:00Z", monto: 5000.4, montoAnterior: 3999.6 })]);
    expect(r.items[0].monto).toBe(5000);
    expect(r.items[0].montoAnterior).toBe(4000);
  });
});

describe("pedidosNuevos — solo lo que NO se vio todavía molesta", () => {
  const r = aResumen([
    sol({ id: "viejo", solicitadoEn: "2026-08-19T10:00:00Z" }),
    sol({ id: "nuevo", solicitadoEn: "2026-08-19T14:59:00Z" }),
  ]);
  it("al abrir el panel todo es conocido: nada nuevo", () => {
    expect(pedidosNuevos(new Set(["viejo", "nuevo"]), r)).toEqual([]);
  });
  it("entra uno que no estaba → ese solo", () => {
    expect(pedidosNuevos(new Set(["viejo"]), r).map((p) => p.id)).toEqual(["nuevo"]);
  });
  it("uno que se resolvió y desapareció no cuenta como nuevo ni rompe nada", () => {
    expect(pedidosNuevos(new Set(["viejo", "nuevo", "resuelto"]), r)).toEqual([]);
  });
});

describe("pctAumento / hace / nombreCorto", () => {
  it("+25% de 4.000 a 5.000; sin anterior → null; baja → negativo", () => {
    expect(pctAumento(5_000, 4_000)).toBe(25);
    expect(pctAumento(5_000, 0)).toBeNull();
    expect(pctAumento(3_000, 4_000)).toBe(-25);
  });
  it("hace: recién / min / h / días", () => {
    expect(hace(new Date(AHORA - 20_000).toISOString(), AHORA)).toBe("recién");
    expect(hace(new Date(AHORA - 12 * 60_000).toISOString(), AHORA)).toBe("hace 12 min");
    expect(hace(new Date(AHORA - 2 * 3_600_000).toISOString(), AHORA)).toBe("hace 2 h");
    expect(hace(new Date(AHORA - 26 * 3_600_000).toISOString(), AHORA)).toBe("hace 1 día");
    expect(hace(new Date(AHORA - 50 * 3_600_000).toISOString(), AHORA)).toBe("hace 2 días");
    expect(hace("basura", AHORA)).toBe("");
  });
  it("nombreCorto toma el primer nombre", () => {
    expect(nombreCorto("Víctor Moralez")).toBe("Víctor");
    expect(nombreCorto("  María  Artunduaga ")).toBe("María");
  });
});

describe("lineaPedido / tituloFranja — lo que lee el supervisor de un vistazo", () => {
  it("renovación con anterior: quién, cuánto, a quién, tenía, % y hace cuánto", () => {
    const [p] = aResumen([
      sol({ id: "v", solicitadoEn: new Date(AHORA - 12 * 60_000).toISOString(), clienteNombre: "MARIA PEREIRA", monto: 5_000, montoAnterior: 4_000 }),
    ]).items;
    expect(lineaPedido(p, AHORA)).toBe("Víctor pide renovar $5.000 a MARIA PEREIRA (tenía $4.000, +25%) · hace 12 min");
  });
  it("venta sin anterior legible: sin paréntesis, sin cobrador → 'Un cobrador'", () => {
    const [p] = aResumen([
      sol({ id: "v", solicitadoEn: new Date(AHORA - 60_000).toISOString(), tipo: "venta", montoAnterior: 0, solicitadoPorNombre: null, clienteNombre: "JUAN" }),
    ]).items;
    expect(lineaPedido(p, AHORA)).toBe("Un cobrador pide vender $5.000 a JUAN · hace 1 min");
  });
  it("título: singular sin repetir el 'hace'; plural con el más viejo", () => {
    const uno = aResumen([sol({ id: "a", solicitadoEn: new Date(AHORA - 3_600_000).toISOString() })]);
    expect(tituloFranja(uno, AHORA)).toBe("1 pedido de la calle espera tu aprobación");
    const dos = aResumen([
      sol({ id: "a", solicitadoEn: new Date(AHORA - 39 * 3_600_000).toISOString() }),
      sol({ id: "b", solicitadoEn: new Date(AHORA - 60_000).toISOString() }),
    ]);
    expect(tituloFranja(dos, AHORA)).toBe("2 pedidos de la calle esperan tu aprobación · el más viejo hace 1 día");
    expect(tituloFranja(aResumen([]), AHORA)).toBe("");
  });
});
