// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — SOLICITUDES de renovación (0029). El supervisor pide, el
//  admin resuelve. Degrada si 0029 aún no corrió.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FrecuenciaPrestamo } from "@/types/db";
import { tablaFaltante } from "./errores";

export interface SolicitudRenovacion {
  id: string;
  clienteId: string;
  clienteNombre: string;
  prestamoAnteriorId: string;
  monto: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
  solicitadoPorNombre: string | null;
  /** QUIÉN la pidió. Es el cobrador que va a poner el efectivo en la calle: el
   *  crédito tiene que nacer a SU nombre, no al del gestor que aprieta "Aprobar". */
  solicitadoPor: string | null;
  solicitadoEn: string;
}

export interface NuevaSolicitud {
  clienteId: string;
  prestamoAnteriorId: string;
  monto: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
  solicitadoPor: string;
  solicitadoPorNombre: string;
}

export async function crearSolicitudDb(db: SupabaseClient, s: NuevaSolicitud): Promise<void> {
  const { error } = await db.from("solicitudes_renovacion").insert({
    cliente_id: s.clienteId,
    prestamo_anterior_id: s.prestamoAnteriorId,
    monto: s.monto,
    total_dias: s.totalDias,
    frecuencia: s.frecuencia,
    solicitado_por: s.solicitadoPor,
    solicitado_por_nombre: s.solicitadoPorNombre,
  });
  if (error) throw error;
}

/** Solicitudes pendientes, de la más nueva a la vieja (con el nombre del cliente). */
export async function getSolicitudesPendientes(db: SupabaseClient): Promise<SolicitudRenovacion[]> {
  try {
    const { data, error } = await db
      .from("solicitudes_renovacion")
      .select("*")
      .eq("estado", "pendiente")
      .order("solicitado_en", { ascending: false });
    if (error) throw error;
    const rows = data ?? [];
    const ids = [...new Set(rows.map((r) => r.cliente_id as string))];
    const nombre = new Map<string, string>();
    if (ids.length > 0) {
      const { data: clis } = await db.from("clientes").select("id, nombre").in("id", ids);
      for (const c of clis ?? []) nombre.set(c.id as string, c.nombre as string);
    }
    return rows.map((r) => ({
      id: r.id as string,
      clienteId: r.cliente_id as string,
      clienteNombre: nombre.get(r.cliente_id as string) ?? "Cliente",
      prestamoAnteriorId: r.prestamo_anterior_id as string,
      monto: Number(r.monto),
      totalDias: Number(r.total_dias),
      frecuencia: (r.frecuencia as FrecuenciaPrestamo) ?? "diario",
      solicitadoPorNombre: (r.solicitado_por_nombre as string | null) ?? null,
      solicitadoPor: (r.solicitado_por as string | null) ?? null,
      solicitadoEn: r.solicitado_en as string,
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export interface SolicitudCruda {
  id: string;
  clienteId: string;
  prestamoAnteriorId: string;
  monto: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
  estado: string;
  /** El cobrador que la pidió: el crédito nace a SU nombre porque es quien pone
   *  el efectivo en la calle, no el gestor que aprieta "Aprobar". */
  solicitadoPor: string | null;
}

export async function getSolicitudPorId(
  db: SupabaseClient,
  id: string,
): Promise<SolicitudCruda | null> {
  const { data, error } = await db.from("solicitudes_renovacion").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as string,
    clienteId: data.cliente_id as string,
    prestamoAnteriorId: data.prestamo_anterior_id as string,
    monto: Number(data.monto),
    totalDias: Number(data.total_dias),
    frecuencia: (data.frecuencia as FrecuenciaPrestamo) ?? "diario",
    estado: data.estado as string,
    solicitadoPor: (data.solicitado_por as string | null) ?? null,
  };
}

export async function resolverSolicitudDb(
  db: SupabaseClient,
  id: string,
  r: { estado: "aprobada" | "rechazada"; resueltoPor: string; motivoRechazo?: string | null; prestamoNuevoId?: string | null },
): Promise<void> {
  const { error } = await db
    .from("solicitudes_renovacion")
    .update({
      estado: r.estado,
      resuelto_por: r.resueltoPor,
      resuelto_en: new Date().toISOString(),
      motivo_rechazo: r.motivoRechazo ?? null,
      prestamo_nuevo_id: r.prestamoNuevoId ?? null,
    })
    .eq("id", id)
    .eq("estado", "pendiente"); // no re-resolver
  if (error) throw error;
}

/**
 * Cierra (aprobada) cualquier solicitud PENDIENTE de un crédito anterior. Se usa
 * cuando ese crédito se renovó por OTRA vía (alta directa del admin): así la
 * solicitud no queda huérfana apuntando a un crédito ya finalizado. Idempotente
 * (solo toca las pendientes). Best-effort: no bloquea la renovación ya hecha.
 */
export async function cerrarSolicitudPendienteDeAnterior(
  db: SupabaseClient,
  prestamoAnteriorId: string,
  prestamoNuevoId: string,
  resueltoPor: string,
): Promise<void> {
  const { error } = await db
    .from("solicitudes_renovacion")
    .update({
      estado: "aprobada",
      resuelto_por: resueltoPor,
      resuelto_en: new Date().toISOString(),
      prestamo_nuevo_id: prestamoNuevoId,
    })
    .eq("prestamo_anterior_id", prestamoAnteriorId)
    .eq("estado", "pendiente");
  if (error) throw error;
}
