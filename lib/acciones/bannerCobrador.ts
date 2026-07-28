"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — BANNER AL EQUIPO (admin/supervisor → cobradores, 0050).
//  Crear un aviso y apagarlo. Solo gestores (RLS lo refuerza). Con auditoría.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { hrefSeguro } from "@/lib/seguridad";
import type { TemaBanner } from "@/lib/data/bannerCobrador";

type Resultado = { ok: true } | { ok: false; error: string };

const TEMAS: TemaBanner[] = ["azul", "verde", "ambar", "rojo"];
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Solo http(s) para una imagen que va a un <img src>. */
function imagenSegura(url: string | null | undefined): string | null {
  const t = (url ?? "").trim();
  return /^https?:\/\//i.test(t) ? t : null;
}

/** Publica un banner para la app del cobrador. Los campos de publicidad
 *  (titulo/imagen/botón) son opcionales: sin ellos es un aviso de texto. */
export async function crearBannerCobrador(input: {
  texto: string;
  tema: TemaBanner;
  /** Horas hasta que se apaga solo (0/undefined = sin vencimiento). */
  expiraEnHoras?: number;
  titulo?: string | null;
  imagenUrl?: string | null;
  ctaTexto?: string | null;
  ctaUrl?: string | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  // Publicidad opcional (saneada: link seguro, imagen solo http(s)).
  const titulo = (input.titulo ?? "").trim().slice(0, 60) || null;
  const imagen_url = imagenSegura(input.imagenUrl);
  const cta_url = hrefSeguro((input.ctaUrl ?? "").trim() || null);
  const cta_texto = (input.ctaTexto ?? "").trim().slice(0, 40) || null;
  // Una OFERTA (título/imagen/botón) NO necesita texto; un aviso de texto sí.
  const esOferta = Boolean(titulo || imagen_url || cta_url);
  const texto = (input.texto ?? "").trim();
  if (!esOferta && texto.length < 3) return { ok: false, error: "Escribí el aviso (mínimo 3 caracteres)." };
  if (texto.length > 240) return { ok: false, error: "Máximo 240 caracteres." };
  const tema: TemaBanner = TEMAS.includes(input.tema) ? input.tema : "azul";
  const horas = Number(input.expiraEnHoras);
  const expira_en =
    Number.isFinite(horas) && horas > 0 ? new Date(Date.now() + horas * 3_600_000).toISOString() : null;
  try {
    const db = await createSupabaseServer();
    const { error } = await db
      .from("banner_cobrador")
      .insert({ texto, tema, activo: true, creado_por: u.id, expira_en, titulo, imagen_url, cta_texto, cta_url });
    if (error) throw error;
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Publicó banner al equipo",
      entidad: "banner_cobrador",
      entidadId: null,
    });
    revalidatePath("/admin/chat");
    revalidatePath("/cobrador");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo publicar. ¿Corriste las migraciones 0050 y 0080?" };
  }
}

/** Edita un banner existente (arreglar un typo sin borrar y rehacer). Reaplica
 *  el vencimiento desde AHORA (0 = sin vencimiento). Mismas reglas que crear. */
export async function actualizarBannerCobrador(input: {
  id: string;
  texto: string;
  tema: TemaBanner;
  expiraEnHoras?: number;
  titulo?: string | null;
  imagenUrl?: string | null;
  ctaTexto?: string | null;
  ctaUrl?: string | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!ES_UUID.test(input.id)) return { ok: false, error: "Banner inválido." };

  const titulo = (input.titulo ?? "").trim().slice(0, 60) || null;
  const imagen_url = imagenSegura(input.imagenUrl);
  const cta_url = hrefSeguro((input.ctaUrl ?? "").trim() || null);
  const cta_texto = (input.ctaTexto ?? "").trim().slice(0, 40) || null;
  // Una OFERTA (tiene título/imagen/botón) no necesita texto; un aviso de texto sí.
  const esOferta = Boolean(titulo || imagen_url || cta_url);
  const texto = (input.texto ?? "").trim();
  if (!esOferta && texto.length < 3) return { ok: false, error: "Escribí el aviso (mínimo 3 caracteres)." };
  if (texto.length > 240) return { ok: false, error: "Máximo 240 caracteres." };
  const tema: TemaBanner = TEMAS.includes(input.tema) ? input.tema : "azul";
  const horas = Number(input.expiraEnHoras);
  const expira_en =
    Number.isFinite(horas) && horas > 0 ? new Date(Date.now() + horas * 3_600_000).toISOString() : null;

  try {
    const db = await createSupabaseServer();
    const { error } = await db
      .from("banner_cobrador")
      .update({ texto, tema, expira_en, titulo, imagen_url, cta_texto, cta_url, activo: true })
      .eq("id", input.id);
    if (error) throw error;
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Editó banner al equipo",
      entidad: "banner_cobrador",
      entidadId: input.id,
    });
    revalidatePath("/admin/chat");
    revalidatePath("/cobrador");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar el cambio. Probá de nuevo." };
  }
}

/** Apaga (desactiva) un banner. */
export async function desactivarBannerCobrador(id: string): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!ES_UUID.test(id)) return { ok: false, error: "Banner inválido." };
  try {
    const db = await createSupabaseServer();
    const { error } = await db.from("banner_cobrador").update({ activo: false }).eq("id", id);
    if (error) throw error;
    revalidatePath("/admin/chat");
    revalidatePath("/cobrador");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo apagar." };
  }
}
