// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — BASE DE CAJA del cobrador (apertura del día, tabla
//  `aperturas_caja` 0105). La base es el efectivo de arranque que el supervisor
//  le da al cobrador; se devuelve junto con lo cobrado al cerrar la jornada.
//  Degrada a 0 / vacío si 0105 aún no corrió (nunca rompe: base=0 = conducta previa).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyUY } from "@/lib/fecha";
import { toIso } from "@/lib/format";
import { tablaFaltante } from "./errores";

/** Base de arranque de UN cobrador para un día (0 si no tiene / falta 0105). */
export async function getAperturaDia(
  db: SupabaseClient,
  cobradorId: string,
  hoy: Date = new Date(),
): Promise<number> {
  try {
    const { data, error } = await db
      .from("aperturas_caja")
      .select("base")
      .eq("cobrador_id", cobradorId)
      .eq("fecha", toIso(hoyUY(hoy)))
      .maybeSingle();
    if (error) throw error;
    return data ? Math.round(Number(data.base)) : 0;
  } catch (e) {
    if (tablaFaltante(e)) return 0;
    throw e;
  }
}

/** Bases de arranque del día por cobrador (para el panel del gestor). Opcionalmente
 *  acotado a un conjunto de cobradores (zona del supervisor). Vacío si falta 0105. */
export async function getAperturasDia(
  db: SupabaseClient,
  hoy: Date = new Date(),
  cobradorIds?: string[] | null,
): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  try {
    let q = db.from("aperturas_caja").select("cobrador_id, base").eq("fecha", toIso(hoyUY(hoy)));
    if (cobradorIds) {
      if (cobradorIds.length === 0) return m;
      q = q.in("cobrador_id", cobradorIds);
    }
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data ?? []) m.set(r.cobrador_id as string, Math.round(Number(r.base)));
  } catch (e) {
    if (!tablaFaltante(e)) throw e; // sin 0105 → mapa vacío (base 0 en todos lados)
  }
  return m;
}

/** Fija (o corrige) la base de arranque de un cobrador para HOY. Upsert por
 *  (cobrador_id, fecha): una base por día. Corre con la sesión del gestor (RLS
 *  0105 lo acota a su zona). El registro guarda quién la entregó. */
export async function setAperturaDb(
  db: SupabaseClient,
  input: { cobradorId: string; base: number; entregadaPor: string; nota?: string | null },
  hoy: Date = new Date(),
): Promise<void> {
  const { error } = await db.from("aperturas_caja").upsert(
    {
      cobrador_id: input.cobradorId,
      fecha: toIso(hoyUY(hoy)),
      base: Math.max(0, Math.round(input.base)),
      entregada_por: input.entregadaPor,
      nota: input.nota ?? null,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "cobrador_id,fecha" },
  );
  if (error) throw error;
}
