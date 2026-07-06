// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — SCORE DE SOSPECHA de la bitácora de campo. Núcleo PURO (sin
//  React, sin IO). Dado los eventos de un cobrador en un día, detecta patrones
//  de "malas mañas": planchado (registrar todo junto sin visitar), cobros fuera
//  de la zona del cliente, sin moverse entre clientes, GPS apagado, horario raro.
//  Determinista y testeable. Los umbrales son ajustables.
// ─────────────────────────────────────────────────────────────────────────

/** Un evento de la bitácora, con lo mínimo para analizar. */
export interface EventoBitacora {
  accion: string; // "cobro" | "no_pago" | "censo" | "gasto" | "cierre_jornada" | "ver_ficha"
  /** Hora AUTORITATIVA del servidor, ISO. */
  serverTs: string;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsDenegado: boolean;
  /** Para cobros: ¿estaba dentro de la geo-cerca del cliente? (null si no aplica) */
  enZona: boolean | null;
  clienteId: string | null;
}

export interface UmbralesSospecha {
  /** Cobros dentro de esta ventana (min) para marcar "planchado". */
  ventanaPlanchadoMin: number;
  /** Cantidad de cobros en la ventana que dispara "planchado". */
  cobrosPlanchado: number;
  /** Distancia (m) por debajo de la cual dos cobros se consideran "sin moverse". */
  distanciaSinMovimientoM: number;
  /** Hora UY (0..23) antes de la cual, o desde la cual, se considera horario raro. */
  horaMin: number;
  horaMax: number;
}

export const UMBRALES_DEFECTO: UmbralesSospecha = {
  ventanaPlanchadoMin: 10,
  cobrosPlanchado: 6,
  distanciaSinMovimientoM: 40,
  horaMin: 6,
  horaMax: 22,
};

export type NivelSospecha = "ok" | "observar" | "alerta";

export interface SenalesSospecha {
  cobros: number;
  fueraDeZona: number;
  sinGps: number; // acciones de campo con GPS denegado o ausente
  planchado: boolean;
  sinMovimiento: number; // cobros a clientes distintos casi en el mismo punto
  horarioRaro: number;
  score: number; // 0..100 (mayor = más sospechoso)
  nivel: NivelSospecha;
  motivos: string[];
}

/** Distancia en metros entre dos puntos (haversine). */
export function distanciaM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Hora de Uruguay (0..23) de un ISO. */
function horaUY(iso: string): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Montevideo",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  return Number(h) % 24;
}

const ACCIONES_CAMPO = new Set(["cobro", "no_pago", "censo", "gasto"]);

/**
 * Analiza los eventos de un cobrador en un día y devuelve señales + score.
 * PURA. `eventos` no necesita venir ordenado.
 */
export function analizarSospecha(
  eventos: EventoBitacora[],
  umbrales: UmbralesSospecha = UMBRALES_DEFECTO,
): SenalesSospecha {
  const orden = [...eventos].sort((a, b) => a.serverTs.localeCompare(b.serverTs));
  const cobros = orden.filter((e) => e.accion === "cobro");

  const fueraDeZona = cobros.filter((e) => e.enZona === false).length;
  const sinGps = orden.filter(
    (e) => ACCIONES_CAMPO.has(e.accion) && (e.gpsDenegado || e.gpsLat == null || e.gpsLng == null),
  ).length;
  const horarioRaro = orden.filter((e) => {
    if (!ACCIONES_CAMPO.has(e.accion)) return false;
    const h = horaUY(e.serverTs);
    return h < umbrales.horaMin || h >= umbrales.horaMax;
  }).length;

  // Planchado: máxima cantidad de cobros en cualquier ventana rodante.
  const tiempos = cobros.map((e) => new Date(e.serverTs).getTime());
  let maxEnVentana = 0;
  const ventanaMs = umbrales.ventanaPlanchadoMin * 60000;
  for (let i = 0; i < tiempos.length; i++) {
    let c = 0;
    for (let j = i; j < tiempos.length && tiempos[j] - tiempos[i] <= ventanaMs; j++) c++;
    if (c > maxEnVentana) maxEnVentana = c;
  }
  const planchado = maxEnVentana >= umbrales.cobrosPlanchado;

  // Sin moverse: cobros consecutivos a clientes DISTINTOS casi en el mismo punto.
  let sinMovimiento = 0;
  for (let i = 1; i < cobros.length; i++) {
    const a = cobros[i - 1];
    const b = cobros[i];
    if (a.gpsLat == null || a.gpsLng == null || b.gpsLat == null || b.gpsLng == null) continue;
    if (a.clienteId && b.clienteId && a.clienteId === b.clienteId) continue; // mismo cliente: ok
    if (distanciaM(a.gpsLat, a.gpsLng, b.gpsLat, b.gpsLng) < umbrales.distanciaSinMovimientoM) {
      sinMovimiento++;
    }
  }

  // Score ponderado (0..100).
  // El planchado es la maña más grave (registrar todo junto sin visitar): pesa
  // fuerte para disparar alerta por sí solo.
  const score = Math.min(
    100,
    fueraDeZona * 15 +
      (planchado ? 50 : 0) +
      sinMovimiento * 10 +
      sinGps * 8 +
      horarioRaro * 5,
  );
  const nivel: NivelSospecha = score >= 50 ? "alerta" : score >= 20 ? "observar" : "ok";

  const motivos: string[] = [];
  if (fueraDeZona > 0) motivos.push(`${fueraDeZona} cobro(s) fuera de la zona del cliente`);
  if (planchado) motivos.push(`Planchado: ${maxEnVentana} cobros en ${umbrales.ventanaPlanchadoMin} min`);
  if (sinMovimiento > 0) motivos.push(`${sinMovimiento} cobro(s) a clientes distintos sin moverse`);
  if (sinGps > 0) motivos.push(`${sinGps} acción(es) sin GPS`);
  if (horarioRaro > 0) motivos.push(`${horarioRaro} acción(es) en horario inusual`);

  return { cobros: cobros.length, fueraDeZona, sinGps, planchado, sinMovimiento, horarioRaro, score, nivel, motivos };
}
