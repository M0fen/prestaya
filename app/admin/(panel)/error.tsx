"use client";
// Límite de error del PANEL (admin/supervisor). Si un query lento o transitorio
// lanza, mostramos un estado EXPLÍCITO con "Reintentar" — nunca una pantalla en
// blanco ni un $0 falso (el error NO renderiza números). Money-safe por
// construcción. Botón secundario para volver al inicio del panel.
import { useEffect } from "react";
import Link from "next/link";
import { reportarError } from "@/lib/observabilidad";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportarError("boundary.panel", error, { digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
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
        <h1 className="text-[18px] font-extrabold text-tinta">No pudimos cargar esta pantalla</h1>
        <p className="max-w-[300px] text-[13.5px] leading-[1.5] font-medium text-gris">
          Fue algo temporal. Tus datos están a salvo — probá de nuevo.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="btn-primario px-5 py-2.5 text-[13px] font-bold text-white active:scale-[0.99]"
        >
          Reintentar
        </button>
        <Link
          href="/admin"
          className="rounded-full border border-borde bg-tarjeta px-5 py-2.5 text-[13px] font-bold text-gris"
        >
          Ir al inicio
        </Link>
      </div>
      {error.digest && (
        <span className="text-[10.5px] font-medium text-[#9AA3BC]">Ref: {error.digest}</span>
      )}
    </div>
  );
}
