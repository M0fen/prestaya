"use client";
// Banner de "sin conexión" / "datos guardados" para la app del cobrador. Con el
// SW network-first (public/sw.js), la app ABRE sin señal mostrando la última
// pantalla guardada; este banner deja CLARO que los datos son de la última
// sincronización y que los cobros se guardan y se envían solos al volver la señal.
// Nunca simula estar en línea.
//
// ⚠️ DOS señales, no una (15-08). `navigator.onLine` dice "hay red" aunque la
// red no conteste: con LTE flaca el fetch falla, el SW sirve la COPIA guardada
// y este banner no aparecía — Edward vio un cartón con "0/24 cubiertos" que el
// servidor tenía en 3/24, sin ninguna marca de que era viejo. Ahora el SW manda
// un mensaje cuando sirve una copia y acá se muestra, con botón para reintentar.
import { useEffect, useState } from "react";

export function OfflineBanner() {
  // Arranca en null para no parpadear en el primer render (SSR no sabe si hay red).
  const [offline, setOffline] = useState<boolean | null>(null);
  const [copiaVieja, setCopiaVieja] = useState(false);

  useEffect(() => {
    const sync = () =>
      setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    // El SW avisa cuando lo que se está mostrando salió de la caché, no de la red.
    const onMsg = (e: MessageEvent) => {
      if (e.data?.tipo === "copia-servida") setCopiaVieja(true);
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, []);

  if (!offline && !copiaVieja) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-[57px] z-[9] flex items-start gap-2.5 border-b border-ambar-suave bg-ambar-suave px-4 py-2.5"
    >
      <span className="text-[15px] leading-none" aria-hidden>
        📴
      </span>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-[12.5px] font-extrabold text-ambar-osc">
          {offline ? "Sin conexión" : "Sin respuesta de la red"}
        </span>
        <span className="text-[11.5px] font-medium text-ambar-osc">
          {offline
            ? "Estás viendo tu última ruta guardada. Tus cobros se guardan y se envían solos cuando vuelva la señal."
            : "Estás viendo una copia GUARDADA de esta pantalla: los pagos y el cartón pueden estar viejos. Tus cobros se guardan igual y se envían solos."}
        </span>
      </div>
      {!offline && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-9 flex-shrink-0 rounded-full bg-tarjeta px-3 text-[12px] font-bold text-ambar-osc active:scale-95"
        >
          Actualizar
        </button>
      )}
    </div>
  );
}
