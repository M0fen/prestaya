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

// ── Auto-aprobación de renovaciones (tope) ─────────────────────────────────
//  Una renovación se aprueba SOLA (crea el crédito al instante, sin pasar por el
//  admin) si el AUMENTO respecto del crédito anterior está DENTRO del tope:
//    · el monto nuevo no supera al anterior en más de RENOVACION_TOPE_PCT %, y
//    · el aumento en pesos no supera RENOVACION_TOPE_ABS.
//  Si se pasa de cualquiera de los dos, requiere aprobación del admin.
//  Renovar por el mismo monto o por menos siempre es auto-aprobable.
export const RENOVACION_TOPE_PCT = 20;
export const RENOVACION_TOPE_ABS = 100_000;

export interface EvaluacionRenovacion {
  /** true = se aprueba automáticamente; false = requiere aprobación del admin. */
  autoAprobable: boolean;
  /** Aumento en pesos (nuevo − anterior); negativo si renueva por menos. */
  aumento: number;
  /** Aumento en % sobre el anterior. */
  aumentoPct: number;
  /** Por qué requiere aprobación (null si es auto-aprobable). */
  motivo: string | null;
}

/** Evalúa si una renovación entra en el tope de auto-aprobación. Puro. */
export function evaluarRenovacion(
  montoAnterior: number,
  montoNuevo: number,
): EvaluacionRenovacion {
  const aumento = montoNuevo - montoAnterior;
  const aumentoPct =
    montoAnterior > 0 ? (aumento / montoAnterior) * 100 : montoNuevo > 0 ? Infinity : 0;
  // Tolerancia mínima para no rechazar por redondeo (ej. 20.0000001%).
  const excedePct = aumentoPct > RENOVACION_TOPE_PCT + 1e-6;
  const excedeAbs = aumento > RENOVACION_TOPE_ABS;
  const autoAprobable = !excedePct && !excedeAbs;

  const pes = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;
  let motivo: string | null = null;
  if (excedePct && excedeAbs)
    motivo = `El aumento (${aumentoPct.toFixed(0)}% · +${pes(aumento)}) supera el tope de ${RENOVACION_TOPE_PCT}% y de ${pes(RENOVACION_TOPE_ABS)}.`;
  else if (excedePct)
    motivo = `El aumento de ${aumentoPct.toFixed(0)}% supera el tope de ${RENOVACION_TOPE_PCT}%.`;
  else if (excedeAbs)
    motivo = `El aumento de ${pes(aumento)} supera el tope de ${pes(RENOVACION_TOPE_ABS)}.`;

  return { autoAprobable, aumento, aumentoPct, motivo };
}
