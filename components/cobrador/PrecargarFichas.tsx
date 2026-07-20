"use client";
// Pre-carga (best-effort) las fichas de la ruta MIENTRAS HAY SEÑAL, para que el
// cobrador pueda ABRIRLAS y cobrar SIN señal después. Sin esto, una ficha que no se
// cargó con señal quedaba inalcanzable offline (la app lo tiraba a la lista).
// El Service Worker (v3) cachea estos fetches de /cobrador/*; acá solo los disparamos.
// Se cachea el RSC (para la navegación SPA) y el HTML (para el fallback de recarga).
import { useEffect } from "react";

export function PrecargarFichas({ ids }: { ids: string[] }) {
  const clave = ids.join(",");
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.onLine) return;
    if (!("serviceWorker" in navigator)) return; // solo con SW (prod)
    let cancelado = false;
    (async () => {
      for (const id of ids) {
        if (cancelado || !navigator.onLine) break;
        const url = `/cobrador/cliente/${id}`;
        // RSC (navegación SPA) + documento (recarga dura). Ambos los cachea el SW.
        await fetch(url, { headers: { RSC: "1" } }).catch(() => {});
        await fetch(url).catch(() => {});
        await new Promise((r) => setTimeout(r, 160)); // no saturar la red del celular
      }
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  return null;
}
