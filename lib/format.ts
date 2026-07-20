// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — helpers de formato (moneda y fechas en español)
//  Moneda: peso uruguayo (UYU). Conservado fiel a la lógica original, con el
//  locale ajustado a Uruguay (es-UY).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Formatea un número como pesos uruguayos: $600.000.
 * Redondea a peso entero (los créditos de cobro diario se manejan sin
 * centésimos) y agrupa miles con punto, según convención es-UY.
 * Nota: es-UY y es-CO comparten el mismo separador de miles ("."), por lo
 * que el cambio de locale no altera el dígito mostrado, solo la semántica.
 */
export const UYU = (n: number): string =>
  "$" + Math.round(n).toLocaleString("es-UY");

/**
 * Parsea "YYYY-MM-DD" a Date en horario LOCAL.
 * Se construye con (año, mes-1, día) a propósito: evita que `new Date(string)`
 * interprete la fecha como UTC y la corra un día según la zona horaria.
 */
export const parseFecha = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Formatea un Date (hora local) a "YYYY-MM-DD". Inverso de parseFecha. */
export const toIso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** Normaliza un Date a medianoche local (descarta la hora). */
export const aMedianoche = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Hora "HH:mm" (24h) en horario de URUGUAY a partir de un timestamp ISO.
 *  Usa TZ explícita (America/Montevideo): `getHours()` tomaba la TZ del proceso —
 *  en el server de Vercel es UTC → el comprobante mostraba +3h de la hora real. */
export const horaDe = (iso: string): string => {
  try {
    return new Intl.DateTimeFormat("es-UY", {
      timeZone: "America/Montevideo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  } catch {
    return "";
  }
};

/** Días de la semana en español, indexados por Date.getDay() (0 = domingo). */
export const diasSemana = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
] as const;

/** Meses en español, indexados por Date.getMonth() (0 = enero). */
export const meses = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;
