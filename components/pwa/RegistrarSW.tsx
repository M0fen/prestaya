"use client";
// Registra el Service Worker (una sola vez, tras cargar) y avisa cuando hay una
// VERSIÓN NUEVA. Silencioso: si el navegador no lo soporta o falla, no rompe nada.
// En desarrollo NO se registra (para no cachear mientras iteramos).
//
// Higiene de actualización: durante el piloto se despliega varias veces al día. Un
// cobrador con la PWA abierta se queda con el bundle viejo en memoria hasta recargar.
// El SW hace skipWaiting()+clients.claim() → al desplegar, el SW nuevo toma control y
// dispara `controllerchange`. Si YA había un controlador al cargar (es una
// ACTUALIZACIÓN, no la 1ª instalación), mostramos un aviso NO intrusivo: el cobrador
// recarga cuando quiere (no se le corta un cobro; la cola offline no pierde nada).
import { useEffect, useState } from "react";

export function RegistrarSW() {
  const [hayActualizacion, setHayActualizacion] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // ¿Ya había un SW controlando la página al cargar? Si sí, un cambio de
    // controlador = versión NUEVA (no la primera instalación) → avisar.
    const tuvoControlador = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (tuvoControlador) setHayActualizacion(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const registrar = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* sin SW: la app sigue funcionando normal */
      });
    };
    // Esperar a que la página termine de cargar para no competir por ancho de banda.
    if (document.readyState === "complete") registrar();
    else window.addEventListener("load", registrar, { once: true });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!hayActualizacion) return null;

  return (
    <div
      className="toast-in fixed inset-x-0 top-[calc(env(safe-area-inset-top)+10px)] z-[60] mx-auto flex w-fit max-w-[92vw] items-center gap-2.5 rounded-full border border-borde bg-tarjeta px-3 py-2 shadow-[0_8px_24px_rgba(19,48,140,0.18)]"
      role="status"
    >
      <span className="text-[13px]" aria-hidden="true">🔄</span>
      <span className="text-[12.5px] font-semibold text-tinta">Hay una versión nueva.</span>
      <button
        type="button"
        onClick={() => location.reload()}
        className="rounded-full bg-[#2453DC] px-3 py-1 text-[12px] font-bold text-white active:scale-95"
      >
        Actualizar
      </button>
      <button
        type="button"
        onClick={() => setHayActualizacion(false)}
        aria-label="Descartar"
        className="px-1 text-[15px] leading-none font-bold text-gris"
      >
        ×
      </button>
    </div>
  );
}
