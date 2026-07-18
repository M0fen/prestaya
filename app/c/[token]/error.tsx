"use client";
// Límite de error de la vista del CLIENTE (link con token). Tono tranquilo, sin
// alarma: nada de color ni idioma de alerta (regla de tono de la vista cliente).
// Grande y legible (pensado para adultos mayores), con un botón amplio para
// reintentar. Money-safe: ante una falla NO muestra saldos/cartón, solo el aviso.
import { useEffect } from "react";
import { reportarError } from "@/lib/observabilidad";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportarError("boundary.cliente", error, { digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-fondo px-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-[24px] bg-[linear-gradient(150deg,#2453DC,#13308C)] text-white shadow-[0_14px_34px_rgba(19,48,140,0.34)]">
        <span className="text-[34px]" aria-hidden="true">💙</span>
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-[22px] font-extrabold text-tinta">Estamos actualizando tu información</h1>
        <p className="max-w-[300px] text-[15px] leading-[1.55] font-medium text-gris">
          Fue solo un momentito. Probá de nuevo y vas a ver tu cartón.
        </p>
      </div>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-full bg-[#1E47C8] px-7 py-3 text-[16px] font-extrabold text-white active:scale-[0.99]"
      >
        Probar de nuevo
      </button>
    </div>
  );
}
