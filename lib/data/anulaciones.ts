// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ANULACIÓN de pagos con doble registro (0032).
//  Un pago NUNCA se borra: se marca anulado (quién/cuándo/por qué). El flip
//  real lo hace la Server Action con service_role (por RLS anular = solo admin);
//  acá viven las lecturas y la derivación de la zona del pago.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "./errores";
import type { Alcance } from "./alcance";

export interface SolicitudAnulacion {
  id: string;
  pagoId: string;
  motivo: string;
  estado: "pendiente" | "confirmada" | "rechazada";
  solicitadoPor: string | null;
  solicitadoPorNombre: string | null;
  solicitadoEn: string;
  resueltoPor: string | null;
  resueltoPorNombre: string | null;
  resueltoEn: string | null;
  motivoRechazo: string | null;
  // Contexto del pago (para mostrar en la lista de pendientes).
  monto?: number;
  clienteNombre?: string;
  clienteId?: string;
}

function mapSolicitud(r: Record<string, unknown>): SolicitudAnulacion {
  return {
    id: r.id as string,
    pagoId: r.pago_id as string,
    motivo: r.motivo as string,
    estado: r.estado as SolicitudAnulacion["estado"],
    solicitadoPor: (r.solicitado_por as string | null) ?? null,
    solicitadoPorNombre: (r.solicitado_por_nombre as string | null) ?? null,
    solicitadoEn: r.solicitado_en as string,
    resueltoPor: (r.resuelto_por as string | null) ?? null,
    resueltoPorNombre: (r.resuelto_por_nombre as string | null) ?? null,
    resueltoEn: (r.resuelto_en as string | null) ?? null,
    motivoRechazo: (r.motivo_rechazo as string | null) ?? null,
  };
}

/**
 * Zona DERIVADA de un pago = zona del cobrador con asignación activa sobre el
 * cliente del préstamo del pago. null si no se puede derivar. Reusa la función
 * SQL `app_zona_de_cliente` (misma verdad que la RLS).
 */
export async function getZonaDePago(
  db: SupabaseClient,
  pagoId: string,
): Promise<string | null> {
  const { data: pago, error } = await db
    .from("pagos")
    .select("prestamo_id, prestamos(cliente_id)")
    .eq("id", pagoId)
    .maybeSingle();
  if (error || !pago) return null;
  const prest = (pago as { prestamos?: { cliente_id?: string } | { cliente_id?: string }[] }).prestamos;
  const clienteId = Array.isArray(prest) ? prest[0]?.cliente_id : prest?.cliente_id;
  if (!clienteId) return null;
  const { data: zona } = await db.rpc("app_zona_de_cliente", { p_cliente: clienteId });
  return (zona as string | null) ?? null;
}

/** Datos mínimos de un pago para validar/mostrar la anulación. */
export async function getPagoResumen(
  db: SupabaseClient,
  pagoId: string,
): Promise<{ id: string; monto: number; anulado: boolean; clienteId: string; clienteNombre: string } | null> {
  const { data, error } = await db
    .from("pagos")
    .select("id, monto, anulado, prestamos(cliente_id, clientes(nombre))")
    .eq("id", pagoId)
    .maybeSingle();
  if (error || !data) return null;
  const p = data as {
    id: string;
    monto: number;
    anulado: boolean;
    prestamos?: { cliente_id?: string; clientes?: { nombre?: string } } | { cliente_id?: string; clientes?: { nombre?: string } }[];
  };
  const prest = Array.isArray(p.prestamos) ? p.prestamos[0] : p.prestamos;
  return {
    id: p.id,
    monto: Number(p.monto),
    anulado: !!p.anulado,
    clienteId: prest?.cliente_id ?? "",
    clienteNombre: prest?.clientes?.nombre ?? "—",
  };
}

/** Solicitud pendiente de un pago (o null). */
export async function getSolicitudPendienteDePago(
  db: SupabaseClient,
  pagoId: string,
): Promise<SolicitudAnulacion | null> {
  try {
    const { data, error } = await db
      .from("solicitudes_anulacion")
      .select("*")
      .eq("pago_id", pagoId)
      .eq("estado", "pendiente")
      .maybeSingle();
    if (error) throw error;
    return data ? mapSolicitud(data) : null;
  } catch (e) {
    if (tablaFaltante(e)) return null;
    throw e;
  }
}

/** De una lista de pagos, cuáles tienen una solicitud de anulación pendiente. */
export async function getPendientesDePagos(
  db: SupabaseClient,
  pagoIds: string[],
): Promise<Set<string>> {
  if (pagoIds.length === 0) return new Set();
  try {
    const { data, error } = await db
      .from("solicitudes_anulacion")
      .select("pago_id")
      .eq("estado", "pendiente")
      .in("pago_id", pagoIds);
    if (error) throw error;
    return new Set((data ?? []).map((r) => (r as { pago_id: string }).pago_id));
  } catch (e) {
    if (tablaFaltante(e)) return new Set();
    throw e;
  }
}

export async function getSolicitud(
  db: SupabaseClient,
  id: string,
): Promise<SolicitudAnulacion | null> {
  const { data, error } = await db.from("solicitudes_anulacion").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapSolicitud(data) : null;
}

/**
 * Solicitudes pendientes con contexto del pago (para la bandeja).
 * `alcance` acota por ZONA: la RLS de `solicitudes_anulacion` es ANCHA (cualquier
 * gestor ve todas las filas), así que SIN este recorte un supervisor leería el
 * MOTIVO (texto libre, puede tener nombre/monto) y el SOLICITANTE de anulaciones de
 * OTRAS zonas (fuga de PII). El admin (global) ve todas; el supervisor, solo las de
 * clientes de su alcance. Omitido = sin recorte (compatibilidad).
 */
export async function getSolicitudesPendientes(
  db: SupabaseClient,
  alcance?: Alcance,
): Promise<SolicitudAnulacion[]> {
  try {
    const { data, error } = await db
      .from("solicitudes_anulacion")
      .select("*, pagos(monto, prestamos(cliente_id, clientes(nombre)))")
      .eq("estado", "pendiente")
      .order("solicitado_en", { ascending: false });
    if (error) throw error;
    const items = (data ?? []).map((r) => {
      const s = mapSolicitud(r);
      const pago = (r as { pagos?: { monto?: number; prestamos?: { cliente_id?: string; clientes?: { nombre?: string } } | { cliente_id?: string; clientes?: { nombre?: string } }[] } }).pagos;
      const prest = Array.isArray(pago?.prestamos) ? pago?.prestamos[0] : pago?.prestamos;
      s.monto = pago?.monto != null ? Number(pago.monto) : undefined;
      s.clienteNombre = prest?.clientes?.nombre ?? undefined;
      s.clienteId = prest?.cliente_id ?? undefined;
      return s;
    });
    // Recorte por zona (supervisor). Una solicitud cuyo pago NO cae en el alcance
    // (clienteId ajeno o indeterminable → el embed vino null por la RLS de pagos) se
    // descarta: no se muestra el motivo/solicitante de otra zona.
    if (alcance && !alcance.global) {
      const set = new Set(alcance.clienteIds);
      return items.filter((s) => s.clienteId != null && set.has(s.clienteId));
    }
    return items;
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}
