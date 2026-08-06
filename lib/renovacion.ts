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

// ── Tope de AUMENTO por tramo + CAP total (money-critical) ─────────────────
//  Regla de negocio: el aumento MÁXIMO al renovar depende del monto del crédito
//  ANTERIOR, y ningún crédito puede superar el CAP total:
//    · anterior ≤ $30.000        → hasta +20%
//    · anterior $30.001–$60.000  → hasta +15%
//    · anterior $60.001–$90.000  → hasta +10%
//    · anterior > $90.000        → sin aumento (ya está cerca del cap)
//    · CAP TOTAL: ningún crédito supera $100.000.
//  El % del tramo es DURO para cobrador/supervisor; el ADMIN puede excederlo
//  (autorización directa). El CAP de $100.000 es DURO para TODOS (incl. admin).
//  Renovar por el mismo monto o por menos siempre es auto-aprobable.
export const RENOVACION_CAP_TOTAL = 100_000;

// ── El +20% del negocio (regla de Carlos, 06-08) ───────────────────────────
//  "Siempre es 20% para renovación a no ser que admin cambie esto."
//  Renovar NO es inventar un monto nuevo: es REPETIR el crédito que la persona
//  terminó de pagar, subido un 20%. Antes la oficina proponía el monto que
//  calculaba el SCORING (un número sin relación con el crédito anterior) y la
//  calle repetía el mismo monto sin aumento — reporte de campo 08-05, caso 4.
//  El único que puede escribir otro número es el ADMIN, en el form de la oficina.
export const RENOVACION_AUMENTO_PCT = 20;

/**
 * Monto que se PROPONE al renovar: el anterior +20%, nunca por encima del CAP.
 * Es la regla del negocio en estado puro — la usan igual el form de la oficina
 * y la lista de la calle, así ambos muestran el mismo número. Puro.
 */
export function montoRenovacionSugerido(montoAnterior: number): number {
  const base = Math.round(Number(montoAnterior) || 0);
  if (!(base > 0)) return 0;
  return Math.min(
    RENOVACION_CAP_TOTAL,
    Math.round(base * (1 + RENOVACION_AUMENTO_PCT / 100)),
  );
}

/**
 * Monto de renovación que un COBRADOR puede colocar solo, sin pedir permiso:
 * el +20% del negocio, pero recortado al tope del tramo (créditos grandes
 * admiten menos aumento) y al CAP. Para los créditos de hasta $30.000 —la
 * enorme mayoría de la cartera— el tramo ya permite 20%, así que da exactamente
 * el +20%. Sin este recorte, la calle ofrecería un monto que el propio servidor
 * rechaza después, que es justo la promesa que la lista no puede romper. Puro.
 */
export function montoRenovacionAutoAprobable(montoAnterior: number): number {
  const base = Math.round(Number(montoAnterior) || 0);
  if (!(base > 0)) return 0;
  const pct = Math.min(RENOVACION_AUMENTO_PCT, topeAumentoPct(base));
  return Math.min(RENOVACION_CAP_TOTAL, Math.round(base * (1 + pct / 100)));
}

/**
 * Monto que se PIDE cuando la renovación no se puede aprobar sola y va a la
 * oficina: el aumento que le corresponde al tramo, SIN recortar al CAP.
 *
 * Existe por los créditos heredados que ya vienen por encima del tope (135
 * activos, hasta $1.750.000): recortarlos al CAP convertiría la renovación en
 * una REBAJA silenciosa del capital del cliente. Como el tramo de esos montos no
 * admite aumento, en la práctica se piden por el MISMO monto — que es lo
 * conservador. Quien lo autoriza es el admin. Puro.
 */
export function montoRenovacionPedido(montoAnterior: number): number {
  const base = Math.round(Number(montoAnterior) || 0);
  if (!(base > 0)) return 0;
  const pct = Math.min(RENOVACION_AUMENTO_PCT, topeAumentoPct(base));
  return Math.round(base * (1 + pct / 100));
}

/**
 * ¿Esta renovación necesita que la apruebe el admin? True cuando el monto que
 * corresponde pedir se pasa del CAP — o sea, cuando nadie puede darla de alta
 * solo. Decisión de Carlos (06-08): eso NO es un callejón sin salida, se manda a
 * la oficina. Puro.
 */
export function requiereAprobacionAdmin(montoAnterior: number): boolean {
  return montoRenovacionPedido(montoAnterior) > RENOVACION_CAP_TOTAL;
}

/** Tope de aumento (%) aplicable según el monto del crédito ANTERIOR. Puro. */
export function topeAumentoPct(montoAnterior: number): number {
  if (montoAnterior <= 30_000) return 20;
  if (montoAnterior <= 60_000) return 15;
  if (montoAnterior <= 90_000) return 10;
  return 0; // 90.001–100.000: ya en el máximo, sin aumento
}

export interface EvaluacionRenovacion {
  /** true = dentro del tope del tramo Y del cap → se aprueba sola. */
  autoAprobable: boolean;
  /** Aumento en pesos (nuevo − anterior); negativo si renueva por menos. */
  aumento: number;
  /** Aumento en % sobre el anterior. */
  aumentoPct: number;
  /** Tope de aumento (%) del tramo del monto anterior. */
  topePct: number;
  /** El aumento supera el tope del tramo (DURO para no-admin; el admin puede). */
  excedePct: boolean;
  /** El monto nuevo supera el cap total $100.000 (DURO para TODOS). */
  superaCap: boolean;
  /** Por qué no es auto-aprobable (null si lo es). */
  motivo: string | null;
}

/** Evalúa una renovación contra el tope del tramo y el cap total. Puro. */
export function evaluarRenovacion(
  montoAnterior: number,
  montoNuevo: number,
): EvaluacionRenovacion {
  const aumento = montoNuevo - montoAnterior;
  const aumentoPct =
    montoAnterior > 0 ? (aumento / montoAnterior) * 100 : montoNuevo > 0 ? Infinity : 0;
  const topePct = topeAumentoPct(montoAnterior);
  // Tolerancia mínima para no rechazar por redondeo (ej. 20.0000001%).
  const excedePct = aumentoPct > topePct + 1e-6;
  const superaCap = montoNuevo > RENOVACION_CAP_TOTAL + 1e-6;
  const autoAprobable = !excedePct && !superaCap;

  const pes = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;
  let motivo: string | null = null;
  if (superaCap) motivo = `El crédito no puede superar ${pes(RENOVACION_CAP_TOTAL)} (tope máximo).`;
  else if (excedePct)
    motivo =
      topePct > 0
        ? `El aumento de ${aumentoPct.toFixed(0)}% supera el máximo de ${topePct}% para créditos de ${pes(montoAnterior)}.`
        : `Un crédito de ${pes(montoAnterior)} ya no admite aumento (tope ${pes(RENOVACION_CAP_TOTAL)}).`;

  return { autoAprobable, aumento, aumentoPct, topePct, excedePct, superaCap, motivo };
}
