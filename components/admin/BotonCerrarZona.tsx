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
  esSinZona = false,
}: {
  zonaId: string;
  totalEntregado: number;
  pendientes: number;
  /** true = bucket "Caja del día" (cobradores sin zona), solo lo sella el admin. */
  esSinZona?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const quePieza = esSinZona ? "la Caja del día" : "la zona";

  function cerrar() {
    if (pending) return;
    const aviso =
      pendientes > 0
        ? `Quedan ${pendientes} cobrador${pendientes === 1 ? "" : "es"} sin rendir. ¿Cerrar ${quePieza} igual?`
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
        className="btn-primario px-3.5 py-2 text-[12.5px] font-bold text-white disabled:opacity-60"
      >
        {pending ? "Cerrando…" : esSinZona ? "Cerrar Caja del día" : "Cerrar caja de la zona"}
      </button>
      {error && <span className="text-[11.5px] font-medium text-rojo-osc">{error}</span>}
    </div>
  );
}
