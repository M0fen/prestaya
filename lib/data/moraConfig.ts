// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CONFIG de MORA (fila única de `config_mora`, 0016).
//  Degrada a "off" (sin recargo) si la tabla aún no existe.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG_MORA_DEFAULT, type ConfigMora, type ModoMora } from "@/lib/moraCargo";
import { tablaFaltante } from "./errores";

export async function getConfigMora(db: SupabaseClient): Promise<ConfigMora> {
  try {
    const { data, error } = await db.from("config_mora").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    if (!data) return CONFIG_MORA_DEFAULT;
    return {
      modo: (data.modo as ModoMora) ?? "off",
      valor: Number(data.valor ?? 0),
      cuotasGracia: Number(data.cuotas_gracia ?? 1),
      topePct: Number(data.tope_pct ?? 30),
    };
  } catch (e) {
    if (tablaFaltante(e)) return CONFIG_MORA_DEFAULT;
    throw e;
  }
}

export async function setConfigMora(
  db: SupabaseClient,
  cfg: ConfigMora,
  actualizadoPor: string,
): Promise<void> {
  const { error } = await db.from("config_mora").upsert({
    id: 1,
    modo: cfg.modo,
    valor: cfg.valor,
    cuotas_gracia: Math.round(cfg.cuotasGracia),
    tope_pct: cfg.topePct,
    actualizado_por: actualizadoPor,
    actualizado_en: new Date().toISOString(),
  });
  if (error) throw error;
}
