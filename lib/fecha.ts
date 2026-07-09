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

/** Fecha calendario de Uruguay como "YYYY-MM-DD" (coincide con `fecha_uy` de la
 *  bitácora). TZ-independiente. */
export function fechaISOUY(base: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base); // "2026-07-02"
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

/** Inicio del día UY de una fecha "YYYY-MM-DD" como instante ISO (UTC−3 fijo). */
export function diaUYInicioIso(ymd: string): string {
  return `${ymd}T00:00:00-03:00`;
}

/** Días de COBRO (Lun–Sáb, sin domingos) en los próximos `nCalendario` días desde
 *  `hoy` (sin incluir hoy). Para proyecciones que no deben contar domingos. */
export function diasCobrablesProximos(hoy: Date, nCalendario: number): number {
  let count = 0;
  const d = new Date(hoy);
  for (let k = 0; k < nCalendario; k++) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0) count++; // 0 = domingo
  }
  return count;
}

/** Días de cobro (Lun–Sáb) del mes de `hoy`: transcurridos (día 1 → hoy inclusive)
 *  y total del mes. Para proyecciones mensuales que no cuentan domingos. */
export function diasCobrablesDelMes(hoy: Date): { transcurridos: number; total: number } {
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  const finMes = new Date(y, m + 1, 0).getDate();
  let transcurridos = 0;
  let total = 0;
  for (let d = 1; d <= finMes; d++) {
    if (new Date(y, m, d).getDay() === 0) continue; // domingo no cuenta
    total++;
    if (d <= hoy.getDate()) transcurridos++;
  }
  return { transcurridos, total };
}

/** Inicio del día SIGUIENTE (fin EXCLUSIVO de un rango que incluye a `ymd`). */
export function diaUYFinIso(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const nx = new Date(Date.UTC(y, m - 1, d + 1)); // suma 1 día sin líos de TZ
  const yy = nx.getUTCFullYear();
  const mm = String(nx.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(nx.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}T00:00:00-03:00`;
}
