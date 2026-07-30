// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — LEADS de la TIENDA PÚBLICA (0111). Prospectos (no clientes
//  aún) que dejaron su contacto desde /tienda. Bandeja del admin para llamar y
//  onboardear. Escritura por service_role; lectura gestor. Degrada si falta 0111.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "./errores";

export type EstadoLeadPublico = "nuevo" | "contactado" | "cerrado" | "descartado";
export const ESTADOS_LEAD_PUBLICO: EstadoLeadPublico[] = ["nuevo", "contactado", "cerrado", "descartado"];

export interface LeadPublico {
  id: string;
  productoId: string | null;
  productoNombre: string | null;
  nombre: string;
  telefono: string;
  mensaje: string | null;
  estado: EstadoLeadPublico;
  creadoEn: string;
  resueltoEn: string | null;
}

function map(r: Record<string, unknown>): LeadPublico {
  return {
    id: r.id as string,
    productoId: (r.producto_id as string | null) ?? null,
    productoNombre: (r.producto_nombre as string | null) ?? null,
    nombre: r.nombre as string,
    telefono: r.telefono as string,
    mensaje: (r.mensaje as string | null) ?? null,
    estado: r.estado as EstadoLeadPublico,
    creadoEn: r.creado_en as string,
    resueltoEn: (r.resuelto_en as string | null) ?? null,
  };
}

export async function crearLeadPublicoDb(
  db: SupabaseClient,
  input: { productoId: string | null; productoNombre: string | null; nombre: string; telefono: string; mensaje: string | null },
): Promise<void> {
  const { error } = await db.from("leads_publicos").insert({
    producto_id: input.productoId,
    producto_nombre: input.productoNombre,
    nombre: input.nombre,
    telefono: input.telefono,
    mensaje: input.mensaje,
  });
  if (error) throw error;
}

/** Leads públicos para la bandeja del admin. `estado` opcional filtra. Degrada a []. */
export async function getLeadsPublicos(db: SupabaseClient, estado?: EstadoLeadPublico, limite = 200): Promise<LeadPublico[]> {
  try {
    let q = db.from("leads_publicos").select("*").order("creado_en", { ascending: false }).limit(limite);
    if (estado) q = q.eq("estado", estado);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(map);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Cuántos leads públicos NUEVOS (sin contactar) — para el badge del admin. Degrada a 0. */
export async function contarLeadsPublicosNuevos(db: SupabaseClient): Promise<number> {
  try {
    const { count, error } = await db
      .from("leads_publicos")
      .select("id", { count: "exact", head: true })
      .eq("estado", "nuevo");
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    if (tablaFaltante(e)) return 0;
    throw e;
  }
}

export async function resolverLeadPublicoDb(
  db: SupabaseClient,
  id: string,
  estado: EstadoLeadPublico,
  resueltoPor: string,
  ahoraIso: string,
): Promise<void> {
  const cerrado = estado !== "nuevo";
  const { error } = await db
    .from("leads_publicos")
    .update({ estado, resuelto_por: cerrado ? resueltoPor : null, resuelto_en: cerrado ? ahoraIso : null })
    .eq("id", id);
  if (error) throw error;
}
