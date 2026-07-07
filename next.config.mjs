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

// Content-Security-Policy. Permite lo que la app REALMENTE usa:
//  · Next hidrata con scripts/estilos inline → 'unsafe-inline' (sin nonce).
//  · Supabase: auth (https) + realtime del chat (wss).
//  · Leaflet: tiles de OpenStreetMap (img).
//  · PWA: service worker (worker-src) + manifest.
// Y BLOQUEA: framing (clickjacking), objetos, orígenes de script/red ajenos.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
  "font-src 'self' data:",
  `connect-src 'self'${supabaseHttp ? " " + supabaseHttp : ""}${supabaseWs ? " " + supabaseWs : ""}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self'",
  "frame-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)",
  },
];

const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
