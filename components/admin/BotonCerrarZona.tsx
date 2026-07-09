"use client";
// Botón para que el SUPERVISOR cierre la caja de su zona (confirma la entrega a
// la caja central). Pide confirmación y avisa si quedan cobradores sin rendir.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmarCierreZona } from "@/lib/acciones/cierreZona";
import { UYU } from "@/lib/format";

export function BotonCerrarZona({
  zonaId,
  totalEntregado,
  pendientes,
}: {
  zonaId: string;
  totalEntregado: number;
  pendientes: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cerrar() {
    if (pending) return;
    const aviso =
      pendientes > 0
        ? `Quedan ${pendientes} cobrador${pendientes === 1 ? "" : "es"} sin rendir. ¿Cerrar la zona igual?`
        : `Confirmás que recibiste ${UYU(totalEntregado)} y lo entregás a la caja central?`;
    if (!window.confirm(aviso)) return;
    setError(null);
    startTransition(async () => {
      const r = await confirmarCierreZona({ zonaId });
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={cerrar}
        disabled={pending}
        className="rounded-[10px] bg-[#2453DC] px-3.5 py-2 text-[12.5px] font-bold text-white disabled:opacity-60"
      >
        {pending ? "Cerrando…" : "Cerrar caja de la zona"}
      </button>
      {error && <span className="text-[11.5px] font-medium text-[#C0392B]">{error}</span>}
    </div>
  );
}
