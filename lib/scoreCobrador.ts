// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — SCORE DE CONFIANZA del cobrador. Núcleo PURO (sin React, sin IO).
//  Análogo al score del cliente, pero para VIGILAR al cobrador: agrega las
//  señales de anti-fuga de un período (faltantes de rendición, días sin rendir,
//  cobros fuera de zona, días con sospecha en la bitácora, tasa de "no pago",
//  float alto sin rendir) en un puntaje 0..100 EXPLICABLE (100 = intachable).
//
//  Es una HERRAMIENTA DE GESTIÓN, no una acusación: un puntaje bajo dice "mirá
//  a esta persona", no "es un ladrón". Determinista y testeable.
// ─────────────────────────────────────────────────────────────────────────

/** Señales agregadas de un cobrador en un período (las calcula la capa de datos). */
export interface SenalesCobrador {
  /** Días del período con actividad (cobros/visitas). Contexto, no penaliza. */
  diasActivos: number;
  /** Rendiciones cerradas en el período. */
  rendiciones: number;
  /** Días en que recaudó pero NO rindió (float que se quedó sin declarar). */
  diasSinRendir: number;
  /** Rendiciones con faltante (entregó de menos). */
  faltantes: number;
  /** $ total faltante acumulado (suma de las diferencias negativas). */
  montoFaltante: number;
  /** Cobros del período (denominador de la tasa de no-pago). */
  cobros: number;
  /** Visitas marcadas "no pago" (posible cobré-y-no-registré). */
  noPagos: number;
  /** Cobros registrados fuera de la zona del cliente (GPS). */
  fueraDeZona: number;
  /** Acciones de campo sin GPS (denegado/ausente). */
  sinGps: number;
  /** Días cuyo score de sospecha de la bitácora fue "alerta" (≥50). */
  diasAlerta: number;
  /** Días cuyo score de sospecha fue "observar" (20..49). */
  diasObservar: number;
  /** Mayor float visto sin rendir en el período (referencia de exposición). */
  floatMaxSinRendir: number;
}

export type BandaConfianza = "intachable" | "confiable" | "observar" | "riesgo";

export interface ResultadoConfianza {
  /** 0..100 (100 = intachable). */
  puntaje: number;
  banda: BandaConfianza;
  /** Tasa de "no pago" sobre las gestiones (0..1). */
  tasaNoPago: number;
  /** Motivos legibles, del más al menos grave. */
  motivos: string[];
}

/** Umbrales de banda sobre el puntaje 0..100. */
export const UMBRALES_CONFIANZA = { intachable: 90, confiable: 70, observar: 45 } as const;

/**
 * Penalización de la tasa de "no pago": si un cobrador reporta muchas visitas
 * "no pagó" respecto de sus cobros, puede estar cobrando sin registrar. Solo se
 * pondera con volumen suficiente (≥ mínimo de gestiones) para no castigar a
 * quien hizo pocas visitas. Devuelve puntos a restar (0..25).
 */
export function penalNoPago(cobros: number, noPagos: number, minGestiones = 10): number {
  const gestiones = cobros + noPagos;
  if (gestiones < minGestiones) return 0;
  const tasa = noPagos / gestiones;
  // Hasta ~50% de no-pago = 25 puntos; lineal, con techo.
  return Math.min(25, Math.round(tasa * 50));
}

/**
 * Calcula el score de confianza del cobrador a partir de sus señales.
 * Empieza en 100 y RESTA por cada señal de riesgo (todas explicadas en `motivos`).
 * Pura: no toca la base ni el reloj.
 */
export function calcularConfianzaCobrador(s: SenalesCobrador): ResultadoConfianza {
  const motivos: string[] = [];
  let puntaje = 100;

  // Días sin rendir: lo más grave (float que no se declara). −12 c/u, techo 40.
  if (s.diasSinRendir > 0) {
    const p = Math.min(40, s.diasSinRendir * 12);
    puntaje -= p;
    motivos.push(`${s.diasSinRendir} día(s) recaudó y no rindió`);
  }

  // Faltantes de rendición: entregó de menos. −8 por faltante (techo 32) +
  // castigo por el MONTO (cada $10.000 faltantes, −1, techo 15).
  if (s.faltantes > 0) {
    puntaje -= Math.min(32, s.faltantes * 8);
    const pMonto = Math.min(15, Math.floor(Math.max(0, s.montoFaltante) / 10000));
    puntaje -= pMonto;
    motivos.push(
      `${s.faltantes} rendición(es) con faltante` +
        (s.montoFaltante > 0 ? ` ($${Math.round(s.montoFaltante).toLocaleString("es-UY")})` : ""),
    );
  }

  // Días de sospecha de la bitácora (planchado, sin moverse, etc.).
  if (s.diasAlerta > 0) {
    puntaje -= Math.min(36, s.diasAlerta * 12);
    motivos.push(`${s.diasAlerta} día(s) con alerta de sospecha en la bitácora`);
  }
  if (s.diasObservar > 0) {
    puntaje -= Math.min(12, s.diasObservar * 3);
    motivos.push(`${s.diasObservar} día(s) para observar en la bitácora`);
  }

  // Cobros fuera de zona (GPS lejos del domicilio del cliente).
  if (s.fueraDeZona > 0) {
    puntaje -= Math.min(20, s.fueraDeZona * 5);
    motivos.push(`${s.fueraDeZona} cobro(s) fuera de la zona del cliente`);
  }

  // Acciones sin GPS (apaga el GPS para no dejar rastro).
  if (s.sinGps > 0) {
    puntaje -= Math.min(10, s.sinGps * 2);
    motivos.push(`${s.sinGps} acción(es) sin GPS`);
  }

  // Tasa de "no pago" alta (posible cobré-y-no-registré).
  const gestiones = s.cobros + s.noPagos;
  const tasaNoPago = gestiones > 0 ? s.noPagos / gestiones : 0;
  const pNoPago = penalNoPago(s.cobros, s.noPagos);
  if (pNoPago > 0) {
    puntaje -= pNoPago;
    motivos.push(`Tasa de "no pago" alta: ${Math.round(tasaNoPago * 100)}% de las gestiones`);
  }

  puntaje = Math.max(0, Math.min(100, Math.round(puntaje)));
  const banda: BandaConfianza =
    puntaje >= UMBRALES_CONFIANZA.intachable
      ? "intachable"
      : puntaje >= UMBRALES_CONFIANZA.confiable
        ? "confiable"
        : puntaje >= UMBRALES_CONFIANZA.observar
          ? "observar"
          : "riesgo";

  return { puntaje, banda, tasaNoPago, motivos };
}
