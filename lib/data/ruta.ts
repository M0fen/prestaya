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
 * Estado del cliente HOY según la CAJA COBRADA HOY (no el cartón). Mide "¿cuánto
 * me pagó hoy este cliente?": >= cuota → "pagado", 0<x<cuota → "abono" parcial,
 * 0 → pendiente/no-pago. Sirve para que el cobrador sepa a quién ya visitó/cobró.
 * OJO: NO es lo mismo que la celda de HOY del cartón (lib/cartones.ts), que aplica
 * el pago por FIFO a la cuota vencida más vieja — un cliente atrasado que paga 1
 * cuota queda "pagado" acá (cobró hoy) pero su cartón puede seguir con HOY pendiente.
 * Pura y testeable — fuente de verdad de los chips de la ruta y del arqueo.
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

  // Créditos activos por cliente. Un cliente puede tener VARIOS (0037): se
  // acumulan TODOS — la cuota del día y lo cobrado hoy suman los de todos sus
  // créditos (si no, el arqueo subestima el esperado y pierde pagos del 2º).
  const { data: presRaw, error: e1 } = await db
    .from("prestamos")
    .select("id, cliente_id, cuota_diaria")
    .eq("estado", "activo")
    .in("cliente_id", cliIds);
  if (e1) throw e1;
  const creditosDe = new Map<string, { ids: string[]; cuotaTotal: number; principalId: string }>();
  for (const p of presRaw ?? []) {
    const cid = p.cliente_id as string;
    const pid = p.id as string;
    const cuota = Number(p.cuota_diaria);
    const acc = creditosDe.get(cid);
    if (acc) {
      acc.ids.push(pid);
      acc.cuotaTotal += cuota;
    } else {
      creditosDe.set(cid, { ids: [pid], cuotaTotal: cuota, principalId: pid });
    }
  }

  const ids = [...creditosDe.values()].flatMap((c) => c.ids);
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
    const cr = creditosDe.get(c.id);
    if (!cr)
      return { cliente: c, prestamoId: null, cuota: 0, estadoHoy: "sin_credito", pagadoHoy: 0 };
    esperado += cr.cuotaTotal;
    // Suma de lo cobrado HOY en TODOS los créditos activos del cliente.
    const pagadoHoy = cr.ids.reduce((s, id) => s + (pagadoPorPrestamo.get(id) ?? 0), 0);
    recaudado += pagadoHoy;
    // No-pago si alguno de sus créditos quedó marcado como visita sin cobro.
    const esNoPago = cr.ids.some((id) => noPagoPrestamos.has(id));
    const estadoHoy = estadoHoyDe(pagadoHoy, cr.cuotaTotal, esNoPago);
    if (estadoHoy === "pagado") cobrados++;
    else if (estadoHoy === "abono") abonos++;
    else if (estadoHoy === "no_pago") noPagos++;
    return { cliente: c, prestamoId: cr.principalId, cuota: cr.cuotaTotal, estadoHoy, pagadoHoy };
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
