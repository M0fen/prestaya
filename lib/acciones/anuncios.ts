"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — ANUNCIOS / publicidad de temporada (solo gestores).
//  Mauricio y su esposa gestionan campañas sin tocar código: crear/editar,
//  activar, programar por fechas, segmentar y priorizar. Queda en auditoría.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import {
  crearAnuncioDb,
  actualizarAnuncioDb,
  setAnuncioActivoDb,
  borrarAnuncioDb,
  type AnuncioInput,
} from "@/lib/data/anuncios";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { hrefSeguro } from "@/lib/seguridad";
import type { SegmentoAnuncio, TemaAnuncio } from "@/types/db";

type Resultado = { ok: true } | { ok: false; error: string };

const TEMAS: TemaAnuncio[] = ["azul", "verde", "ambar", "oscuro"];
const SEGMENTOS: SegmentoAnuncio[] = ["todos", "al_dia", "con_pendientes"];

/** Solo http(s) para la imagen (se usa en <img src>). */
function imagenSegura(url: string | null): string | null {
  const t = (url ?? "").trim();
  return /^https?:\/\//i.test(t) ? t : null;
}

/** Convierte un valor de <input datetime-local> a ISO, o null. */
function aIso(v: string | null): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function sanear(raw: RawAnuncio): AnuncioInput | null {
  const titulo = (raw.titulo ?? "").trim().slice(0, 80);
  if (!titulo) return null;
  return {
    titulo,
    cuerpo: (raw.cuerpo ?? "").trim().slice(0, 240) || null,
    ctaTexto: (raw.ctaTexto ?? "").trim().slice(0, 40) || null,
    ctaUrl: hrefSeguro((raw.ctaUrl ?? "").trim() || null),
    imagenUrl: imagenSegura(raw.imagenUrl ?? null),
    tema: TEMAS.includes(raw.tema as TemaAnuncio) ? (raw.tema as TemaAnuncio) : "azul",
    prioridad: Math.max(0, Math.min(999, Math.round(Number(raw.prioridad) || 0))),
    activo: Boolean(raw.activo),
    segmento: SEGMENTOS.includes(raw.segmento as SegmentoAnuncio)
      ? (raw.segmento as SegmentoAnuncio)
      : "todos",
    fechaInicio: aIso(raw.fechaInicio ?? null),
    fechaFin: aIso(raw.fechaFin ?? null),
  };
}

export interface RawAnuncio {
  id?: string | null;
  titulo: string;
  cuerpo?: string | null;
  ctaTexto?: string | null;
  ctaUrl?: string | null;
  imagenUrl?: string | null;
  tema: string;
  prioridad: number;
  activo: boolean;
  segmento: string;
  fechaInicio?: string | null;
  fechaFin?: string | null;
}

export async function guardarAnuncio(raw: RawAnuncio): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  const input = sanear(raw);
  if (!input) return { ok: false, error: "Poné un título para el anuncio." };
  // Coherencia de fechas.
  if (input.fechaInicio && input.fechaFin && input.fechaFin <= input.fechaInicio) {
    return { ok: false, error: "La fecha de fin debe ser posterior al inicio." };
  }

  try {
    const db = await createSupabaseServer();
    if (raw.id) await actualizarAnuncioDb(db, raw.id, input);
    else await crearAnuncioDb(db, input, u.id);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: raw.id ? "Editó anuncio" : "Creó anuncio",
      entidad: "anuncio",
      entidadId: raw.id ?? undefined,
      detalle: `${input.titulo} · ${input.segmento}${input.activo ? "" : " (inactivo)"}`,
    });
    revalidatePath("/admin/anuncios");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. ¿Corriste la migración 0003?" };
  }
}

export async function alternarAnuncio(id: string, activo: boolean): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  try {
    const db = await createSupabaseServer();
    await setAnuncioActivoDb(db, id, activo);
    revalidatePath("/admin/anuncios");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo actualizar." };
  }
}

/** Sube una imagen para un anuncio al bucket público 'anuncios' (service_role)
 *  y devuelve su URL pública. Solo gestores. Valida tipo y tamaño. */
export async function subirImagenAnuncio(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Elegí una imagen." };
  if (file.size > 3 * 1024 * 1024) return { ok: false, error: "La imagen es muy grande (máx. 3 MB)." };
  const tipos = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  if (!tipos.includes(file.type)) return { ok: false, error: "Formato no soportado (PNG/JPG/WEBP/GIF)." };

  try {
    const db = createSupabaseAdmin();
    const ext = file.type.split("/")[1].replace("jpeg", "jpg");
    const nombre = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error } = await db.storage
      .from("anuncios")
      .upload(nombre, buf, { contentType: file.type, upsert: false });
    if (error) throw error;
    const { data } = db.storage.from("anuncios").getPublicUrl(nombre);
    return { ok: true, url: data.publicUrl };
  } catch {
    return { ok: false, error: "No se pudo subir la imagen. Probá de nuevo." };
  }
}

export async function eliminarAnuncio(id: string): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  try {
    const db = await createSupabaseServer();
    await borrarAnuncioDb(db, id);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Borró anuncio",
      entidad: "anuncio",
      entidadId: id,
    });
    revalidatePath("/admin/anuncios");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo borrar." };
  }
}
