"use client";
// Registra el Service Worker (una sola vez, tras cargar). Silencioso: si el
// navegador no lo soporta o falla, no rompe nada. En desarrollo NO se registra
// para no cachear mientras iteramos.
import { useEffect } from "react";

export function RegistrarSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const registrar = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* sin SW: la app sigue funcionando normal */
      });
    };
    // Esperar a que la página termine de cargar para no competir por ancho de banda.
    if (document.readyState === "complete") registrar();
    else window.addEventListener("load", registrar, { once: true });
  }, []);

  return null;
}
