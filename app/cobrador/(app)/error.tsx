"use client";
// Límite de error de la app del COBRADOR. En la calle, un error NO debe asustar:
// los cobros ya guardados/encolados están a salvo (cola offline por-usuario, se
// sincronizan cuando vuelve la señal). Se muestra un estado explícito con
// "Reintentar" — nunca una pantalla en blanco. Money-safe: no renderiza cifras.
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
    reportarError("boundary.cobrador", error, { digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[62vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-[linear-gradient(150deg,#2453DC,#13308C)] text-white shadow-[0_12px_30px_rgba(19,48,140,0.3)]">
        <span className="text-[30px]" aria-hidden="true">🔄</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[18px] font-extrabold text-tinta">No pudimos cargar</h1>
        <p className="max-w-[300px] text-[13.5px] leading-[1.5] font-medium text-gris">
          Fue algo temporal. Tus cobros guardados están a salvo. Probá de nuevo.
        </p>
      </div>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-full bg-[#2453DC] px-6 py-2.5 text-[14px] font-extrabold text-white active:scale-[0.99]"
      >
        Reintentar
      </button>
    </div>
  );
}
