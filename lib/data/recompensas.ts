// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RECOMPENSAS (tabla `recompensas`, 0018).
//  Gestores gestionan (RLS); la vista de cliente lee las activas por
//  service_role. Degrada a [] si 0018 aún no corrió.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HitoTipo, Recompensa } from "@/lib/recompensas";
import { tablaFaltante } from "./errores";

export interface RecompensaAdmin extends Recompensa {
  activo: boolean;
  orden: number;
}

function mapAdmin(r: Record<string, unknown>): RecompensaAdmin {
  return {
    id: r.id as string,
    titulo: r.titulo as string,
    premio: r.premio as string,
    hitoTipo: r.hito_tipo as HitoTipo,
    hitoValor: Number(r.hito_valor ?? 0),
    activo: Boolean(r.activo),
    orden: Number(r.orden ?? 0),
  };
}

/** Todas las recompensas (gestor). Ordenadas. Degrada a [] si falta 0018. */
export async function getRecompensas(db: SupabaseClient): Promise<RecompensaAdmin[]> {
  try {
    const { data, error } = await db.from("recompensas").select("*").order("orden").order("creado_en");
    if (error) throw error;
    return (data ?? []).map(mapAdmin);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Solo las recompensas ACTIVAS, para la vista de cliente. */
export async function getRecompensasActivas(db: SupabaseClient): Promise<Recompensa[]> {
  try {
    const { data, error } = await db
      .from("recompensas")
      .select("id, titulo, premio, hito_tipo, hito_valor")
      .eq("activo", true)
      .order("orden");
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id as string,
      titulo: r.titulo as string,
      premio: r.premio as string,
      hitoTipo: r.hito_tipo as HitoTipo,
      hitoValor: Number(r.hito_valor ?? 0),
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export async function crearRecompensa(
  db: SupabaseClient,
  r: { titulo: string; premio: string; hitoTipo: HitoTipo; hitoValor: number; orden: number },
): Promise<void> {
  const { error } = await db.from("recompensas").insert({
    titulo: r.titulo,
    premio: r.premio,
    hito_tipo: r.hitoTipo,
    hito_valor: r.hitoValor,
    orden: r.orden,
  });
  if (error) throw error;
}

export async function actualizarRecompensa(
  db: SupabaseClient,
  id: string,
  patch: { activo?: boolean; titulo?: string; premio?: string; hitoValor?: number },
): Promise<void> {
  const fila: Record<string, unknown> = {};
  if (patch.activo !== undefined) fila.activo = patch.activo;
  if (patch.titulo !== undefined) fila.titulo = patch.titulo;
  if (patch.premio !== undefined) fila.premio = patch.premio;
  if (patch.hitoValor !== undefined) fila.hito_valor = patch.hitoValor;
  const { error } = await db.from("recompensas").update(fila).eq("id", id);
  if (error) throw error;
}

export async function borrarRecompensa(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("recompensas").delete().eq("id", id);
  if (error) throw error;
}
