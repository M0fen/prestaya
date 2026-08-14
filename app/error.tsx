"use client";
// Límite de error a nivel de APP (catch-all): toma lo que se escape de los límites
// por-segmento (p. ej. un error del layout de un grupo). Renderiza dentro del layout
// raíz → tiene la hoja de estilos (Tailwind). Money-safe por construcción: ante una
// falla se ve un estado EXPLÍCITO con "Reintentar", nunca una pantalla en blanco ni
// —peor— un $0 falso (el error NO renderiza números). Deja rastro vía reportarError.
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
    reportarError("boundary.app", error, { digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-fondo px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#FDECEC] text-[#C0392B]">
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[18px] font-extrabold text-tinta">No pudimos cargar la pantalla</h1>
        <p className="max-w-[300px] text-[13.5px] leading-[1.5] font-medium text-gris">
          Fue algo temporal. Tus datos están a salvo — probá de nuevo.
        </p>
      </div>
      <button
        type="button"
        onClick={() => reset()}
        className="btn-primario px-6 py-2.5 text-[13px] font-bold text-white active:scale-[0.99]"
      >
        Reintentar
      </button>
      {error.digest && (
        <span className="text-[10.5px] font-medium text-[#9AA3BC]">Ref: {error.digest}</span>
      )}
    </div>
  );
}
