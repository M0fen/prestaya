// ─────────────────────────────────────────────────────────────────────────
//  PRESUPUESTO DE JUEGOS — núcleo PURO (sin React, sin IO, testeable).
//
//  Responde las dos preguntas que el dueño no podía contestar:
//   1) ¿CUÁNTO GASTÉ en premios? (día / semana / mes / año)
//   2) ¿CUÁNTO VOY A GASTAR si regalo N raspaditas o abro esta quiniela?
//
//  La segunda es la importante: hasta ahora, configurar una raspadita o
//  regalar 500 era disparar a ciegas. Acá se calcula ANTES, con la misma
//  matemática con la que el servidor sortea (lib/raspadita.ts):
//
//    costo esperado de UNA jugada en un tramo
//      = P(ganar) × (promedio ponderado por peso del costo de sus premios)
//
//  Todo en pesos ENTEROS (Math.round al final de cada cuenta). Nunca float
//  acumulado: la regla del proyecto es no arrastrar decimales en dinero.
// ─────────────────────────────────────────────────────────────────────────
import type { PremioRaspa, SegmentoRaspa } from "./raspadita";

/** Premio con su costo de lista (0130) ya resuelto (nunca undefined). */
export interface PremioConCosto extends PremioRaspa {
  /** Costo estimado para la empresa, en $. */
  costo: number;
}

export interface CostoTramo {
  segmentoId: string;
  nombre: string;
  /** Probabilidad de ganar del tramo (0..100). */
  probGanar: number;
  /** Costo PROMEDIO de una jugada de este tramo (ya incluye el "no ganar"). */
  costoEsperado: number;
  /** Lo que sale si el jugador gana (promedio ponderado de los premios). */
  costoSiGana: number;
  /** El premio más caro alcanzable: el PEOR caso de una jugada. */
  costoMaximo: number;
  /** Premios activos con peso > 0 en el tramo. */
  premiosActivos: number;
  /** true si el tramo puede ganar pero no tiene premios cargados (config rota). */
  sinPremios: boolean;
}

/**
 * Costo esperado de UNA jugada en un tramo. Espeja exactamente el sorteo del
 * servidor (`jugar` + `elegirPremio`): primero se decide si gana (probGanar),
 * y si gana se rulea por PESO entre los premios BENEFICIO activos del tramo.
 * Un premio "nada" no cuesta: no participa de la ruleta.
 */
export function costoDeTramo(
  segmento: SegmentoRaspa,
  premiosDelTramo: readonly PremioConCosto[],
): CostoTramo {
  const beneficios = premiosDelTramo.filter((p) => p.tipo === "beneficio" && p.activo && p.peso > 0);
  const pesoTotal = beneficios.reduce((s, p) => s + p.peso, 0);
  const prob = Math.max(0, Math.min(100, segmento.probGanar)) / 100;

  // Promedio PONDERADO POR PESO: un premio con peso 25 sobre 37 sale 2 de cada 3
  // veces, así que pesa el doble que uno de peso 12 en el costo promedio.
  const costoSiGana =
    pesoTotal > 0
      ? beneficios.reduce((s, p) => s + (p.peso / pesoTotal) * Math.max(0, p.costo), 0)
      : 0;
  const costoMaximo = beneficios.reduce((mx, p) => Math.max(mx, Math.max(0, p.costo)), 0);

  return {
    segmentoId: segmento.id,
    nombre: segmento.nombre,
    probGanar: segmento.probGanar,
    costoEsperado: Math.round(prob * costoSiGana),
    costoSiGana: Math.round(costoSiGana),
    costoMaximo: Math.round(costoMaximo),
    premiosActivos: beneficios.length,
    sinPremios: prob > 0 && beneficios.length === 0,
  };
}

export interface SimulacionRegalo {
  /** Cuántas jugadas se están poniendo en la calle. */
  jugadas: number;
  /** Lo más probable: jugadas × costo esperado. Es el número para presupuestar. */
  costoEsperado: number;
  /** Si TODAS ganaran el premio más caro. El techo absoluto de la exposición. */
  costoPeorCaso: number;
  /** Cuántas se espera que ganen algo (para stock de premios físicos). */
  ganadoresEsperados: number;
  /** Advertencias que el dueño tiene que leer ANTES de confirmar. */
  avisos: string[];
}

/**
 * ¿Cuánta plata dejo en la calle si entrego `jugadas` raspaditas a clientes de
 * un tramo? Se usa en el formulario de "otorgar raspaditas" ANTES de confirmar.
 *
 * `costoEsperado` es lo que hay que presupuestar; `costoPeorCaso` es el techo
 * (improbable, pero es la exposición real si hay mala suerte o si alguien
 * configuró un premio carísimo con peso alto).
 */
export function simularRegalo(jugadas: number, tramo: CostoTramo): SimulacionRegalo {
  const n = Math.max(0, Math.floor(jugadas));
  const prob = Math.max(0, Math.min(100, tramo.probGanar)) / 100;
  const avisos: string[] = [];
  if (tramo.sinPremios) {
    avisos.push(
      `El tramo "${tramo.nombre}" tiene ${tramo.probGanar}% de chance de ganar pero NO tiene premios cargados: los clientes van a raspar y no van a recibir nada.`,
    );
  }
  if (tramo.costoEsperado === 0 && tramo.premiosActivos > 0) {
    avisos.push(
      "Los premios de este tramo no tienen costo cargado: la proyección da $0 y no sirve para presupuestar. Cargá cuánto te cuesta cada premio.",
    );
  }
  return {
    jugadas: n,
    costoEsperado: Math.round(n * tramo.costoEsperado),
    costoPeorCaso: Math.round(n * tramo.costoMaximo),
    ganadoresEsperados: Math.round(n * prob),
    avisos,
  };
}

export interface GastoPeriodo {
  /** Etiqueta legible del período ("Hoy", "Esta semana", …). */
  etiqueta: string;
  /** Raspaditas: premios entregados (jugadas ganadoras). */
  raspaditas: number;
  raspaditasCosto: number;
  /** Quinielas cerradas con ganador en el período. */
  quinielas: number;
  quinielasCosto: number;
  /** Rifas sorteadas en el período. */
  rifas: number;
  rifasCosto: number;
  /** Canjes de estrellas aprobados en el período. */
  estrellas: number;
  estrellasCosto: number;
  /** Suma de todo. */
  total: number;
}

/** Suma los cuatro juegos de un período. PURA. */
export function totalDe(g: Omit<GastoPeriodo, "total">): GastoPeriodo {
  return {
    ...g,
    total: Math.round(g.raspaditasCosto + g.quinielasCosto + g.rifasCosto + g.estrellasCosto),
  };
}

/**
 * Proyección a fin de mes a partir de lo que va del mes. Regla de tres simple
 * sobre días TRANSCURRIDOS: si en 5 días gastó $5.000, a 30 días son $30.000.
 * Se redondea y nunca se proyecta hacia abajo del gasto ya hecho (lo gastado
 * es un piso: no se puede "desgastar").
 */
export function proyectarMes(gastadoEnElMes: number, diaDelMes: number, diasDelMes: number): number {
  const d = Math.max(1, Math.floor(diaDelMes));
  const total = Math.max(d, Math.floor(diasDelMes));
  return Math.max(Math.round(gastadoEnElMes), Math.round((gastadoEnElMes / d) * total));
}

export type EstadoPresupuesto = "sin-tope" | "ok" | "cerca" | "excedido";

export interface SemaforoPresupuesto {
  estado: EstadoPresupuesto;
  /** % del tope consumido (0..∞). 0 si no hay tope. */
  usadoPct: number;
  /** Lo que queda disponible este mes (0 si ya se pasó). */
  disponible: number;
  mensaje: string;
}

/**
 * Semáforo del presupuesto mensual. "cerca" a partir del 80%: es el momento de
 * decidir, no cuando ya se pasó. Sin tope cargado no inventa alarmas.
 */
export function semaforo(gastadoMes: number, topeMensual: number): SemaforoPresupuesto {
  const gastado = Math.max(0, Math.round(gastadoMes));
  const tope = Math.max(0, Math.round(topeMensual));
  if (tope === 0) {
    return {
      estado: "sin-tope",
      usadoPct: 0,
      disponible: 0,
      mensaje: "No hay tope mensual definido para premios.",
    };
  }
  const pct = Math.round((gastado / tope) * 100);
  const disponible = Math.max(0, tope - gastado);
  if (gastado > tope) {
    return {
      estado: "excedido",
      usadoPct: pct,
      disponible: 0,
      mensaje: `Te pasaste del tope del mes por $${(gastado - tope).toLocaleString("es-UY")}.`,
    };
  }
  if (pct >= 80) {
    return {
      estado: "cerca",
      usadoPct: pct,
      disponible,
      mensaje: `Vas por el ${pct}% del tope del mes. Te quedan $${disponible.toLocaleString("es-UY")}.`,
    };
  }
  return {
    estado: "ok",
    usadoPct: pct,
    disponible,
    mensaje: `Llevás el ${pct}% del tope del mes.`,
  };
}
