// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — NÚCLEO puro de la RENOVACIÓN (cálculo de la nueva cuota).
//  Client-safe: sin React, sin IO, sin Supabase — se usa igual en el servidor
//  (alta real) y en el navegador (preview del gestor), así ambos muestran y
//  guardan EXACTAMENTE lo mismo. El cliente no puede alterar el dinero: el
//  servidor recalcula con esta misma función.
//
//  ⚠️ MANEJA DINERO: la cuota del nuevo crédito arrastra la tasa del anterior.
// ─────────────────────────────────────────────────────────────────────────

/** Términos del crédito anterior necesarios para arrastrar la tasa. */
export interface TerminosAnterior {
  /** Capital entregado (UYU). */
  monto: number;
  /** Cuota diaria (UYU). */
  cuota: number;
  totalDias: number;
}

/**
 * Tasa implícita del crédito anterior = total a pagar / capital.
 * Ej.: prestó 10.000 y devuelve 12.000 → factor 1.2.
 */
export function tasaImplicita(anterior: TerminosAnterior): number {
  if (!(anterior.monto > 0)) return 0;
  return (anterior.cuota * anterior.totalDias) / anterior.monto;
}

/**
 * Cuota diaria del nuevo crédito, arrastrando la tasa del anterior:
 *   cuota = round( monto × tasa / días ).
 * Devuelve 0 si algún término es inválido (el llamador valida > 0).
 */
export function calcularCuotaRenovacion(
  anterior: TerminosAnterior,
  montoNuevo: number,
  diasNuevo: number,
): number {
  if (!(montoNuevo > 0) || !(diasNuevo > 0)) return 0;
  const factor = tasaImplicita(anterior);
  return Math.round((montoNuevo * factor) / diasNuevo);
}
