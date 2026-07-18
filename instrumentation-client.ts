// Sentry NAVEGADOR (client-side) — DSN-GATED con carga PEREZOSA.
//
// Si no hay NEXT_PUBLIC_SENTRY_DSN (estado actual), la rama es CÓDIGO MUERTO en
// build (la env pública se inlinea) → el SDK de Sentry NI ENTRA al bundle del
// cliente: cero peso para el cobrador en campo. Cuando Carlos agregue el DSN y
// redespliegue, se carga el SDK y se PUENTEA `reportarError` → Sentry, igual que
// en el servidor: así los errores de CLIENTE (los límites error.tsx de los
// Batches 5/6 + cualquier acción de plata que falle en el navegador) también
// dejan rastro, con su contexto.
//
// NB: al ser NEXT_PUBLIC_*, cambiar el DSN requiere REDESPLEGAR (se inlinea en
// build), no solo tocar la env — igual que la URL de Supabase.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void (async () => {
    const Sentry = await import("@sentry/nextjs");
    const { setReporter } = await import("@/lib/observabilidad");
    Sentry.init({
      dsn,
      // Solo errores (sin tracing) para no gastar cuota — igual que el server.
      tracesSampleRate: 0,
      environment: process.env.NODE_ENV || "development",
    });
    setReporter((ev) => {
      Sentry.captureException(ev.error, {
        tags: { contexto: ev.contexto },
        extra: ev.extra,
      });
    });
  })();
}
