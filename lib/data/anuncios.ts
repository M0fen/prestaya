// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ANUNCIOS (banner de la vista de cliente).
//  Devuelve el anuncio vigente de mayor prioridad para el segmento dado.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Anuncio, SegmentoAnuncio, TemaAnuncio } from "@/types/db";
import { tablaFaltante } from "@/lib/data/errores";

/** Convierte una fila cruda en un Anuncio tipado. */
function mapAnuncio(r: Record<string, unknown>): Anuncio {
  return {
    id: r.id as string,
    titulo: r.titulo as string,
    cuerpo: (r.cuerpo as string | null) ?? null,
    cta_texto: (r.cta_texto as string | null) ?? null,
    cta_url: (r.cta_url as string | null) ?? null,
    imagen_url: (r.imagen_url as string | null) ?? null,
    tema: r.tema as Anuncio["tema"],
    prioridad: Number(r.prioridad),
    activo: r.activo as boolean,
    segmento: r.segmento as SegmentoAnuncio,
    fecha_inicio: r.fecha_inicio as string,
    fecha_fin: (r.fecha_fin as string | null) ?? null,
    creado_por: (r.creado_por as string | null) ?? null,
    creado_en: r.creado_en as string,
    actualizado_en: r.actualizado_en as string,
  };
}

/**
 * Devuelve los anuncios vigentes a mostrar AHORA para un cliente (para el
 * carrusel). Vigentes = activos, ya empezaron, no vencieron y su segmento
 * aplica al cliente. Ordenados por prioridad (luego, los más recientes).
 *
 * @param segmentoCliente  "al_dia" o "con_pendientes" según el estado del crédito.
 */
export async function getAnunciosActivos(
  db: SupabaseClient,
  segmentoCliente: Exclude<SegmentoAnuncio, "todos">,
  ahora: Date = new Date(),
  limite = 6,
): Promise<Anuncio[]> {
  const iso = ahora.toISOString();

  const { data, error } = await db
    .from("anuncios")
    .select("*")
    .eq("activo", true)
    .lte("fecha_inicio", iso)
    .or(`fecha_fin.is.null,fecha_fin.gte.${iso}`)
    .in("segmento", ["todos", segmentoCliente])
    .order("prioridad", { ascending: false })
    .order("fecha_inicio", { ascending: false })
    .limit(limite);

  if (error) throw error;
  return (data ?? []).map(mapAnuncio);
}

// ── Administración de anuncios (gestor) ────────────────────────────────────

/** Todos los anuncios (activos e inactivos) para el panel. Vacío si falta 0003. */
export async function getAnunciosAdmin(db: SupabaseClient): Promise<Anuncio[]> {
  try {
    const { data, error } = await db
      .from("anuncios")
      .select("*")
      .order("prioridad", { ascending: false })
      .order("creado_en", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapAnuncio);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Campos editables de un anuncio (desde el panel). */
export interface AnuncioInput {
  titulo: string;
  cuerpo: string | null;
  ctaTexto: string | null;
  ctaUrl: string | null;
  imagenUrl: string | null;
  tema: TemaAnuncio;
  prioridad: number;
  activo: boolean;
  segmento: SegmentoAnuncio;
  fechaInicio: string | null; // ISO o null (= ahora)
  fechaFin: string | null; // ISO o null (= sin vencimiento)
}

function aFila(input: AnuncioInput): Record<string, unknown> {
  return {
    titulo: input.titulo,
    cuerpo: input.cuerpo,
    cta_texto: input.ctaTexto,
    cta_url: input.ctaUrl,
    imagen_url: input.imagenUrl,
    tema: input.tema,
    prioridad: input.prioridad,
    activo: input.activo,
    segmento: input.segmento,
    ...(input.fechaInicio ? { fecha_inicio: input.fechaInicio } : {}),
    fecha_fin: input.fechaFin,
  };
}

export async function crearAnuncioDb(
  db: SupabaseClient,
  input: AnuncioInput,
  creadoPor: string,
): Promise<void> {
  const { error } = await db.from("anuncios").insert({ ...aFila(input), creado_por: creadoPor });
  if (error) throw error;
}

export async function actualizarAnuncioDb(
  db: SupabaseClient,
  id: string,
  input: AnuncioInput,
): Promise<void> {
  const { error } = await db.from("anuncios").update(aFila(input)).eq("id", id);
  if (error) throw error;
}

export async function setAnuncioActivoDb(
  db: SupabaseClient,
  id: string,
  activo: boolean,
): Promise<void> {
  const { error } = await db.from("anuncios").update({ activo }).eq("id", id);
  if (error) throw error;
}

export async function borrarAnuncioDb(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("anuncios").delete().eq("id", id);
  if (error) throw error;
}
