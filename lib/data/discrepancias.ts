// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — TRIAGE de discrepancias de dinero (0109). Es la anotación
//  humana del estado de cada divergencia que DETECTA la reconciliación: NO es la
//  verdad del dinero (esa vive en `pagos`, inmutable), es "esto ya lo revisé /
//  lo acepté como baseline / lo resolví", con quién y cuándo. Degrada a vacío si
//  0109 aún no corrió (el panel sigue detectando, solo sin el estado de triage).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "./errores";

export type EstadoDiscrepancia = "abierto" | "en_progreso" | "resuelto" | "aceptado";
export const ESTADOS_DISCREPANCIA: EstadoDiscrepancia[] = ["abierto", "en_progreso", "resuelto", "aceptado"];

/** Un estado "cerrado" (ya no reclama atención en el panel). */
export function esCerrada(estado: EstadoDiscrepancia): boolean {
  return estado === "resuelto" || estado === "aceptado";
}

export interface TriageDiscrepancia {
  estado: EstadoDiscrepancia;
  nota: string | null;
  abiertoEn: string;
  resueltoEn: string | null;
}

/** Triage por crédito para un conjunto de créditos (los que el panel muestra). */
export async function getDiscrepanciasMap(
  db: SupabaseClient,
  creditoIds: readonly string[],
): Promise<Map<string, TriageDiscrepancia>> {
  const map = new Map<string, TriageDiscrepancia>();
  if (creditoIds.length === 0) return map;
  try {
    for (let i = 0; i < creditoIds.length; i += 200) {
      const lote = creditoIds.slice(i, i + 200);
      const { data, error } = await db
        .from("discrepancias_dinero")
        .select("credito_id, estado, nota, abierto_en, resuelto_en")
        .in("credito_id", lote as string[]);
      if (error) throw error;
      for (const r of data ?? []) {
        map.set(r.credito_id as string, {
          estado: r.estado as EstadoDiscrepancia,
          nota: (r.nota as string | null) ?? null,
          abiertoEn: r.abierto_en as string,
          resueltoEn: (r.resuelto_en as string | null) ?? null,
        });
      }
    }
  } catch (e) {
    if (!tablaFaltante(e)) throw e; // 0109 sin correr → sin triage (degrada)
  }
  return map;
}

export interface UpsertDiscrepancia {
  creditoId: string;
  estado: EstadoDiscrepancia;
  nota: string | null;
  /** Snapshot del hallazgo (solo se guarda al ABRIR el triage). */
  tipo?: string | null;
  montoDiferencia?: number | null;
  /** usuario admin que triagea (= app_usuario_id()). */
  adminId: string;
  /** ISO de "ahora" (el caller lo pasa; evita new Date() en capas puras). */
  ahoraIso: string;
}

/**
 * Crea o actualiza el triage de un crédito. En ALTA fija `abierto_por` (RLS lo
 * exige = app_usuario_id()). Al pasar a un estado cerrado (resuelto/aceptado)
 * sella `resuelto_por`/`resuelto_en`; al reabrir, los limpia. `actualizado_en`
 * lo mantiene el trigger.
 */
export async function upsertDiscrepanciaDb(db: SupabaseClient, input: UpsertDiscrepancia): Promise<void> {
  const cerrada = esCerrada(input.estado);
  const { data: existe } = await db
    .from("discrepancias_dinero")
    .select("id")
    .eq("credito_id", input.creditoId)
    .maybeSingle();

  if (existe) {
    const { error } = await db
      .from("discrepancias_dinero")
      .update({
        estado: input.estado,
        nota: input.nota,
        resuelto_por: cerrada ? input.adminId : null,
        resuelto_en: cerrada ? input.ahoraIso : null,
      })
      .eq("credito_id", input.creditoId);
    if (error) throw error;
  } else {
    const { error } = await db.from("discrepancias_dinero").insert({
      credito_id: input.creditoId,
      tipo: input.tipo ?? null,
      monto_diferencia: input.montoDiferencia ?? null,
      estado: input.estado,
      nota: input.nota,
      abierto_por: input.adminId,
      resuelto_por: cerrada ? input.adminId : null,
      resuelto_en: cerrada ? input.ahoraIso : null,
    });
    if (error) throw error;
  }
}
