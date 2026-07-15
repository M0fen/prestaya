// Sentry (servidor) — DSN-GATED: si no hay DSN configurado, NO se inicializa
// (cero impacto). Cuando Carlos agregue SENTRY_DSN en el entorno, captura los
// errores del servidor + PUENTEA `reportarError` (los 7 caminos de plata) a Sentry.
import * as Sentry from "@sentry/nextjs";
import { setReporter } from "@/lib/observabilidad";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Sin tracing por defecto (solo errores) para no gastar cuota; subir si se quiere.
    tracesSampleRate: 0,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
  });

  // Puente: cada error de una ruta de PLATA reportado por lib/observabilidad va a
  // Sentry con su contexto (registrarPagoCobrador, liquidarComision, etc.).
  setReporter((ev) => {
    Sentry.captureException(ev.error, {
      tags: { contexto: ev.contexto },
      extra: ev.extra,
    });
  });
}
