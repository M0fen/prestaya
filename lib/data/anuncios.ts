// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ANUNCIOS (banner de la vista de cliente).
//  Devuelve el anuncio vigente de mayor prioridad para el segmento dado.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Anuncio, SegmentoAnuncio } from "@/types/db";

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
