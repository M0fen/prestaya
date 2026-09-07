// ─────────────────────────────────────────────────────────────────────────
//  LA FRANJA EN VIVO con la regla del 06-09.
//
//  Desde ese día el cobrador ya no PIDE por encima del +20%: coloca y se avisa.
//  La cola de solicitudes queda en 0 para siempre, y con ella la franja del
//  panel —el único aviso que el supervisor ve sin abrir nada— se apagaba justo
//  cuando hay algo que mirar. Acá se fija que los "colocados por encima del
//  +20%" entran a la MISMA franja, marcados como HECHOS: línea propia ("ya
//  está hecho"), título propio, botón "Ver →" y nunca "Aprobar →".
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi } from "vitest";
import { aResumen, lineaPedido, tituloFranja, soloHechos, pedidosNuevos, type ColocadoVivo } from "./avisosPedidos";
import type { SolicitudRenovacion } from "@/lib/data/solicitudesRenovacion";

// `misPedidos` es de servidor ("server-only"): acá solo se prueba su parser puro.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdmin: vi.fn() }));
import { parsearDetalleSobreTecho } from "@/lib/data/misPedidos";

const AHORA = new Date("2026-09-07T12:00:00Z").getTime();

function sol(id: string, solicitadoEn: string): SolicitudRenovacion {
  return {
    id, clienteId: "c-" + id, clienteNombre: "CLIENTE " + id, prestamoAnteriorId: "p-" + id,
    tipo: "renovacion", monto: 5_000, totalDias: 24, frecuencia: "diario", montoAnterior: 4_000,
    solicitadoPorNombre: "Víctor Moralez", solicitadoPor: "u-victor", solicitadoEn, colocadoDespues: null,
  };
}

function hecho(over: Partial<ColocadoVivo> & { id: string }): ColocadoVivo {
  return {
    actorNombre: "Karent Londoño", creadoIso: "2026-09-07T11:30:00Z", clienteNombre: "SONIA TELIS",
    monto: 20_000, montoAnterior: 10_000, tipo: "venta", ...over,
  };
}

describe("la franja con colocaciones YA hechas (regla 06-09)", () => {
  it("sin pedidos y con un hecho, la franja NO está vacía: total 1, item marcado hecho", () => {
    const r = aResumen([], [hecho({ id: "aud-1" })]);
    expect(r.total).toBe(1);
    expect(r.items[0]).toMatchObject({ id: "aud-1", hecho: true, monto: 20_000, montoAnterior: 10_000, cliente: "SONIA TELIS" });
    expect(r.ids).toEqual(["aud-1"]);
  });

  it("mezcla pedidos y hechos en un solo orden por fecha (el más nuevo primero)", () => {
    const r = aResumen(
      [sol("s1", "2026-09-07T09:00:00Z")],
      [hecho({ id: "h1", creadoIso: "2026-09-07T11:00:00Z" }), hecho({ id: "h2", creadoIso: "2026-09-07T08:00:00Z" })],
    );
    expect(r.items.map((i) => i.id)).toEqual(["h1", "s1", "h2"]);
    expect(r.masViejoEn).toBe("2026-09-07T08:00:00Z");
  });

  it("la línea de un hecho dice que YA está hecho, con el salto — nunca 'pide'", () => {
    const [p] = aResumen([], [hecho({ id: "h" })]).items;
    const linea = lineaPedido(p, AHORA);
    expect(linea).toMatch(/vendió \$20\.000 a SONIA TELIS \(tenía \$10\.000, \+100%\) — ya está hecho/);
    expect(linea).not.toMatch(/pide/);
  });

  it("el título cuenta hechos y pedidos por separado", () => {
    const solo = aResumen([], [hecho({ id: "h1" }), hecho({ id: "h2", creadoIso: "2026-09-07T10:00:00Z" })]);
    expect(tituloFranja(solo, AHORA)).toMatch(/^2 créditos colocados por encima del \+20%/);
    const mixta = aResumen([sol("s1", "2026-09-07T09:00:00Z")], [hecho({ id: "h1" })]);
    expect(tituloFranja(mixta, AHORA)).toMatch(/1 pedido de la calle espera tu aprobación · 1 crédito colocado por encima del \+20%/);
  });

  it("soloHechos: true cuando no hay nada que aprobar (el botón pasa a 'Ver →')", () => {
    expect(soloHechos(aResumen([], [hecho({ id: "h" })]))).toBe(true);
    expect(soloHechos(aResumen([sol("s", "2026-09-07T09:00:00Z")], [hecho({ id: "h" })]))).toBe(false);
    expect(soloHechos(aResumen([], []))).toBe(false);
  });

  it("un hecho nuevo suena como nuevo una sola vez (misma huella de ids que los pedidos)", () => {
    const antes = aResumen([], []);
    const despues = aResumen([], [hecho({ id: "h" })]);
    expect(pedidosNuevos(new Set(antes.ids), despues).map((p) => p.id)).toEqual(["h"]);
    expect(pedidosNuevos(new Set(despues.ids), despues)).toEqual([]);
  });
});

describe("parsearDetalleSobreTecho — lo que la puerta escribe, la franja lo lee", () => {
  it("lee tipo, montos y cliente del formato fijo", () => {
    const d = "Renovación: $10.000 → $20.000 (+100%) · umbral $12.000 · 24 diario · cuota $1.000 · a SONIA TELIS · prestamo:c-nuevo";
    expect(parsearDetalleSobreTecho(d)).toEqual({ tipo: "renovacion", montoAnterior: 10_000, monto: 20_000, clienteNombre: "SONIA TELIS" });
    expect(parsearDetalleSobreTecho("Venta: $5.000 → $200.000 (+3900%) · umbral $6.000 · 24 diario · cuota $9.000 · a JUAN PEREZ · prestamo:x").tipo).toBe("venta");
  });

  it("un detalle que no calza no rompe: queda en 0 y 'un cliente'", () => {
    expect(parsearDetalleSobreTecho("otra cosa")).toEqual({ tipo: "renovacion", montoAnterior: 0, monto: 0, clienteNombre: "un cliente" });
  });
});
