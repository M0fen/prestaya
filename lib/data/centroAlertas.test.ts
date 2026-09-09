// ─────────────────────────────────────────────────────────────────────────
//  El Centro de alertas NOMBRA a la persona: "Fulano tiene $X sin rendir".
//  Esa frase tiene que decir lo que le quedó EN LA MANO, no lo que cobró.
//
//  Cuando el cobrador renueva o vende en la calle, ese capital sale de la plata
//  que acaba de cobrar. `recaudado` es el bruto (un hecho) y `colocado` viaja
//  aparte justamente para que cada pantalla reste (rendicion.ts:673). Esta era la
//  única pantalla que usaba el bruto — y es la que acusa con nombre y apellido.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("./noPagoSospechoso", () => ({ getNoPagosSospechososHoy: async () => [] }));
vi.mock("./alcance", async () => ({
  alcanceDelActor: async () => ({ global: true }),
}));

import { getCentroAlertas } from "./centroAlertas";

/** Doble de PostgREST que responde vacío a cualquier cadena: el Centro de alertas
 *  solo va a la base por los desembolsos del día, que acá no interesan. */
const vacio: Record<string, unknown> = {};
for (const m of ["select", "eq", "gte", "lte", "in", "is", "not", "order", "limit"]) vacio[m] = () => vacio;
vacio.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
const db = { from: () => vacio } as unknown as SupabaseClient;
const ALCANCE = { global: true } as never;

/** Resumen de rendiciones mínimo: solo lo que mira el Centro de alertas. */
const rendCon = (pendientes: unknown[]) =>
  ({ rendidas: [], pendientes, disponible: true } as never);
const controlVacio = { ranking: [], alertas: [], sinGps: [], fueraDeZona: [] } as never;
const compromisosVacios = { vencidos: [], hoy: [], total: 0, incumplidos: [] } as never;

const pendiente = (p: Partial<{ cobradorId: string; nombre: string; recaudado: number; cobros: number; colocado: number }>) => ({
  cobradorId: p.cobradorId ?? "c1",
  nombre: p.nombre ?? "Fernando Castro",
  recaudado: p.recaudado ?? 0,
  cobros: p.cobros ?? 1,
  colocado: p.colocado ?? 0,
});

const alertasDe = async (pendientes: unknown[]) =>
  (
    await getCentroAlertas(db, new Date("2026-09-09T15:00:00Z"), ALCANCE, {
      rend: rendCon(pendientes),
      control: controlVacio,
      compromisos: compromisosVacios,
    })
  ).alertas.filter((a) => a.categoria === "Sin rendir");

describe("Centro de alertas · «sin rendir» mide lo que quedó EN LA MANO", () => {
  it("⚠️ el caso real: cobró $235.738 pero prestó $159.000 → se le reclaman $76.738, no el bruto", async () => {
    const [a] = await alertasDe([
      pendiente({ nombre: "Fernando Castro", recaudado: 235738, colocado: 159000, cobros: 7 }),
    ]);
    expect(a.titulo).toContain("$76.738");
    expect(a.titulo).not.toContain("$235.738"); // el bruto NO puede ser lo que se le reclama
    // y la pantalla explica la resta, para que nadie tenga que adivinarla
    expect(a.detalle).toContain("$235.738");
    expect(a.detalle).toContain("$159.000");
  });

  it("si colocó TODO lo que cobró no hay float: no se lo alerta", async () => {
    const alertas = await alertasDe([pendiente({ recaudado: 100000, colocado: 100000 })]);
    expect(alertas).toHaveLength(0);
  });

  it("si colocó MÁS de lo que cobró (puso de su bolsillo) tampoco se lo alerta", async () => {
    const alertas = await alertasDe([pendiente({ recaudado: 50000, colocado: 80000 })]);
    expect(alertas).toHaveLength(0);
  });

  it("sin capital colocado se comporta como siempre y no ensucia el detalle", async () => {
    const [a] = await alertasDe([pendiente({ nombre: "Ana", recaudado: 12000, colocado: 0, cobros: 3 })]);
    expect(a.titulo).toBe("Ana tiene $12.000 sin rendir");
    expect(a.detalle).toBe("3 cobro(s) hoy sin cierre de jornada.");
  });

  it("el que no cobró nada no aparece", async () => {
    expect(await alertasDe([pendiente({ recaudado: 0, cobros: 0 })])).toHaveLength(0);
  });
});
