// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ANUNCIOS (banner de la vista de cliente).
//  Devuelve el anuncio vigente de mayor prioridad para el segmento dado.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Anuncio, SegmentoAnuncio, TemaAnuncio } from "@/types/db";
import type { ClienteSegmentable, DefinicionSegmento } from "@/lib/segmentos";
import { clienteEnSegmento } from "@/lib/segmentos";
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
    etiqueta: (r.etiqueta as string | null) ?? null,
    tema: r.tema as Anuncio["tema"],
    prioridad: Number(r.prioridad),
    activo: r.activo as boolean,
    segmento: r.segmento as SegmentoAnuncio,
    // jsonb → objeto (o null si la columna no existe / está vacía).
    segmento_def: (r.segmento_def as DefinicionSegmento | null) ?? null,
    fecha_inicio: r.fecha_inicio as string,
    fecha_fin: (r.fecha_fin as string | null) ?? null,
    creado_por: (r.creado_por as string | null) ?? null,
    creado_en: r.creado_en as string,
    actualizado_en: r.actualizado_en as string,
  };
}

/** ¿Este anuncio aplica al cliente? Si tiene `segmento_def` (audiencia rica 0089),
 *  MANDA sobre el enum; si no, cae al enum viejo (todos/al_dia/con_pendientes). */
function anuncioAplica(a: Anuncio, cliente: ClienteSegmentable): boolean {
  if (a.segmento_def) return clienteEnSegmento(cliente, a.segmento_def);
  if (a.segmento === "al_dia") return cliente.alDia;
  if (a.segmento === "con_pendientes") return !cliente.alDia;
  return true; // "todos"
}

/**
 * Anuncios vigentes a mostrar AHORA para un cliente (carrusel). Vigentes = activos,
 * ya empezaron, no vencieron, y su AUDIENCIA aplica al cliente (segmento_def rico o
 * el enum viejo). El filtro de audiencia se hace en JS con clienteEnSegmento (los
 * anuncios activos son pocos) para que segmento_def pueda targetear por calificación/
 * zona/cobrador/individual, que la query SQL por enum no permitía. Ordenados por
 * prioridad, luego los más recientes; se corta a `limite` DESPUÉS de filtrar.
 */
export async function getAnunciosActivos(
  db: SupabaseClient,
  cliente: ClienteSegmentable,
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
    .order("prioridad", { ascending: false })
    .order("fecha_inicio", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapAnuncio).filter((a) => anuncioAplica(a, cliente)).slice(0, limite);
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
  etiqueta: string | null;
  tema: TemaAnuncio;
  prioridad: number;
  activo: boolean;
  segmento: SegmentoAnuncio;
  /** Audiencia rica (0089). null = usar el enum `segmento`. */
  segmentoDef: DefinicionSegmento | null;
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
    etiqueta: input.etiqueta,
    tema: input.tema,
    prioridad: input.prioridad,
    activo: input.activo,
    segmento: input.segmento,
    segmento_def: input.segmentoDef, // jsonb; null = a todos (usa el enum)
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
