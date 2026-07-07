// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — META de operación (recaudo mensual objetivo, 0025).
//  Fila única (id=1). Degrada a 0 (sin meta) si la tabla aún no existe.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "./errores";

/** Meta de recaudo mensual (0 = sin meta fijada). */
export async function getMetaMensual(db: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await db
      .from("config_operacion")
      .select("meta_recaudo_mensual")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    return Math.round(Number(data?.meta_recaudo_mensual ?? 0));
  } catch (e) {
    if (tablaFaltante(e)) return 0;
    throw e;
  }
}

export async function setMetaMensual(
  db: SupabaseClient,
  meta: number,
  actualizadoPor: string,
): Promise<void> {
  const { error } = await db.from("config_operacion").upsert({
    id: 1,
    meta_recaudo_mensual: Math.max(0, Math.round(meta)),
    actualizado_por: actualizadoPor,
    actualizado_en: new Date().toISOString(),
  });
  if (error) throw error;
}
