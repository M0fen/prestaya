/*
 * Service Worker de Presta Ya — PWA instalable + offline de campo.
 *
 * ⚠️ App de DINERO. Estrategia por tipo de request:
 *   · App del COBRADOR (/cobrador*) → NETWORK-FIRST con caché: si hay señal,
 *     siempre datos frescos (y se guarda copia); sin señal, se sirve la ÚLTIMA
 *     versión guardada de esa pantalla para que el cobrador PUEDA abrir la app en
 *     la calle y encolar cobros. Es una decisión deliberada: el cobro de cuota
 *     diaria es fijo (no depende del saldo vivo), un banner marca "sin conexión",
 *     y el SERVIDOR re-valida y capa cada cobro al sincronizar (anti sobre-pago).
 *   · Otras navegaciones (admin/supervisor/cliente) → SOLO red; offline → página
 *     amable. Nunca se cachea un saldo/cartón "vivo" de esas superficies.
 *   · Estáticos versionados → cache-first (JS/CSS de _next con hash inmutable,
 *     íconos, bundles de juegos).
 *   · Supabase / /api / no-GET → NO se tocan (siempre a la red).
 *
 * Teléfono compartido: la caché de /cobrador es por URL, no por usuario; el cliente
 * (CacheRutaGuard) la purga al cambiar de cobrador. La cola de cobros ya es por-usuario.
 *
 * Al cambiar de versión se limpian los caches viejos. Bump CACHE_VER para forzar.
 */
const CACHE_VER = "presta-ya-v4";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/manifest.webmanifest"];

// ⚠️ AVISAR CUANDO SE SIRVE UNA COPIA (15-08). Caso real: Edward Muñoz vio la
// ficha de MARIA MERCEDES MOREIRA con "0/24 cubiertos" y las cuotas 1-2-3 grises,
// cuando el servidor daba 3/24 pagadas — el teléfono tenía LTE con señal pero sin
// respuesta, `navigator.onLine` seguía en true, el fetch falló y el SW sirvió la
// última copia de la ficha SIN que nada lo dijera. En dinero, una pantalla vieja
// que parece fresca es un bug: se le avisa a todas las ventanas abiertas para que
// el banner lo marque, aunque el teléfono crea estar en línea.
function avisarCopiaServida(url) {
  self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((cs) => cs.forEach((c) => c.postMessage({ tipo: "copia-servida", url })))
    .catch(() => {});
}
function servirCopia(req, cadena) {
  return cadena.then((hit) => {
    if (hit) avisarCopiaServida(req.url);
    return hit;
  });
}

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

// ¿Es una pantalla de la app del cobrador? (se cachea para abrir OFFLINE)
function esRutaCobrador(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/cobrador");
}

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

  // Navegaciones (abrir/recargar una página).
  if (req.mode === "navigate") {
    // App del cobrador: NETWORK-FIRST con caché. Con señal, red fresca + guardar
    // copia; sin señal, la última versión de ESA pantalla (o la ruta principal, o
    // la página offline como último recurso). Así abre en la calle sin conexión.
    if (esRutaCobrador(url)) {
      event.respondWith(
        fetch(req)
          .then((resp) => {
            if (resp && resp.status === 200) {
              const copia = resp.clone();
              caches.open(CACHE_VER).then((c) => c.put(req, copia));
            }
            return resp;
          })
          .catch(() =>
            // `ignoreSearch`: la ficha se cacheó con señal (por navegación o por la
            // precarga) aunque el query varíe → así se ENCUENTRA sin señal, en vez
            // de caer a la lista de ruta y no poder abrir/cobrar a ese cliente.
            servirCopia(
              req,
              caches
                .match(req, { ignoreSearch: true })
                .then((hit) => hit || caches.match("/cobrador"))
                .then((hit) => hit || caches.match(OFFLINE_URL)),
            ),
          ),
      );
      return;
    }
    // Resto (admin/supervisor/cliente): SOLO red; offline → página amable. Nunca
    // se cachea un saldo/cartón "vivo" de esas superficies.
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Navegación SPA de la app del cobrador (RSC / prefetch / precarga de fichas):
  // NO son `mode==='navigate'` (son fetch con header RSC, mode 'cors'), así que sin
  // esto el SW no las cacheaba y una ficha que no se cargó con señal quedaba
  // inalcanzable offline (la app tiraba al cobrador a la lista). Network-first con
  // caché: con señal, fresco + copia; sin señal, la copia guardada. Money-safe: el
  // cobro de cuota es fijo y el servidor re-valida/capa cada cobro al sincronizar.
  if (esRutaCobrador(url)) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const copia = resp.clone();
            caches.open(CACHE_VER).then((c) => c.put(req, copia));
          }
          return resp;
        })
        .catch(() => servirCopia(req, caches.match(req, { ignoreSearch: true }))),
    );
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

// ── Avisos PUSH (internos: admin/supervisor/cobrador) ──────────────────────
// El servidor manda { titulo, cuerpo, url, tag }. Mostramos la notificación y,
// al tocarla, enfocamos/abrimos la pantalla indicada.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = {};
  }
  const titulo = data.titulo || "Presta Ya";
  const opciones = {
    body: data.cuerpo || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/admin" },
  };
  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientes) => {
        for (const c of clientes) {
          if (c.url.includes(destino) && "focus" in c) return c.focus();
        }
        return self.clients.openWindow(destino);
      }),
  );
});
