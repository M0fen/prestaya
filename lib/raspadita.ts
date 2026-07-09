// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — RASPADITAS (juego PROMOCIONAL). Núcleo PURO (sin React, sin IO).
//
//  ⚠️ RESTRICCIÓN LEGAL INNEGOCIABLE: en Uruguay los juegos de azar por DINERO
//  los regula el Estado (Dirección de Loterías y Quinielas). Esta feature es
//  ESTRICTAMENTE promocional: NO se juega con dinero, NO se paga premio en
//  efectivo. Los premios son BENEFICIOS simbólicos del préstamo (un descuento,
//  un día de gracia) o "nada". Si el diseño derivara a dinero real: PARAR.
//
//  Anti-trampa: el premio lo decide el SERVIDOR (con azar del servidor), nunca
//  el cliente. Las probabilidades (pesos) las define el admin y son auditables.
//  El cliente desbloquea una raspadita POR PAGO (verificable: jugadas ≤ pagos).
// ─────────────────────────────────────────────────────────────────────────

export type TipoPremioRaspa = "beneficio" | "nada";

export interface PremioRaspa {
  id: string;
  label: string;
  tipo: TipoPremioRaspa;
  /** Peso = probabilidad RELATIVA (mayor peso, más chance). >= 0. */
  peso: number;
  activo: boolean;
  /** Tramo de scoring al que pertenece (null = sin asignar → default). */
  segmentoId?: string | null;
}

/**
 * TRAMO de scoring de la raspadita. El dueño premia distinto según el score:
 * define rangos (en %) con su "probabilidad de ganar" y les asigna premios. Un
 * tramo `esDefault` ("Los demás") cubre a quien no cae en ningún rango.
 */
export interface SegmentoRaspa {
  id: string;
  nombre: string;
  /** Rango de score en PORCENTAJE (0..100). El score interno 0..1000 se mapea /10. */
  scoreMin: number;
  scoreMax: number;
  /** Probabilidad de GANAR en este tramo (0..100). 100 = siempre gana. */
  probGanar: number;
  esDefault: boolean;
  activo: boolean;
  orden: number;
}

/** Convierte el puntaje interno (0..1000) a porcentaje 0..100 para los tramos. */
export const scoreAPorcentaje = (puntaje: number): number =>
  Math.max(0, Math.min(100, Math.round(puntaje / 10)));

/**
 * Elige el TRAMO que le corresponde a un score (en %): el primer tramo ACTIVO
 * NO-default (por `orden`) cuyo rango [min,max] lo contiene; si ninguno matchea,
 * el tramo default activo ("Los demás"); si tampoco hay, null (juego sin config).
 */
export function segmentoParaScore(
  scorePct: number,
  segmentos: SegmentoRaspa[],
): SegmentoRaspa | null {
  const s = Math.max(0, Math.min(100, scorePct));
  const activos = segmentos.filter((x) => x.activo);
  const especificos = activos
    .filter((x) => !x.esDefault)
    .sort((a, b) => a.orden - b.orden);
  const match = especificos.find((x) => s >= x.scoreMin && s <= x.scoreMax);
  if (match) return match;
  return activos.find((x) => x.esDefault) ?? null;
}

/**
 * Resultado de una jugada en un tramo. Dos pasos, ambos con azar del SERVIDOR:
 *   1) ¿Gana? `rndGanar` ∈ [0,1) < probGanar/100.
 *   2) Si gana, ¿cuál premio? ruleta por peso entre los premios del tramo.
 * Devuelve el premio ganado, o null si no ganó (o el tramo no tiene premios).
 * Solo entran premios BENEFICIO (el "no ganar" lo maneja probGanar, no un ítem).
 */
export function resultadoRaspadita(
  segmento: SegmentoRaspa | null,
  premiosDelTramo: PremioRaspa[],
  rndGanar: number,
  rndPremio: number,
): PremioRaspa | null {
  if (!segmento) return null;
  const prob = Math.max(0, Math.min(100, segmento.probGanar)) / 100;
  const r = Math.min(0.999999999, Math.max(0, rndGanar));
  if (r >= prob) return null; // no ganó
  const beneficios = premiosDelTramo.filter((p) => p.tipo === "beneficio");
  return elegirPremio(beneficios, rndPremio);
}

/**
 * Elige un premio por peso (ruleta ponderada). `rnd` ∈ [0,1) lo provee el
 * SERVIDOR (crypto). Determinista dado `rnd` → testeable. Solo cuenta premios
 * activos con peso > 0; si no hay ninguno, devuelve null (no hay jugada).
 */
export function elegirPremio(premios: PremioRaspa[], rnd: number): PremioRaspa | null {
  const validos = premios.filter((p) => p.activo && p.peso > 0);
  const total = validos.reduce((s, p) => s + p.peso, 0);
  if (total <= 0) return null;

  // Clampeamos rnd a [0,1) por las dudas.
  const r = Math.min(0.999999999, Math.max(0, rnd)) * total;
  let acum = 0;
  for (const p of validos) {
    acum += p.peso;
    if (r < acum) return p;
  }
  return validos[validos.length - 1]; // borde por redondeo
}

/**
 * Tope de raspaditas ACUMULADAS sin jugar. Evita que un cliente con muchos pagos
 * históricos junte decenas de golpe (p. ej. al activar la feature): siempre puede
 * tener a lo sumo esta cantidad pendientes; al jugarlas y seguir pagando, se
 * renuevan. Bajo, promocional.
 */
export const TOPE_RASPADITAS_ACUMULADAS = 3;

/**
 * Cuántas raspaditas tiene disponibles el cliente: una por cada pago vigente que
 * todavía no "gastó" en una jugada (jugadas ≤ pagos, no se puede farmear sin
 * pagar), pero ACOTADO al tope de acumulación. Nunca negativo.
 */
export function raspaditasDisponibles(
  pagosVigentes: number,
  jugadas: number,
  tope: number = TOPE_RASPADITAS_ACUMULADAS,
): number {
  const ganadas = Math.max(0, Math.floor(pagosVigentes) - Math.max(0, Math.floor(jugadas)));
  return Math.min(Math.max(0, Math.floor(tope)), ganadas);
}
