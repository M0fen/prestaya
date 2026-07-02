// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — MASCOTA de la vista de cliente (tabla `mascotas`, 0012).
//  Degrada a null si la tabla aún no existe (para no romper la vista mientras
//  no se corrió la migración; el cliente sigue con localStorage).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  especiePorId,
  accesorioPorId,
  type EstadoMascota,
} from "@/lib/mascota";
import { tablaFaltante } from "./errores";

export async function getMascota(
  db: SupabaseClient,
  clienteId: string,
): Promise<EstadoMascota | null> {
  try {
    const { data, error } = await db
      .from("mascotas")
      .select("especie, nombre, accesorio, carino, ultima_interaccion")
      .eq("cliente_id", clienteId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      especie: (data.especie as string) ?? "kiwi",
      nombre: (data.nombre as string) ?? "",
      accesorio: (data.accesorio as string) ?? "ninguno",
      carino: Number(data.carino ?? 60),
      ultimaInteraccion: (data.ultima_interaccion as string | null) ?? null,
    };
  } catch (e) {
    if (tablaFaltante(e)) return null;
    throw e;
  }
}

/** Upsert de la mascota. Sanea especie/accesorio contra el catálogo. */
export async function upsertMascota(
  db: SupabaseClient,
  clienteId: string,
  e: EstadoMascota,
): Promise<void> {
  const { error } = await db.from("mascotas").upsert({
    cliente_id: clienteId,
    especie: especiePorId(e.especie).id,
    nombre: (e.nombre ?? "").trim().slice(0, 16),
    accesorio: accesorioPorId(e.accesorio).id,
    carino: Math.max(0, Math.min(100, Math.round(e.carino))),
    ultima_interaccion: e.ultimaInteraccion,
    actualizado_en: new Date().toISOString(),
  });
  if (error) throw error;
}
