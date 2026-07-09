// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — FOTO del cliente (Supabase Storage, bucket privado 0044).
//  Sube por service_role (Server Action) y se lee con URL firmada de corta
//  duración. La tabla `clientes` solo guarda la ruta (`foto_path`). Degrada con
//  un error claro si falta el bucket/columna (no rompe el alta).
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const BUCKET_FOTOS = "clientes-fotos";
/** Tope defensivo del tamaño de la foto ya comprimida (base64). ~4MB. */
const MAX_BYTES = 4_000_000;
const TIPOS_OK = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ResultadoFoto = { ok: true; path: string } | { ok: false; error: string };

/** UUID v4-ish: el path del bucket se arma con el clienteId, así que lo validamos
 *  para no permitir `/` ni `..` (path traversal) desde un id manipulado. */
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parsea un data URL "data:image/xxx;base64,...." → {contentType, buffer}. */
function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const m = /^data:(image\/[a-zA-Z]+);base64,(.+)$/.exec(dataUrl ?? "");
  if (!m) return null;
  const contentType = m[1].toLowerCase();
  if (!TIPOS_OK.has(contentType)) return null;
  try {
    const buffer = Buffer.from(m[2], "base64");
    return { contentType, buffer };
  } catch {
    return null;
  }
}

/**
 * Sube la foto de un cliente y guarda la ruta en `clientes.foto_path`.
 * `dataUrl` es la imagen YA comprimida en el navegador (ver CapturaFoto).
 */
export async function subirFotoCliente(clienteId: string, dataUrl: string): Promise<ResultadoFoto> {
  if (!ES_UUID.test(clienteId)) return { ok: false, error: "Cliente inválido." };
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { ok: false, error: "La foto no es válida (formato o tamaño)." };
  if (parsed.buffer.length > MAX_BYTES) return { ok: false, error: "La foto es demasiado grande." };

  const admin = createSupabaseAdmin();
  const ext = parsed.contentType.split("/")[1];
  const path = `${clienteId}/${Date.now()}.${ext}`;
  const up = await admin.storage.from(BUCKET_FOTOS).upload(path, parsed.buffer, {
    contentType: parsed.contentType,
    upsert: true,
  });
  if (up.error) {
    // Bucket ausente (falta 0044) u otro error de storage.
    return { ok: false, error: "No se pudo guardar la foto (¿corriste la migración 0044?)." };
  }
  const upd = await admin.from("clientes").update({ foto_path: path }).eq("id", clienteId);
  if (upd.error) return { ok: false, error: "No se pudo asociar la foto al cliente." };
  return { ok: true, path };
}

/** URL firmada (temporal) para MOSTRAR la foto. null si no hay foto o falla. */
export async function urlFirmadaFoto(
  path: string | null | undefined,
  segundos = 3600,
): Promise<string | null> {
  if (!path) return null;
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.storage.from(BUCKET_FOTOS).createSignedUrl(path, segundos);
  if (error) return null;
  return data?.signedUrl ?? null;
}
