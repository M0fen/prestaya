// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — "NO PAGO SOSPECHOSO". Núcleo PURO (sin React, sin IO).
//  Ataca la fuga #1 del cobro diario: el cobrador COBRA y marca "no pagó" para
//  quedarse la plata. Señal: marca "no pago" a un cliente que HISTÓRICAMENTE
//  paga casi siempre. Cuanto más cumplidor el cliente, más raro que "no pague".
//
//  No prueba el fraude: prioriza a quién revisar/llamar. Determinista y testeable.
// ─────────────────────────────────────────────────────────────────────────

/** Fiabilidad histórica del cliente, derivada de su cartón (verdad de pagos). */
export interface FiabilidadCliente {
  /** Cuotas que ya vencieron (debieron pagarse) hasta hoy. */
  cuotasVencidas: number;
  /** De esas, cuántas quedaron PAGADAS (día completo). */
  cuotasPagadas: number;
}

/** Tasa de cumplimiento del cliente (0..1). Sin historia suficiente → 0. */
export function tasaCumplimiento(f: FiabilidadCliente): number {
  if (f.cuotasVencidas <= 0) return 0;
  return Math.max(0, Math.min(1, f.cuotasPagadas / f.cuotasVencidas));
}

export type NivelNoPago = "normal" | "revisar" | "sospechoso";

export interface ResultadoNoPago {
  nivel: NivelNoPago;
  tasaCumplimiento: number;
  motivo: string;
}

/**
 * Umbral mínimo de cuotas vencidas para confiar en la tasa (un cliente con 1–2
 * cuotas no da señal). Y umbrales de cumplimiento para clasificar.
 */
export const NO_PAGO = {
  minCuotas: 5,
  /** ≥ esta tasa y marcó "no pago" → SOSPECHOSO (cliente muy cumplidor). */
  cumplidorAlto: 0.9,
  /** ≥ esta tasa → REVISAR (cumplidor). */
  cumplidorMedio: 0.75,
} as const;

/**
 * Clasifica un evento de "no pago" según lo cumplidor que es el cliente.
 * `esNoPago` = la visita de hoy se marcó como no-pago (no "no estaba"/reagendado,
 * que tienen otra lectura). Si el cliente no tiene historia suficiente → normal.
 */
export function clasificarNoPago(
  f: FiabilidadCliente,
  esNoPago: boolean,
): ResultadoNoPago {
  const tasa = tasaCumplimiento(f);
  if (!esNoPago || f.cuotasVencidas < NO_PAGO.minCuotas) {
    return { nivel: "normal", tasaCumplimiento: tasa, motivo: "" };
  }
  if (tasa >= NO_PAGO.cumplidorAlto) {
    return {
      nivel: "sospechoso",
      tasaCumplimiento: tasa,
      motivo: `Cliente muy cumplidor (${Math.round(tasa * 100)}% al día) marcado "no pago"`,
    };
  }
  if (tasa >= NO_PAGO.cumplidorMedio) {
    return {
      nivel: "revisar",
      tasaCumplimiento: tasa,
      motivo: `Cliente cumplidor (${Math.round(tasa * 100)}% al día) marcado "no pago"`,
    };
  }
  return { nivel: "normal", tasaCumplimiento: tasa, motivo: "" };
}
