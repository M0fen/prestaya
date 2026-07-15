// Next.js instrumentation — carga la config de Sentry según el runtime al arrancar
// el server. Todo DSN-gated (sin DSN es no-op). onRequestError manda los errores no
// capturados de las rutas del servidor a Sentry (si está inicializado).
import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
