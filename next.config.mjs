/** @type {import('next').NextConfig} */

// Orígenes de Supabase (auth + realtime) para la CSP. Se derivan del entorno.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
let supabaseHttp = "";
let supabaseWs = "";
try {
  if (supabaseUrl) {
    const o = new URL(supabaseUrl).origin;
    supabaseHttp = o;
    supabaseWs = o.replace(/^https:/, "wss:");
  }
} catch {
  /* si la URL no es válida, la CSP queda con 'self' solamente */
}

// Host de ingest de Sentry (navegador) para la CSP. Se DERIVA del DSN público
// (formato https://<key>@<host>/<proj> → origin = https://<host>). Sin DSN no
// suma nada (la CSP no se abre de más). Necesario para que el SDK del navegador
// pueda POSTear los errores; sin él la CSP bloquearía el envío.
let sentryHost = "";
try {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || "";
  if (dsn) sentryHost = new URL(dsn).origin;
} catch {
  /* DSN inválido → sin host de Sentry en la CSP */
}

// Content-Security-Policy. Permite lo que la app REALMENTE usa:
//  · Next hidrata con scripts/estilos inline → 'unsafe-inline' (sin nonce).
//  · Supabase: auth (https) + realtime del chat (wss).
//  · Leaflet: tiles de OpenStreetMap (img).
//  · PWA: service worker (worker-src) + manifest.
// Y BLOQUEA: framing (clickjacking), objetos, orígenes de script/red ajenos.
// NOTA: 'unsafe-eval' se quita en PRODUCCIÓN (Next 15 prod/Leaflet no lo usan →
// menos superficie XSS), pero se DEJA en desarrollo: el dev-server de Next envuelve
// cada módulo en eval() (source maps), y sin él `next dev` no arranca en localhost.
const enDesarrollo = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${enDesarrollo ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Supabase Storage sirve las fotos de anuncios/tienda (bucket público) desde el
  // host de Supabase → tiene que estar en img-src, si no la CSP las bloquea.
  `img-src 'self' data: blob: https://*.tile.openstreetmap.org${supabaseHttp ? " " + supabaseHttp : ""}`,
  "font-src 'self' data:",
  `connect-src 'self'${supabaseHttp ? " " + supabaseHttp : ""}${supabaseWs ? " " + supabaseWs : ""}${sentryHost ? " " + sentryHost : ""}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  // Videos de la tienda (bucket público de Supabase).
  `media-src 'self' blob:${supabaseHttp ? " " + supabaseHttp : ""}`,
  "frame-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // `preload` (post-dominio 08-04): con dominio propio definitivo, el navegador
  // puede fijar HTTPS-siempre incluso ANTES de la primera visita (lista de
  // precarga de los browsers) → mata el ataque de downgrade en la primera
  // conexión (el único hueco que HSTS solo no cubre).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // camera=(self): el censo del cobrador saca foto del cliente (anti-fantasma).
    value: "camera=(self), microphone=(), payment=(), usb=(), geolocation=(self)",
  },
];

const nextConfig = {
  // Las fotos van comprimidas (~800px) por Server Action; damos aire al payload.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // El cartón del cliente va por TOKEN en la URL (se comparte por WhatsApp):
      // que JAMÁS termine en un índice de búsqueda. robots.txt es solo una señal;
      // este header sí obliga al buscador a no indexar ni archivar la página.
      {
        source: "/c/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/cobrador/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
