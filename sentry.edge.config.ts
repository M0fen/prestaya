// Sentry (edge runtime) — DSN-gated. El middleware y algunas rutas corren en edge;
// las acciones de plata corren en node (ver sentry.server.config para el puente).
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
  });
}
