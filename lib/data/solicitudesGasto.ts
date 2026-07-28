// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — SOLICITUDES DE GASTO de ruta (0057). El cobrador pide; el
//  admin aprueba (y recién ahí nace el egreso). Degrada a vacío si falta 0057.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { inicioDiaUYIso } from "@/lib/fecha";
import { tablaFaltante } from "./errores";

export type EstadoSolicitudGasto = "pendiente" | "aprobada" | "rechazada";

export interface SolicitudGasto {
  id: string;
  cobradorId: string;
  cobradorNombre: string | null;
  monto: number;
  categoria: string | null;
  descripcion: string | null;
  estado: EstadoSolicitudGasto;
  solicitadoEn: string;
  motivoRechazo: string | null;
  /** Foto del comprobante/factura que adjuntó el cobrador (0070). null = sin foto
   *  (solicitudes viejas o entorno sin la migración). */
  comprobanteUrl: string | null;
  /** Quién resolvió (aprobó/rechazó) y cuándo. null si aún pendiente. Traza anti-fraude. */
  resueltoPorNombre: string | null;
  resueltoEn: string | null;
}

function map(r: Record<string, unknown>): SolicitudGasto {
  return {
    id: r.id as string,
    cobradorId: r.cobrador_id as string,
    cobradorNombre: (r.solicitado_por_nombre as string | null) ?? null,
    monto: Number(r.monto),
    categoria: (r.categoria as string | null) ?? null,
    descripcion: (r.descripcion as string | null) ?? null,
    estado: r.estado as EstadoSolicitudGasto,
    solicitadoEn: r.solicitado_en as string,
    motivoRechazo: (r.motivo_rechazo as string | null) ?? null,
    comprobanteUrl: (r.comprobante_url as string | null) ?? null,
    resueltoPorNombre: (r.resuelto_por_nombre as string | null) ?? null,
    resueltoEn: (r.resuelto_en as string | null) ?? null,
  };
}

/** Solicitudes de HOY del cobrador (para su app): lista + cuántas pendientes. */
export async function getSolicitudesGastoCobrador(
  db: SupabaseClient,
  cobradorId: string,
  hoy: Date = new Date(),
): Promise<{ pendientes: number; aprobadoTotal: number; items: SolicitudGasto[] }> {
  try {
    const { data, error } = await db
      .from("solicitudes_gasto")
      .select("*")
      .eq("cobrador_id", cobradorId)
      .gte("solicitado_en", inicioDiaUYIso(hoy))
      .order("solicitado_en", { ascending: false });
    if (error) throw error;
    const items = (data ?? []).map(map);
    return {
      pendientes: items.filter((i) => i.estado === "pendiente").length,
      aprobadoTotal: items.filter((i) => i.estado === "aprobada").reduce((s, i) => s + i.monto, 0),
      items,
    };
  } catch (e) {
    if (tablaFaltante(e)) return { pendientes: 0, aprobadoTotal: 0, items: [] };
    throw e;
  }
}

/** Solicitudes PENDIENTES para la bandeja del gestor (con nombre del cobrador).
 *  `cobradorIds` acota por zona (supervisor); `null`/omitido = todas (admin). Un
 *  arreglo vacío (supervisor sin cobradores) devuelve [] sin consultar. */
export async function getSolicitudesGastoPendientes(
  db: SupabaseClient,
  cobradorIds?: string[] | null,
): Promise<SolicitudGasto[]> {
  try {
    if (cobradorIds && cobradorIds.length === 0) return [];
    let q = db
      .from("solicitudes_gasto")
      .select("*")
      .eq("estado", "pendiente")
      .order("solicitado_en", { ascending: true });
    if (cobradorIds) q = q.in("cobrador_id", cobradorIds);
    const { data, error } = await q;
    if (error) throw error;
    const items = (data ?? []).map(map);
    // Nombre del cobrador (solicitado_por_nombre ya viene, pero reforzamos por id).
    const ids = [...new Set(items.map((i) => i.cobradorId))];
    if (ids.length > 0) {
      const { data: us } = await db.from("usuarios").select("id, nombre").in("id", ids);
      const nombre = new Map((us ?? []).map((u) => [u.id as string, u.nombre as string]));
      for (const i of items) i.cobradorNombre = nombre.get(i.cobradorId) ?? i.cobradorNombre;
    }
    return items;
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Cuántas solicitudes de gasto están PENDIENTES (para el badge de la nav / el
 *  hub). Solo cuenta, sin traer filas. Degrada a 0 si falta 0057. */
export async function contarSolicitudesGastoPendientes(
  db: SupabaseClient,
  cobradorIds?: string[] | null,
): Promise<number> {
  try {
    if (cobradorIds && cobradorIds.length === 0) return 0;
    let q = db
      .from("solicitudes_gasto")
      .select("id", { count: "exact", head: true })
      .eq("estado", "pendiente");
    if (cobradorIds) q = q.in("cobrador_id", cobradorIds);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    if (tablaFaltante(e)) return 0;
    throw e;
  }
}

/** Historial de gastos RESUELTOS (aprobados/rechazados) para el admin: recupera la
 *  evidencia anti-fraude que antes desaparecía al resolver (comprobante, quién y
 *  cuándo). Ordenado del más reciente. `cobradorIds` acota por zona (supervisor);
 *  null = todos (admin). Degrada a [] si falta 0057. */
export async function getSolicitudesGastoResueltas(
  db: SupabaseClient,
  cobradorIds?: string[] | null,
  limite = 100,
): Promise<SolicitudGasto[]> {
  try {
    if (cobradorIds && cobradorIds.length === 0) return [];
    let q = db
      .from("solicitudes_gasto")
      .select("*")
      .in("estado", ["aprobada", "rechazada"])
      .order("resuelto_en", { ascending: false })
      .limit(limite);
    if (cobradorIds) q = q.in("cobrador_id", cobradorIds);
    const { data, error } = await q;
    if (error) throw error;
    const items = (data ?? []).map(map);
    const ids = [...new Set(items.map((i) => i.cobradorId))];
    if (ids.length > 0) {
      const { data: us } = await db.from("usuarios").select("id, nombre").in("id", ids);
      const nombre = new Map((us ?? []).map((u) => [u.id as string, u.nombre as string]));
      for (const i of items) i.cobradorNombre = nombre.get(i.cobradorId) ?? i.cobradorNombre;
    }
    return items;
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Una solicitud por id (para las acciones de aprobar/rechazar). */
export async function getSolicitudGasto(db: SupabaseClient, id: string): Promise<SolicitudGasto | null> {
  const { data, error } = await db.from("solicitudes_gasto").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (tablaFaltante(error)) return null;
    throw error;
  }
  return data ? map(data) : null;
}
