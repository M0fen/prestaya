// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — NÚCLEO puro del ALTA de un crédito NUEVO.
//
//  El caso que cubre: un cliente que HOY no tiene crédito activo y vuelve a
//  pedir. Hasta ahora la ÚNICA forma de colocar capital era `renovarCredito`,
//  que exige un crédito anterior en estado 'activo' y saldado — así que quien
//  terminaba de pagar y volvía días después quedaba fuera del sistema (el mismo
//  síntoma reportado en Disapp: "termina el crédito, vuelve a los pocos días y
//  no lo deja").
//
//  ⚠️ MANEJA DINERO. Client-safe (sin React/IO): el navegador previsualiza con
//  estas funciones y el servidor RECALCULA con las MISMAS, así el formulario no
//  puede alterar la cuota. Sin float: todo pasa por Math.round.
// ─────────────────────────────────────────────────────────────────────────
import { calcularCuotaRenovacion, tasaImplicita, type TerminosAnterior } from "./renovacion";

/** Interés total (%) por defecto cuando el cliente NO tiene historial de crédito.
 *  Sale de la cartera real: 2.086 de los 2.300 créditos activos están al 20%. */
export const INTERES_DEFECTO_PCT = 20;

/**
 * Interés total (%) implícito en los términos de un crédito previo, para mostrarlo
 * y pre-cargarlo. `null` si no hay base de la que derivarlo.
 * Ej.: prestó 10.000 y devuelve 12.000 → 20%.
 */
export function interesDeBase(base: TerminosAnterior | null): number | null {
  if (!base || !(base.monto > 0) || !(base.cuota > 0) || !(base.totalDias > 0)) return null;
  const pct = (tasaImplicita(base) - 1) * 100;
  // ⚠️ Una tasa por DEBAJO del 1% no es la tasa del cliente: es un dato roto. Hay
  // 192 créditos activos al 0% ($72.113.554) más 82 entre 0 y 1% ($7.764.720),
  // todos heredados de Disapp — y CERO créditos entre 1% y 3%: la tasa real más
  // baja del negocio es 3%. Devolver estas micro-tasas hacía que la app propusiera
  // créditos que no ganan nada o que pierden (JOSE RODRÍGUEZ: $5.000 → "paga en
  // total $4.992"; GUSTAVO FERRAGUT: $94.500 al 0,03% → $25 de ganancia por ciclo
  // en vez de ~$18.900). Se cae al interés del negocio; las tasas reales (3%,
  // 3,5%, 10-19%, 20%) quedan por encima del umbral y se respetan tal cual.
  if (!Number.isFinite(pct) || pct < 1) return null;
  return Math.round(pct * 10) / 10; // una decimal: la tasa histórica rara vez es entera
}

/**
 * Cuota del crédito nuevo:
 *  · CON historial → arrastra la tasa del último crédito del cliente (misma
 *    fórmula exacta que la renovación: el que vuelve no estrena condiciones).
 *  · SIN historial → interés explícito que carga el gestor:
 *      cuota = round( monto × (1 + interés/100) / cuotas ).
 * Devuelve 0 si algún término es inválido (el llamador valida > 0).
 */
export function calcularCuotaCreditoNuevo(
  base: TerminosAnterior | null,
  monto: number,
  cuotas: number,
  interesPct: number,
): number {
  if (!(monto > 0) || !(cuotas > 0)) return 0;
  // ⚠️ Solo se arrastra la tasa del anterior si es una tasa DE VERDAD (> 0). Con la
  // base rota de Disapp (0%), esta rama devolvía una cuota que hacía que el crédito
  // nuevo devolviera menos que el capital. `calcularCuotaRenovacion` tiene su propio
  // piso, pero acá se decide ANTES cuál de las dos fórmulas manda, y con una base
  // de 0% la correcta es la del interés explícito.
  if (base && base.monto > 0 && base.cuota > 0 && base.totalDias > 0 && interesDeBase(base) != null) {
    return calcularCuotaRenovacion(base, monto, cuotas);
  }
  const i = Number.isFinite(interesPct) ? Math.max(0, interesPct) : 0;
  return Math.round((monto * (1 + i / 100)) / cuotas);
}

// ── DESHACER una venta (pedido de Carlos, 08-14) ───────────────────────────
//  El dedazo existe: un monto equivocado, el cliente que se arrepiente en la
//  vereda. Los créditos NO se borran (P0403, el libro es la verdad), así que
//  deshacer = pasarlo a estado 'cancelado' — y solo cuando NO pasó nada todavía.
//
//  La regla vive ACÁ, pura, porque la usan las dos puntas: el botón (para
//  decidir si se muestra y cuánto tiempo queda) y la Server Action (la verdad).
//  Pantalla y servidor con la MISMA función — la regla de hierro del proyecto.

/** Ventana para deshacer: la misma HORA que tiene el "Deshacer" de un cobro. */
export const DESHACER_VENTA_MS = 60 * 60 * 1000;

export interface VentaParaDeshacer {
  estado: string;
  /** prestamos.origen ("credito" | "tienda" | "disapp_import" | null). */
  origen: string | null;
  /** Linaje de renovación: si existe, deshacerla reabriría el crédito anterior. */
  renovadoDe: string | null;
  creadoPor: string | null;
  /** ISO de creado_en. */
  creadoEn: string;
  tienePagos: boolean;
}

export type VeredictoDeshacer =
  | { ok: true; quedanMs: number }
  | { ok: false; motivo: string };

/**
 * ¿Este crédito se puede deshacer, y por qué no? Cada rechazo dice la salida
 * (nunca un callejón). Orden de chequeo: del más definitivo al más temporal.
 */
export function puedeDeshacerVenta(
  v: VentaParaDeshacer,
  yoId: string,
  ahoraMs: number,
): VeredictoDeshacer {
  if (v.creadoPor !== yoId)
    return { ok: false, motivo: "Este crédito lo colocó otra persona: que lo deshaga quien lo creó, o la oficina." };
  if ((v.origen ?? "credito") !== "credito")
    return { ok: false, motivo: "Este crédito no es de efectivo de la calle. Avisá a la oficina." };
  if (v.renovadoDe != null)
    return {
      ok: false,
      motivo:
        "Es una RENOVACIÓN: deshacerla tendría que reabrir el crédito anterior, y eso lo hace la oficina. Avisale a tu supervisor.",
    };
  if (v.estado !== "activo")
    return { ok: false, motivo: "Este crédito ya no está activo." };
  if (v.tienePagos)
    return {
      ok: false,
      motivo: "El cliente ya pagó una cuota de este crédito: ya no se puede deshacer. Avisá a la oficina.",
    };
  const edad = ahoraMs - new Date(v.creadoEn).getTime();
  if (!Number.isFinite(edad) || edad < 0)
    return { ok: false, motivo: "No se pudo verificar la hora del crédito. Avisá a la oficina." };
  if (edad > DESHACER_VENTA_MS)
    return {
      ok: false,
      motivo: "Pasó más de una hora desde que lo colocaste: ya no se deshace solo. Avisá a la oficina.",
    };
  return { ok: true, quedanMs: DESHACER_VENTA_MS - edad };
}
