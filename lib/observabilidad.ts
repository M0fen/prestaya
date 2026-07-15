// ─────────────────────────────────────────────────────────────────────────
//  OBSERVABILIDAD — reporte central de errores.
//
//  "En una ruta de dinero, un error NUNCA puede tragarse en silencio: un cobro
//  que falla al registrarse debe DEJAR RASTRO." (patrón fintech: observabilidad.)
//
//  Hoy loguea estructurado (Vercel/Node captura console.error en los logs de la
//  función, grepeable por el prefijo [PY-ERROR]). Está LISTO PARA SENTRY sin tocar
//  ningún call-site: cuando Carlos agregue el DSN, un init llama a `setReporter`
//  con `(ev) => Sentry.captureException(ev.error, { tags:{contexto}, extra })`.
// ─────────────────────────────────────────────────────────────────────────

export interface EventoError {
  /** De dónde salió (nombre de la acción/ruta de plata). */
  contexto: string;
  error: unknown;
  /** Datos útiles para diagnosticar (ids, montos), NUNCA secretos ni PII sensible. */
  extra?: Record<string, unknown>;
}

type Reporter = (ev: EventoError) => void;

let reporter: Reporter | null = null;

/** Enchufa un reporter externo (p. ej. Sentry). Idempotente; nunca requerido. */
export function setReporter(r: Reporter | null): void {
  reporter = r;
}

/**
 * Reporta un error de una ruta CRÍTICA (dinero). Loguea SIEMPRE (estructurado) y,
 * si hay un reporter enchufado, delega. Es best-effort para el observador: jamás
 * lanza (no puede tumbar la acción que lo llama).
 */
export function reportarError(
  contexto: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code;
  // Prefijo fijo [PY-ERROR] → fácil de alertar/filtrar en los logs de Vercel.
  console.error(`[PY-ERROR] ${contexto}${code ? ` code=${code}` : ""}: ${msg}`, extra ?? "");
  try {
    reporter?.({ contexto, error, extra });
  } catch {
    /* el reporter nunca rompe la app */
  }
}
