// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RIFA (0045). Una rifa promocional que el admin le muestra a
//  los clientes (o solo a los mejores). Banner con mensaje + foto del premio.
//  La foto vive en el bucket PÚBLICO 'rifas' (URL pública directa). Degrada a
//  null si la tabla no existe (0045 sin correr).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { tablaFaltante } from "./errores";
import type { Calificacion } from "@/types/db";
import type { ClienteSegmentable, DefinicionSegmento } from "@/lib/segmentos";
import { clienteEnSegmento } from "@/lib/segmentos";

export const BUCKET_RIFAS = "rifas";
const MAX_BYTES = 4_000_000;
const TIPOS_OK = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Calificaciones que cuentan como "mejores clientes" para la rifa dirigida. */
const MEJORES: ReadonlySet<Calificacion> = new Set<Calificacion>(["excelente", "bueno"]);

export interface Rifa {
  id: string;
  titulo: string;
  mensaje: string;
  premioTexto: string | null;
  botonTexto: string;
  fotoPath: string | null;
  /** URL pública de la foto del premio (si tiene). */
  fotoUrl: string | null;
  soloMejores: boolean;
  /** Audiencia rica (0089). Si está, MANDA sobre soloMejores. null = usa soloMejores. */
  segmentoDef: DefinicionSegmento | null;
  activo: boolean;
}

function mapRifa(r: Record<string, unknown>): Rifa {
  const fotoPath = (r.foto_path as string | null) ?? null;
  return {
    id: r.id as string,
    titulo: (r.titulo as string) ?? "Gran rifa",
    mensaje: (r.mensaje as string) ?? "",
    premioTexto: (r.premio_texto as string | null) ?? null,
    botonTexto: (r.boton_texto as string) ?? "Ver premio",
    fotoPath,
    fotoUrl: fotoPath ? urlPublicaRifa(fotoPath) : null,
    soloMejores: (r.solo_mejores as boolean) ?? true,
    segmentoDef: (r.segmento_def as DefinicionSegmento | null) ?? null,
    activo: (r.activo as boolean) ?? false,
  };
}

/** URL pública (permanente) de una foto del bucket 'rifas'. */
export function urlPublicaRifa(path: string): string {
  return createSupabaseAdmin().storage.from(BUCKET_RIFAS).getPublicUrl(path).data.publicUrl;
}

/** La rifa (única fila de configuración). Para el admin. null si falta 0045. */
export async function getRifa(db: SupabaseClient): Promise<Rifa | null> {
  try {
    const { data, error } = await db
      .from("rifas")
      .select("*")
      .order("creado_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRifa(data) : null;
  } catch (e) {
    if (tablaFaltante(e)) return null;
    throw e;
  }
}

/**
 * La rifa a MOSTRARLE a un cliente: null si no hay rifa activa o si su AUDIENCIA no
 * lo incluye. Si la rifa tiene `segmentoDef` (audiencia rica 0089) MANDA sobre el
 * viejo `soloMejores`; si no, cae a la regla previa (todos, o solo excelente/bueno).
 */
export async function getRifaParaCliente(
  db: SupabaseClient,
  cliente: ClienteSegmentable,
): Promise<Rifa | null> {
  const rifa = await getRifa(db);
  if (!rifa || !rifa.activo) return null;
  if (rifa.segmentoDef) return clienteEnSegmento(cliente, rifa.segmentoDef) ? rifa : null;
  if (rifa.soloMejores && !(cliente.calificacion && MEJORES.has(cliente.calificacion))) return null;
  return rifa;
}

// ── Escrituras (admin) ─────────────────────────────────────────────────────

export async function guardarRifaDb(
  db: SupabaseClient,
  input: {
    id?: string | null;
    titulo: string;
    mensaje: string;
    premioTexto: string | null;
    botonTexto: string;
    soloMejores: boolean;
    segmentoDef: DefinicionSegmento | null;
    activo: boolean;
  },
): Promise<string> {
  const fila = {
    titulo: input.titulo,
    mensaje: input.mensaje,
    premio_texto: input.premioTexto,
    boton_texto: input.botonTexto,
    solo_mejores: input.soloMejores,
    segmento_def: input.segmentoDef,
    activo: input.activo,
    actualizado_en: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await db.from("rifas").update(fila).eq("id", input.id);
    if (error) throw error;
    return input.id;
  }
  const { data, error } = await db.from("rifas").insert(fila).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export type ResultadoFotoRifa = { ok: true; path: string } | { ok: false; error: string };

/** Sube la foto del premio (service_role) y guarda la ruta en la rifa. */
export async function subirFotoRifa(rifaId: string, dataUrl: string): Promise<ResultadoFotoRifa> {
  const m = /^data:(image\/[a-zA-Z]+);base64,(.+)$/.exec(dataUrl ?? "");
  if (!m || !TIPOS_OK.has(m[1].toLowerCase())) return { ok: false, error: "La foto no es válida." };
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > MAX_BYTES) return { ok: false, error: "La foto es demasiado grande." };
  const admin = createSupabaseAdmin();
  const ext = m[1].split("/")[1].toLowerCase();
  const path = `${rifaId}/${Date.now()}.${ext}`;
  const up = await admin.storage.from(BUCKET_RIFAS).upload(path, buffer, {
    contentType: m[1].toLowerCase(),
    upsert: true,
  });
  if (up.error) return { ok: false, error: "No se pudo subir la foto (¿corriste la 0045?)." };
  const upd = await admin.from("rifas").update({ foto_path: path }).eq("id", rifaId);
  if (upd.error) return { ok: false, error: "No se pudo asociar la foto a la rifa." };
  return { ok: true, path };
}
