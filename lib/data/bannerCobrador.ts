// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — BANNER AL EQUIPO (aviso admin → app del cobrador, 0050).
//  Degrada a vacío si 0050 aún no corrió (la UI no rompe).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "./errores";

export type TemaBanner = "azul" | "verde" | "ambar" | "rojo";

export interface BannerCobrador {
  id: string;
  texto: string;
  tema: TemaBanner;
  activo: boolean;
  creadoEn: string;
  expiraEn: string | null;
  // Campos de publicidad/oferta (0080, todos opcionales). Si vienen null, el
  // banner se muestra como un aviso de texto clásico.
  titulo: string | null;
  imagenUrl: string | null;
  ctaTexto: string | null;
  ctaUrl: string | null;
}

function mapBanner(r: Record<string, unknown>): BannerCobrador {
  return {
    id: r.id as string,
    texto: r.texto as string,
    tema: (r.tema as TemaBanner) ?? "azul",
    activo: Boolean(r.activo),
    creadoEn: r.creado_en as string,
    expiraEn: (r.expira_en as string | null) ?? null,
    titulo: (r.titulo as string | null) ?? null,
    imagenUrl: (r.imagen_url as string | null) ?? null,
    ctaTexto: (r.cta_texto as string | null) ?? null,
    ctaUrl: (r.cta_url as string | null) ?? null,
  };
}

/** El banner ACTIVO y vigente (no expirado) más reciente, o null. Para el cobrador. */
export async function getBannerCobradorActivo(db: SupabaseClient): Promise<BannerCobrador | null> {
  try {
    const ahora = new Date().toISOString();
    const { data, error } = await db
      .from("banner_cobrador")
      .select("*")
      .eq("activo", true)
      .order("creado_en", { ascending: false })
      .limit(10);
    if (error) throw error;
    const vigente = (data ?? [])
      .map(mapBanner)
      .find((b) => !b.expiraEn || b.expiraEn > ahora);
    return vigente ?? null;
  } catch (e) {
    if (tablaFaltante(e)) return null;
    throw e;
  }
}

/** Todos los banners recientes (para el panel de gestión del admin). */
export async function getBannersCobrador(db: SupabaseClient, limite = 20): Promise<BannerCobrador[]> {
  try {
    const { data, error } = await db
      .from("banner_cobrador")
      .select("*")
      .order("creado_en", { ascending: false })
      .limit(Math.max(1, Math.min(100, limite)));
    if (error) throw error;
    return (data ?? []).map(mapBanner);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}
