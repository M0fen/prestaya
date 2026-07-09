"use client";
// Interruptor "Reportado" del cliente (solo admin). Persiste vía Server Action
// y queda en auditoría. Optimista con reversión si el server rechaza.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { marcarClienteReportado } from "@/lib/acciones/clientes";

export function ToggleReportado({
  clienteId,
  inicial,
}: {
  clienteId: string;
  inicial: boolean;
}) {
  const router = useRouter();
  const [reportado, setReportado] = useState(inicial);
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const alternar = () => {
    if (pendiente) return;
    const nuevo = !reportado;
    setReportado(nuevo);
    setError(null);
    startTransition(async () => {
      const res = await marcarClienteReportado({ clienteId, reportado: nuevo });
      if (!res.ok) {
        setReportado(!nuevo); // revertir
        setError(res.error);
      } else router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-between rounded-[16px] border border-[#E6EAF4] bg-white p-4">
      <div className="flex flex-col">
        <span className="text-[13px] font-bold text-tinta">Cliente reportado</span>
        <span className="text-[11.5px] font-medium text-gris">
          Márcalo si está reportado a buró / lista de morosos. Queda en auditoría.
        </span>
        {error && <span className="mt-1 text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}
      </div>
      <button
        type="button"
        onClick={alternar}
        disabled={pendiente}
        aria-pressed={reportado}
        className={`relative h-7 w-12 flex-shrink-0 rounded-full transition-colors ${
          reportado ? "bg-[#C0392B]" : "bg-[#D0D5E2]"
        } disabled:opacity-60`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
            reportado ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
