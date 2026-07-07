"use client";
// Control de anulación de un pago en la ficha. El admin anula DIRECTO; el
// supervisor SOLICITA (y una segunda persona confirma en /admin/anulaciones).
// El doble registro lo hace cumplir el servidor; acá solo se ve distinto.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { anularPagoDirectoAction, solicitarAnulacionAction } from "@/lib/acciones/anulaciones";

export function AnularPago({
  pagoId,
  esAdmin,
  pendiente,
}: {
  pagoId: string;
  esAdmin: boolean;
  pendiente: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (pendiente) {
    return (
      <span className="rounded-full bg-[#FDF3E2] px-2.5 py-0.5 text-[10.5px] font-bold text-[#B9770E]">
        Anulación pendiente
      </span>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-[11px] font-bold text-[#C0392B] hover:underline"
      >
        {esAdmin ? "Anular" : "Solicitar anulación"}
      </button>
    );
  }

  function enviar() {
    setError(null);
    const m = motivo.trim();
    if (m.length < 3) {
      setError("Escribí el motivo.");
      return;
    }
    if (esAdmin && !confirm("¿Anular este pago? Queda registrado, no se borra.")) return;
    startTransition(async () => {
      const r = esAdmin
        ? await anularPagoDirectoAction({ pagoId, motivo: m })
        : await solicitarAnulacionAction({ pagoId, motivo: m });
      if (!r.ok) setError(r.error);
      else {
        setAbierto(false);
        setMotivo("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Motivo…"
        autoFocus
        className="w-40 rounded-[8px] border border-[#DCE3F1] px-2 py-1 text-[11.5px] font-medium text-tinta outline-none focus:border-azul"
      />
      <div className="flex items-center gap-2">
        {error && <span className="text-[10.5px] font-bold text-[#C0392B]">{error}</span>}
        <button
          type="button"
          onClick={() => {
            setAbierto(false);
            setError(null);
          }}
          className="text-[10.5px] font-bold text-gris hover:underline"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={enviar}
          className="rounded-[8px] bg-[#C0392B] px-2.5 py-1 text-[10.5px] font-bold text-white disabled:opacity-40"
        >
          {esAdmin ? "Anular" : "Solicitar"}
        </button>
      </div>
    </div>
  );
}
