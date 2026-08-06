// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — BASE DE CAJA del cobrador (apertura del día, tabla
//  `aperturas_caja` 0105). La base es el efectivo de arranque que el supervisor
//  le da al cobrador; se devuelve junto con lo cobrado al cerrar la jornada.
//  Degrada a 0 / vacío si 0105 aún no corrió (nunca rompe: base=0 = conducta previa).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyUY } from "@/lib/fecha";
import { toIso } from "@/lib/format";
import { cajaFinal } from "@/lib/rendicion";
import { tablaFaltante } from "./errores";

/** De dónde salió la base del día: cargada a mano o arrastrada de la cuadra de ayer. */
export interface BaseDelDia {
  base: number;
  origen: "cargada" | "arrastre" | "sin_base";
  /** Solo en `arrastre`: el día del que viene, para poder decirlo en pantalla. */
  desdeFecha?: string;
  /** Solo en `arrastre`: cómo se llegó a ese número, para que el supervisor pueda
   *  seguir la cuenta sin abrir otra pantalla ("cobró X, entregó Y, le quedó Z"). */
  detalle?: { base: number; recaudado: number; gastos: number; entregado: number };
}

/**
 * Base de arranque de UN cobrador para un día, CON ARRASTRE.
 *
 * Regla de Carlos (06-08): "que la cuadra final siempre amanezca como base diaria
 * todos los días". O sea: lo que le quedó en la mano al cerrar ayer es con lo que
 * amanece hoy, sin que nadie tenga que acordarse de cargarlo.
 *
 * Orden de verdad:
 *  1. La base CARGADA por el supervisor para hoy — siempre gana. Es plata que él
 *     contó y entregó, y también es la forma de CORREGIR un arrastre torcido.
 *  2. Si no hay, la CAJA FINAL de la última rendición (base + recaudado − gastos
 *     − entregado). Se busca hacia atrás unos días para no perder el arrastre por
 *     un domingo o un día que no salió a la calle.
 *  3. Si nunca rindió, 0.
 *
 * ⚠️ El arrastre sale de una jornada RENDIDA, no de "lo que cobró y no entregó".
 * Un día sin cerrar no genera base: esa plata todavía es una jornada abierta y
 * tiene que aparecer como tal, no blanquearse como float del día siguiente.
 */
export async function getBaseDelDia(
  db: SupabaseClient,
  cobradorId: string,
  hoy: Date = new Date(),
  diasAtras = 7,
): Promise<BaseDelDia> {
  const ymd = toIso(hoyUY(hoy));
  try {
    const { data, error } = await db
      .from("aperturas_caja")
      .select("base")
      .eq("cobrador_id", cobradorId)
      .eq("fecha", ymd)
      .maybeSingle();
    if (error) throw error;
    if (data) return { base: Math.round(Number(data.base)), origen: "cargada" };
  } catch (e) {
    if (!tablaFaltante(e)) throw e;
    return { base: 0, origen: "sin_base" };
  }

  // Sin base cargada: la cuadra de la última jornada rendida es la base de hoy.
  try {
    const desde = new Date(hoyUY(hoy));
    desde.setDate(desde.getDate() - diasAtras);
    const { data, error } = await db
      .from("rendiciones")
      .select("fecha, base, recaudado, gastos, entregado")
      .eq("cobrador_id", cobradorId)
      .gte("fecha", toIso(desde))
      .lt("fecha", ymd)
      .order("fecha", { ascending: false })
      .limit(1);
    if (error) throw error;
    const r = data?.[0];
    if (!r) return { base: 0, origen: "sin_base" };
    const queda = cajaFinal(
      Number(r.base ?? 0),
      Number(r.recaudado ?? 0),
      Number(r.gastos ?? 0),
      Number(r.entregado ?? 0),
    );
    if (queda <= 0) return { base: 0, origen: "sin_base" };
    return { base: queda, origen: "arrastre", desdeFecha: String(r.fecha) };
  } catch (e) {
    if (tablaFaltante(e)) return { base: 0, origen: "sin_base" };
    throw e;
  }
}

/** Base de arranque de UN cobrador para un día (0 si no tiene / falta 0105).
 *  Incluye el ARRASTRE de la cuadra de ayer — ver `getBaseDelDia`. */
export async function getAperturaDia(
  db: SupabaseClient,
  cobradorId: string,
  hoy: Date = new Date(),
): Promise<number> {
  return (await getBaseDelDia(db, cobradorId, hoy)).base;
}

/**
 * Bases del día por cobrador, CON ARRASTRE y diciendo de dónde salió cada una.
 * Es lo que mira el supervisor: sin el `origen` no puede distinguir "esta plata
 * se la di yo hoy" de "esto es lo que le quedó ayer", que es justo lo que tiene
 * que saber antes de recibir el efectivo. Dos consultas en total (no N+1).
 */
export async function getBasesDelDia(
  db: SupabaseClient,
  hoy: Date = new Date(),
  cobradorIds?: string[] | null,
  diasAtras = 7,
): Promise<Map<string, BaseDelDia>> {
  const m = new Map<string, BaseDelDia>();
  const ymd = toIso(hoyUY(hoy));
  if (cobradorIds && cobradorIds.length === 0) return m;

  try {
    let q = db.from("aperturas_caja").select("cobrador_id, base").eq("fecha", ymd);
    if (cobradorIds) q = q.in("cobrador_id", cobradorIds);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data ?? [])
      m.set(r.cobrador_id as string, { base: Math.round(Number(r.base)), origen: "cargada" });
  } catch (e) {
    if (!tablaFaltante(e)) throw e; // sin 0105 → se sigue con el arrastre
  }

  // Para los que NO tienen base cargada, la cuadra de su última jornada rendida.
  try {
    const desde = new Date(hoyUY(hoy));
    desde.setDate(desde.getDate() - diasAtras);
    let q = db
      .from("rendiciones")
      .select("cobrador_id, fecha, base, recaudado, gastos, entregado")
      .gte("fecha", toIso(desde))
      .lt("fecha", ymd)
      .order("fecha", { ascending: true });
    if (cobradorIds) q = q.in("cobrador_id", cobradorIds);
    const { data, error } = await q;
    if (error) throw error;
    // Orden ascendente → la última asignación por cobrador es la más reciente.
    const ultima = new Map<string, { fecha: string; queda: number; detalle: BaseDelDia["detalle"] }>();
    for (const r of data ?? []) {
      const id = r.cobrador_id as string;
      if (m.has(id)) continue; // ya tiene base cargada: manda esa
      const detalle = {
        base: Math.round(Number(r.base ?? 0)),
        recaudado: Math.round(Number(r.recaudado ?? 0)),
        gastos: Math.round(Number(r.gastos ?? 0)),
        entregado: Math.round(Number(r.entregado ?? 0)),
      };
      ultima.set(id, {
        fecha: String(r.fecha),
        queda: cajaFinal(detalle.base, detalle.recaudado, detalle.gastos, detalle.entregado),
        detalle,
      });
    }
    for (const [id, u] of ultima) {
      if (u.queda > 0)
        m.set(id, { base: u.queda, origen: "arrastre", desdeFecha: u.fecha, detalle: u.detalle });
    }
  } catch (e) {
    if (!tablaFaltante(e)) throw e;
  }
  return m;
}

/** Bases de arranque del día por cobrador (para el panel del gestor). Opcionalmente
 *  acotado a un conjunto de cobradores (zona del supervisor). Incluye el ARRASTRE
 *  de la cuadra de ayer — usar `getBasesDelDia` si hace falta saber de dónde vino. */
export async function getAperturasDia(
  db: SupabaseClient,
  hoy: Date = new Date(),
  cobradorIds?: string[] | null,
): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  for (const [id, b] of await getBasesDelDia(db, hoy, cobradorIds)) m.set(id, b.base);
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
