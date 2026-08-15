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

export interface NuevoLeadPublico {
  productoId: string | null;
  productoNombre: string | null;
  nombre: string;
  telefono: string;
  mensaje: string | null;
  /** Folio PY-XXXXXX del comprobante — el mismo que el visitante guarda (0149). */
  folio?: string | null;
  cantidad?: number;
  cuotasPreferidas?: number | null;
  /** Idempotencia por ítem (índice único 0149): el reintento no duplica. */
  opId?: string | null;
}

const filaLead = (input: NuevoLeadPublico) => ({
  producto_id: input.productoId,
  producto_nombre: input.productoNombre,
  nombre: input.nombre,
  telefono: input.telefono,
  mensaje: input.mensaje,
  folio: input.folio ?? null,
  cantidad: Math.max(1, Math.min(50, Math.round(Number(input.cantidad) || 1))),
  cuotas_preferidas: input.cuotasPreferidas ?? null,
  op_id: input.opId ?? null,
});

export async function crearLeadPublicoDb(db: SupabaseClient, input: NuevoLeadPublico): Promise<{ duplicado: boolean }> {
  const { error } = await db.from("leads_publicos").insert(filaLead(input));
  if (error) {
    // Mismo op_id reintentado: el lead YA está — éxito idempotente.
    if ((error as { code?: string }).code === "23505") return { duplicado: true };
    throw error;
  }
  return { duplicado: false };
}

/**
 * Lote del CARRITO público en UN insert atómico (barrida 15-08: el loop ítem
 * por ítem dejaba mitad del carrito insertado cuando fallaba el 3º de 5, y el
 * reintento natural del visitante duplicaba los primeros). Si el lote entero
 * choca 23505 (reintento del MISMO pedido), cae a por-ítem para que ningún
 * producto nuevo quede atrás — converge por los op_id.
 */
export async function crearLeadsPublicosDb(db: SupabaseClient, filas: NuevoLeadPublico[]): Promise<void> {
  if (filas.length === 0) return;
  const { error } = await db.from("leads_publicos").insert(filas.map(filaLead));
  if (!error) return;
  if ((error as { code?: string }).code !== "23505") throw error;
  for (const f of filas) await crearLeadPublicoDb(db, f);
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
