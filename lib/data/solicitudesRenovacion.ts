// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — SOLICITUDES de renovación (0029). El supervisor pide, el
//  admin resuelve. Degrada si 0029 aún no corrió.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FrecuenciaPrestamo } from "@/types/db";
import { tablaFaltante } from "./errores";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export interface SolicitudRenovacion {
  id: string;
  clienteId: string;
  clienteNombre: string;
  prestamoAnteriorId: string;
  monto: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
  /** Monto del crédito ANTERIOR: sin esto el admin aprueba a ciegas, sin saber si
   *  le están pidiendo el mismo monto o seis veces más. */
  montoAnterior?: number;
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
    // Monto del crédito ANTERIOR de cada solicitud: es la única referencia contra
    // la que el admin puede juzgar el pedido.
    const antes = new Map<string, number>();
    const antIds = [...new Set(rows.map((r) => r.prestamo_anterior_id as string).filter(Boolean))];
    if (antIds.length > 0) {
      const { data: prev } = await db
        .from("prestamos")
        .select("id, monto_prestado")
        .in("id", antIds);
      for (const p of prev ?? [])
        antes.set(p.id as string, Math.round(Number(p.monto_prestado) || 0));
    }
    return rows.map((r) => ({
      id: r.id as string,
      clienteId: r.cliente_id as string,
      clienteNombre: nombre.get(r.cliente_id as string) ?? "Cliente",
      prestamoAnteriorId: r.prestamo_anterior_id as string,
      monto: Number(r.monto),
      totalDias: Number(r.total_dias),
      frecuencia: (r.frecuencia as FrecuenciaPrestamo) ?? "diario",
      montoAnterior: antes.get(r.prestamo_anterior_id as string) ?? 0,
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
  /** @returns true si ESTA llamada la resolvió; false si ya la había resuelto otro. */
): Promise<boolean> {
  const { data, error } = await db
    .from("solicitudes_renovacion")
    .update({
      estado: r.estado,
      resuelto_por: r.resueltoPor,
      resuelto_en: new Date().toISOString(),
      motivo_rechazo: r.motivoRechazo ?? null,
      prestamo_nuevo_id: r.prestamoNuevoId ?? null,
    })
    .eq("id", id)
    .eq("estado", "pendiente") // no re-resolver
    // ⚠️ Un update que afecta 0 filas NO es error. Sin el `.select`, rechazar una
    // solicitud que otro admin ya aprobó devolvía ok, escribía "Rechazó" en la
    // auditoría y la tarjeta desaparecía — el segundo admin se iba convencido de
    // haberla frenado mientras el crédito ya estaba creado y activo.
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
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
  /** "aprobada" = la oficina la resolvió. "rechazada" = la cierra el COBRADOR al
   *  renovar por su cuenta un monto que entra en su techo: nadie la aprobó, y
   *  marcarla "aprobada" dejaba escrito que la oficina autorizó $16.000 cuando se
   *  colocaron $10.000 — un OK que nunca existió. */
  como: "aprobada" | "rechazada" = "aprobada",
  motivo: string | null = null,
): Promise<void> {
  const { error } = await db
    .from("solicitudes_renovacion")
    .update({
      estado: como,
      resuelto_por: resueltoPor,
      resuelto_en: new Date().toISOString(),
      motivo_rechazo: motivo,
      prestamo_nuevo_id: prestamoNuevoId,
    })
    .eq("prestamo_anterior_id", prestamoAnteriorId)
    .eq("estado", "pendiente");
  if (error) throw error;
}

/** Una renovación que la oficina YA aprobó y el cobrador tiene que entregar. */
export interface AprobadaPendiente {
  id: string;
  clienteId: string;
  clienteNombre: string;
  monto: number;
  resueltoEn: string | null;
}

/**
 * Renovaciones que la oficina le APROBÓ a este cobrador en los últimos días.
 *
 * ⚠️ Sin esto el circuito quedaba mudo del lado que importa: el cobrador pedía,
 * el admin aprobaba, el crédito nacía ACTIVO a nombre del cobrador... y él no se
 * enteraba nunca (`solicitudes_renovacion` tiene RLS solo-gestor y no hay push).
 * Peor: como el crédito se le atribuye a él, `colocado` YA le descuenta esa plata
 * de la caja y el cierre le prellena un "entregado" con el descuento aplicado. Si
 * confirma ese número sin haber entregado nada, se queda con el capital y la
 * rendición cuadra — mientras el cliente empieza a pagar un crédito que no recibió.
 *
 * Se lee con ADMIN y scope explícito por `solicitado_por` (misma justificación
 * que el recaudo y el colocado: la RLS de gestor lo dejaría sin ver lo suyo).
 */
export async function getAprobadasPendientes(
  cobradorId: string,
  dias = 3,
): Promise<AprobadaPendiente[]> {
  try {
    const admin = createSupabaseAdmin();
    const desde = new Date(Date.now() - dias * 24 * 3600 * 1000).toISOString();
    const { data, error } = await admin
      .from("solicitudes_renovacion")
      .select("id, cliente_id, monto, resuelto_en")
      .eq("solicitado_por", cobradorId)
      .eq("estado", "aprobada")
      .gte("resuelto_en", desde)
      .order("resuelto_en", { ascending: false });
    if (error) throw error;
    const filas = data ?? [];
    if (filas.length === 0) return [];
    const ids = [...new Set(filas.map((r) => r.cliente_id as string))];
    const { data: cls } = await admin.from("clientes").select("id, nombre").in("id", ids);
    const nombre = new Map((cls ?? []).map((c) => [c.id as string, c.nombre as string]));
    return filas.map((r) => ({
      id: r.id as string,
      clienteId: r.cliente_id as string,
      clienteNombre: nombre.get(r.cliente_id as string) ?? "Cliente",
      monto: Math.round(Number(r.monto) || 0),
      resueltoEn: (r.resuelto_en as string | null) ?? null,
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}
