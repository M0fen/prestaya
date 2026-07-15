// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RECONCILIACIÓN DIARIA. Llama al RPC eficiente (0071) que
//  agrega en SQL y devuelve SOLO los créditos que violan una invariante; el
//  núcleo puro (lib/reconciliacion) clasifica la severidad. Degrada a
//  "disponible:false" si el RPC aún no se corrió (Carlos corre la DDL).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  reconciliar,
  invRecaudoDia,
  type CreditoRecon,
  type ResumenReconciliacion,
} from "@/lib/reconciliacion";
import { inicioDiaUYIso } from "@/lib/fecha";

export interface ResultadoReconciliacion extends ResumenReconciliacion {
  /** false si el RPC 0071 aún no existe en la base. */
  disponible: boolean;
  /** Recaudo de HOY según el libro de pagos (para el chequeo de consistencia). */
  recaudoLibro: number;
  /** Cuántos hallazgos son CRÍTICOS (lo que vale la pena alertar; el resto es baseline). */
  criticos: number;
}

const N = (v: unknown) => Math.round(Number(v) || 0);

/**
 * Corre la reconciliación del día. `caja` opcional: si el caller ya tiene el
 * recaudo de caja, se compara contra el libro (invariante recaudo-consistente).
 */
export async function reconciliarDia(
  db: SupabaseClient,
  hoy: Date = new Date(),
  cajaDelDia?: number | null,
): Promise<ResultadoReconciliacion> {
  const vacio: ResultadoReconciliacion = {
    ok: true,
    totalCreditos: 0,
    hallazgos: [],
    porInvariante: {},
    peorSeveridad: null,
    disponible: false,
    recaudoLibro: 0,
    criticos: 0,
  };
  let violaciones: Record<string, unknown>[];
  try {
    const { data, error } = await db.rpc("app_reconciliacion_violaciones");
    if (error) throw error;
    violaciones = (data ?? []) as Record<string, unknown>[];
  } catch {
    // RPC 0071 sin correr todavía → degrada sin romper (el cron avisa "sin correr").
    return vacio;
  }

  const creditos: CreditoRecon[] = violaciones.map((r) => ({
    id: r.id as string,
    estado: (r.estado as string) ?? "?",
    pagadoAcum: N(r.pagado_acum),
    pagosSuma: N(r.pagos_suma),
    totalAPagar: N(r.total_a_pagar),
    cuotaDiaria: N(r.cuota_diaria),
  }));

  // Recaudo del día (barato: solo hoy) para el chequeo de consistencia libro↔caja.
  const desde = inicioDiaUYIso(hoy);
  const { data: pg } = await db
    .from("pagos")
    .select("monto")
    .eq("anulado", false)
    .gte("registrado_en", desde);
  const recaudoLibro = (pg ?? []).reduce((s, p) => s + N((p as { monto: unknown }).monto), 0);

  const extra =
    cajaDelDia != null && cajaDelDia > 0
      ? invRecaudoDia({ pagos: recaudoLibro, caja: cajaDelDia })
      : [];

  const resumen = reconciliar(creditos, extra);
  // ALERTABLE (push diario) = problema VIVO, no el baseline histórico: un drift del
  // denormalizado (los saldos mienten, siempre grave) o un sobre-cobro MATERIAL en
  // un crédito ACTIVO (se está cobrando de más ahora). Los sobre-cobros de créditos
  // ya finalizados son un baseline pre-existente y no disparan aviso a diario.
  const criticos = creditos.filter((c) => {
    const driftAcum = Math.abs(c.pagadoAcum - c.pagosSuma) >= 1;
    const exceso = c.pagosSuma - c.totalAPagar;
    const sobreMaterial =
      exceso >= 1 &&
      ((c.cuotaDiaria > 0 && exceso >= c.cuotaDiaria) ||
        (c.totalAPagar > 0 && exceso >= c.totalAPagar * 0.05));
    return driftAcum || (c.estado === "activo" && sobreMaterial);
  }).length;
  // Sumar también los hallazgos de recaudo-consistente (caja ≠ libro) como críticos.
  const criticosRecaudo = extra.filter((h) => h.severidad === "alto" || h.severidad === "critico").length;
  return { ...resumen, disponible: true, recaudoLibro, criticos: criticos + criticosRecaudo };
}
