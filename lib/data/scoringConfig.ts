// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CONFIG del scoring (0028). Fila única (id=1).
//  Degrada al modelo por defecto si la tabla aún no existe.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG_SCORING_DEFAULT, type ConfigScoring } from "@/lib/scoring";
import { tablaFaltante } from "./errores";

export async function getConfigScoring(db: SupabaseClient): Promise<ConfigScoring> {
  try {
    const { data, error } = await db.from("config_scoring").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    if (!data) return CONFIG_SCORING_DEFAULT;
    return {
      pesos: {
        cumplimiento: Number(data.peso_cumplimiento),
        moraActual: Number(data.peso_mora),
        experiencia: Number(data.peso_experiencia),
        consistencia: Number(data.peso_consistencia),
        antiguedad: Number(data.peso_antiguedad),
      },
      umbrales: {
        excelente: Number(data.umbral_excelente),
        bueno: Number(data.umbral_bueno),
        regular: Number(data.umbral_regular),
      },
    };
  } catch (e) {
    if (tablaFaltante(e)) return CONFIG_SCORING_DEFAULT;
    throw e;
  }
}

export async function setConfigScoring(
  db: SupabaseClient,
  cfg: ConfigScoring,
  porId: string,
): Promise<void> {
  const { error } = await db.from("config_scoring").upsert({
    id: 1,
    peso_cumplimiento: cfg.pesos.cumplimiento,
    peso_mora: cfg.pesos.moraActual,
    peso_experiencia: cfg.pesos.experiencia,
    peso_consistencia: cfg.pesos.consistencia,
    peso_antiguedad: cfg.pesos.antiguedad,
    umbral_excelente: cfg.umbrales.excelente,
    umbral_bueno: cfg.umbrales.bueno,
    umbral_regular: cfg.umbrales.regular,
    actualizado_por: porId,
    actualizado_en: new Date().toISOString(),
  });
  if (error) throw error;
}
