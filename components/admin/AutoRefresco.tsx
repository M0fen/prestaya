"use client";
// Refresco automático de una pantalla "en vivo" del gestor (jornada En vivo,
// torre anti-fuga). Cada N segundos vuelve a pedir los datos del servidor
// (router.refresh, sin recargar la página ni perder scroll). Se PAUSA cuando la
// pestaña no está visible (no gasta datos ni carga en la calle) y muestra un
// indicador con latido para que el supervisor sepa que se actualiza solo.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresco({
  segundos = 25,
  etiqueta = "En vivo",
}: {
  segundos?: number;
  etiqueta?: string;
}) {
  const router = useRouter();
  const [activo, setActivo] = useState(true);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const arrancar = () => {
      if (id == null) id = setInterval(tick, segundos * 1000);
    };
    const parar = () => {
      if (id != null) {
        clearInterval(id);
        id = null;
      }
    };
    const onVis = () => {
      const visible = document.visibilityState === "visible";
      setActivo(visible);
      if (visible) {
        router.refresh(); // al volver, ponemos la vista al día de una
        arrancar();
      } else {
        parar();
      }
    };
    arrancar();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      parar();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router, segundos]);

  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-borde bg-tarjeta px-2.5 py-1 text-[11px] font-bold text-verde-osc">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full bg-verde ${activo ? "animate-pulse" : "opacity-40"}`}
      />
      {etiqueta} · {segundos}s
    </span>
  );
}
