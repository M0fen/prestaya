"use client";
// Privacidad en TELÉFONO COMPARTIDO. El SW cachea las pantallas /cobrador por URL
// (no por usuario) para poder abrir offline. Si otro cobrador inicia sesión, al
// renderizar su layout (online) purgamos de la caché las páginas /cobrador del
// usuario anterior, para que nadie vea la ruta de otro si luego abre sin señal.
// La cola de cobros ya está particionada por usuario (colaOffline).
import { useEffect } from "react";

const CLAVE = "py_cache_ruta_user";

export function CacheRutaGuard({ usuarioId }: { usuarioId: string }) {
  useEffect(() => {
    try {
      const prev = localStorage.getItem(CLAVE);
      if (prev === usuarioId) return;
      localStorage.setItem(CLAVE, usuarioId);
      // Cambió el usuario (o es el primer login en este equipo): si había OTRO,
      // borrar sus páginas /cobrador cacheadas.
      if (!prev || typeof caches === "undefined") return;
      void caches.keys().then((nombres) =>
        Promise.all(
          nombres.map((n) =>
            caches.open(n).then((c) =>
              c.keys().then((reqs) =>
                Promise.all(
                  reqs.map((r) => {
                    let esCobrador = false;
                    try {
                      esCobrador = new URL(r.url).pathname.startsWith("/cobrador");
                    } catch {
                      /* url rara: no tocar */
                    }
                    return esCobrador ? c.delete(r) : Promise.resolve(false);
                  }),
                ),
              ),
            ),
          ),
        ),
      );
    } catch {
      /* sin localStorage/caches (modo privado, etc.): no pasa nada */
    }
  }, [usuarioId]);

  return null;
}
