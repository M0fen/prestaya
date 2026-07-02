// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — AUDITORÍA (log inmutable, tabla `auditoria`, 0015).
//  `registrarAuditoria` es BEST-EFFORT: nunca tira ni rompe la acción que la
//  invoca (si falla o falta la tabla, se ignora en silencio). `getAuditoria`
//  degrada a vacío si 0015 aún no corrió.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "./errores";

export interface EntradaAuditoria {
  actorId: string;
  actorNombre: string;
  accion: string;
  entidad?: string | null;
  entidadId?: string | null;
  detalle?: string | null;
}

/** Registra una acción en el log. Best-effort: si falla, no interrumpe nada. */
export async function registrarAuditoria(
  db: SupabaseClient,
  e: EntradaAuditoria,
): Promise<void> {
  try {
    await db.from("auditoria").insert({
      actor_id: e.actorId,
      actor_nombre: e.actorNombre,
      accion: e.accion,
      entidad: e.entidad ?? null,
      entidad_id: e.entidadId ?? null,
      detalle: e.detalle ?? null,
    });
  } catch {
    /* la auditoría nunca debe romper la operación principal */
  }
}

export interface RegistroAuditoria {
  id: string;
  actorNombre: string;
  accion: string;
  entidad: string | null;
  entidadId: string | null;
  detalle: string | null;
  creadoEn: string;
}

/** Últimos registros de auditoría (para el panel). Degrada a [] si falta 0015. */
export async function getAuditoria(
  db: SupabaseClient,
  limite = 120,
): Promise<RegistroAuditoria[]> {
  try {
    const { data, error } = await db
      .from("auditoria")
      .select("*")
      .order("creado_en", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id as string,
      actorNombre: (r.actor_nombre as string | null) ?? "—",
      accion: r.accion as string,
      entidad: (r.entidad as string | null) ?? null,
      entidadId: (r.entidad_id as string | null) ?? null,
      detalle: (r.detalle as string | null) ?? null,
      creadoEn: r.creado_en as string,
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}
