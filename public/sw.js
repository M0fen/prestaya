/*
 * Service Worker de Presta Ya — PWA instalable + offline elegante.
 *
 * ⚠️ App de DINERO: NUNCA servimos datos financieros viejos. Por eso:
 *   · Navegaciones (páginas)  → SOLO red. Si estás sin conexión, mostramos una
 *     página "sin conexión" amable; jamás un cartón/saldo cacheado y desactualizado.
 *   · Estáticos versionados    → cache-first (JS/CSS de _next llevan hash inmutable,
 *     íconos, bundles de juegos): cargan al instante y en repeticiones.
 *   · Supabase / /api / no-GET → NO se tocan (siempre a la red).
 *
 * Al cambiar de versión se limpian los caches viejos. Bump CACHE_VER para forzar.
 */
const CACHE_VER = "presta-ya-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VER).then((cache) => cache.addAll(PRECACHE)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(claves.filter((k) => k !== CACHE_VER).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// ¿Es un estático seguro de cachear? (mismo origen + ruta versionada/inmutable)
function esEstatico(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname.startsWith("/juegos/") ||
      url.pathname === "/icon.svg" ||
      url.pathname === "/manifest.webmanifest")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // escrituras siempre a la red
  const url = new URL(req.url);

  // Cross-origin (Supabase, APIs externas): no intervenimos.
  if (url.origin !== self.location.origin) return;
  // Datos dinámicos del servidor: nunca cachear (podrían traer saldos).
  if (url.pathname.startsWith("/api/")) return;

  // Navegaciones (abrir/recargar una página): SOLO red; offline → página amable.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Estáticos inmutables: cache-first (rápido), con relleno de red.
  if (esEstatico(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((resp) => {
            if (resp && resp.status === 200) {
              const copia = resp.clone();
              caches.open(CACHE_VER).then((c) => c.put(req, copia));
            }
            return resp;
          }),
      ),
    );
  }
});
