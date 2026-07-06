// ─────────────────────────────────────────────────────────────────────────
//  Hora de Uruguay — fuente ÚNICA para "hoy" y los cortes de día/mes.
//  Antes cada capa resolvía "hoy" distinto (el cartón con new Date() del
//  server = UTC en Vercel; el admin con offset −3). Cerca de medianoche eso
//  desalineaba estados y recaudaciones. Acá se unifica, TZ-independiente.
// ─────────────────────────────────────────────────────────────────────────

const TZ = "America/Montevideo";
const UY_OFFSET_MIN = 180; // UTC−3 (Uruguay no usa horario de verano)

/**
 * Día calendario de Uruguay como Date a medianoche LOCAL del runtime, para
 * alimentar el cálculo del cartón (que compara por Y/M/D). Correcto corra el
 * server donde corra (usa Intl con timeZone explícito).
 */
export function hoyUY(base: Date = new Date()): Date {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
  const [y, m, d] = partes.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Instante UTC del inicio del día de Uruguay (para filtrar timestamptz). */
export function inicioDiaUYIso(base: Date = new Date()): string {
  const s = new Date(base.getTime() - UY_OFFSET_MIN * 60000);
  s.setUTCHours(0, 0, 0, 0);
  return new Date(s.getTime() + UY_OFFSET_MIN * 60000).toISOString();
}

/** Ciclo mensual de Uruguay como "YYYY-MM" (para el tope de redención de
 *  estrellas por mes calendario). TZ-independiente (usa Intl con TZ explícita). */
export function cicloUY(base: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  }).format(base); // "2026-07"
}

/** Instante UTC del inicio del mes de Uruguay (para filtrar timestamptz). */
export function inicioMesUYIso(base: Date = new Date()): string {
  const s = new Date(base.getTime() - UY_OFFSET_MIN * 60000);
  s.setUTCDate(1);
  s.setUTCHours(0, 0, 0, 0);
  return new Date(s.getTime() + UY_OFFSET_MIN * 60000).toISOString();
}
