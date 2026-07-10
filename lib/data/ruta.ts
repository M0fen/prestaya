// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RUTA del cobrador y ARQUEO del día.
//  Junta clientes asignados (RLS), su préstamo activo y el estado de HOY
//  (pagado / no pago / pendiente) desde pagos y visitas. Corte de día en UY.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cliente } from "@/types/db";
import { mapCliente } from "./clientes";
import { inicioDiaUYIso } from "@/lib/fecha";

// "abono" = pagó HOY pero menos que la cuota (abono parcial). Regla del negocio:
// un abono parcial NO cubre el día → no es "pagado", queda como pendiente-visto.
export type EstadoHoy = "pagado" | "abono" | "no_pago" | "pendiente" | "sin_credito";

export interface ItemRuta {
  cliente: Cliente;
  prestamoId: string | null;
  cuota: number;
  estadoHoy: EstadoHoy;
  pagadoHoy: number;
}

export interface Arqueo {
  esperado: number;
  recaudado: number;
  cobrados: number;
  /** Clientes con abono PARCIAL hoy (pagó algo, no cubrió la cuota). */
  abonos: number;
  pendientes: number;
  noPagos: number;
  clientes: number;
}

export interface Ruta {
  items: ItemRuta[];
  arqueo: Arqueo;
}

const ARQUEO_VACIO: Arqueo = {
  esperado: 0,
  recaudado: 0,
  cobrados: 0,
  abonos: 0,
  pendientes: 0,
  noPagos: 0,
  clientes: 0,
};

/**
 * Estado del cliente HOY, con la MISMA regla que el cartón (lib/cartones.ts):
 * cubrir el día exige pagar >= la cuota. Pura y testeable — es la fuente de
 * verdad de los chips de la ruta y de los contadores del arqueo.
 */
export function estadoHoyDe(
  pagadoHoy: number,
  cuota: number,
  esNoPago: boolean,
): EstadoHoy {
  if (cuota > 0 && pagadoHoy >= cuota) return "pagado";
  if (pagadoHoy > 0) return "abono"; // pagó algo pero no cubrió la cuota
  if (esNoPago) return "no_pago";
  return "pendiente";
}

/** Ruta del cobrador logueado + arqueo del día (todo scopeado por RLS). */
export async function getRutaCobrador(
  db: SupabaseClient,
  hoy: Date = new Date(),
): Promise<Ruta> {
  // Clientes del cobrador SCOPEADOS por sus asignaciones (RLS = suyas, indexado
  // por cobrador_id → devuelve ~decenas). Antes se hacía `select * from clientes`
  // dependiendo del RLS, que con 13k clientes evaluaba la política fila-por-fila
  // → statement timeout. Con `.in(ids)` el RLS solo se evalúa sobre esos ids.
  const { data: asigRaw, error: e0 } = await db
    .from("asignaciones")
    .select("cliente_id")
    .eq("activo", true);
  if (e0) throw e0;
  const cliIds = [...new Set((asigRaw ?? []).map((a) => a.cliente_id as string))];
  if (cliIds.length === 0) return { items: [], arqueo: ARQUEO_VACIO };

  const { data: cliRaw, error: eC } = await db
    .from("clientes")
    .select("*")
    .in("id", cliIds)
    .eq("activo", true)
    .order("nombre", { ascending: true });
  if (eC) throw eC;
  const clientes = (cliRaw ?? []).map(mapCliente);
  if (clientes.length === 0) return { items: [], arqueo: ARQUEO_VACIO };

  // Préstamo activo por cliente (scopeado por los ids, no todo el RLS).
  const { data: presRaw, error: e1 } = await db
    .from("prestamos")
    .select("id, cliente_id, cuota_diaria")
    .eq("estado", "activo")
    .in("cliente_id", cliIds);
  if (e1) throw e1;
  const prestamoDe = new Map<string, { id: string; cuota: number }>();
  for (const p of presRaw ?? [])
    prestamoDe.set(p.cliente_id as string, {
      id: p.id as string,
      cuota: Number(p.cuota_diaria),
    });

  const ids = [...prestamoDe.values()].map((p) => p.id);
  const desde = inicioDiaUYIso(hoy);

  // Cobros y visitas de HOY.
  const pagadoPorPrestamo = new Map<string, number>();
  const noPagoPrestamos = new Set<string>();
  if (ids.length > 0) {
    const { data: pagosRaw, error: e2 } = await db
      .from("pagos")
      .select("prestamo_id, monto")
      .eq("anulado", false)
      .gte("registrado_en", desde)
      .in("prestamo_id", ids);
    if (e2) throw e2;
    for (const r of pagosRaw ?? [])
      pagadoPorPrestamo.set(
        r.prestamo_id as string,
        (pagadoPorPrestamo.get(r.prestamo_id as string) ?? 0) + Number(r.monto),
      );

    const { data: visRaw, error: e3 } = await db
      .from("visitas")
      .select("prestamo_id, resultado")
      .gte("registrado_en", desde)
      .in("prestamo_id", ids);
    if (e3) throw e3;
    for (const r of visRaw ?? []) {
      const res = r.resultado as string;
      if (res !== "pago" && res !== "abono")
        noPagoPrestamos.add(r.prestamo_id as string);
    }
  }

  let esperado = 0;
  let recaudado = 0;
  let cobrados = 0;
  let abonos = 0;
  let noPagos = 0;

  const items: ItemRuta[] = clientes.map((c) => {
    const pr = prestamoDe.get(c.id);
    if (!pr)
      return { cliente: c, prestamoId: null, cuota: 0, estadoHoy: "sin_credito", pagadoHoy: 0 };
    esperado += pr.cuota;
    const pagadoHoy = pagadoPorPrestamo.get(pr.id) ?? 0;
    recaudado += pagadoHoy;
    const estadoHoy = estadoHoyDe(pagadoHoy, pr.cuota, noPagoPrestamos.has(pr.id));
    if (estadoHoy === "pagado") cobrados++;
    else if (estadoHoy === "abono") abonos++;
    else if (estadoHoy === "no_pago") noPagos++;
    return { cliente: c, prestamoId: pr.id, cuota: pr.cuota, estadoHoy, pagadoHoy };
  });

  const conCredito = items.filter((i) => i.prestamoId).length;
  return {
    items,
    arqueo: {
      esperado,
      recaudado,
      cobrados,
      abonos,
      // Pendientes "puros" = ni cobrados, ni con abono parcial, ni no-pago.
      pendientes: Math.max(0, conCredito - cobrados - abonos - noPagos),
      noPagos,
      clientes: conCredito,
    },
  };
}
