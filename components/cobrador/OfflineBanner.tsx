"use client";
// Banner de "sin conexión" para la app del cobrador. Con el SW network-first
// (public/sw.js), la app ABRE sin señal mostrando la última ruta guardada; este
// banner deja CLARO que los datos son de la última sincronización y que los cobros
// se guardan y se envían solos al volver la señal. Nunca simula estar en línea.
import { useEffect, useState } from "react";

export function OfflineBanner() {
  // Arranca en null para no parpadear en el primer render (SSR no sabe si hay red).
  const [offline, setOffline] = useState<boolean | null>(null);

  useEffect(() => {
    const sync = () =>
      setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-[57px] z-[9] flex items-start gap-2.5 border-b border-ambar-suave bg-ambar-suave px-4 py-2.5"
    >
      <span className="text-[15px] leading-none" aria-hidden>
        📴
      </span>
      <div className="flex flex-col leading-tight">
        <span className="text-[12.5px] font-extrabold text-ambar-osc">Sin conexión</span>
        <span className="text-[11.5px] font-medium text-ambar-osc">
          Estás viendo tu última ruta guardada. Tus cobros se guardan y se envían solos
          cuando vuelva la señal.
        </span>
      </div>
    </div>
  );
}
