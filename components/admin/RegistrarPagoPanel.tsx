"use client";
// Registrar un pago desde la ficha (admin/supervisor): cobros de oficina /
// transferencia / pago al supervisor. Abre un mini-form (monto opcional = cuota,
// + canal) y llama a la server action. El servidor valida permiso por zona.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registrarPagoPanel } from "@/lib/acciones/pagosPanel";

const CANALES = [
  { id: "efectivo", label: "Efectivo (oficina)" },
  { id: "transferencia", label: "Transferencia" },
  { id: "supervisor", label: "Pago al supervisor" },
];

export function RegistrarPagoPanel({
  clienteId,
  prestamoId,
  cuota,
}: {
  clienteId: string;
  prestamoId: string;
  cuota: number;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState("");
  const [canal, setCanal] = useState("efectivo");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function enviar() {
    setError(null);
    setOk(null);
    const bruto = monto.trim();
    const m = bruto === "" ? null : Math.round(Number(bruto));
    if (m !== null && (!Number.isFinite(m) || m <= 0)) {
      setError("Monto inválido.");
      return;
    }
    startTransition(async () => {
      const r = await registrarPagoPanel({ clienteId, prestamoId, monto: m, canal });
      if (!r.ok) setError(r.error);
      else {
        setOk(`✓ Pago de $${r.monto.toLocaleString("es-UY")} registrado (día ${r.dia}).`);
        setMonto("");
        router.refresh();
      }
    });
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => {
          setAbierto(true);
          setOk(null);
          setError(null);
        }}
        className="flex-shrink-0 rounded-full bg-[#1FA971] px-3 py-1.5 text-[12px] font-bold text-white transition-transform active:scale-95"
      >
        + Registrar pago
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-[12px] border border-[#CFEBDD] bg-[#F1FBF6] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-extrabold text-[#157A50]">Registrar pago (oficina)</span>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="text-[11px] font-bold text-gris hover:underline"
        >
          Cerrar
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-tenue">Monto</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder={`Cuota ${Math.round(cuota).toLocaleString("es-UY")}`}
            className="w-32 rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[13.5px] text-tinta outline-none focus:border-azul"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-tenue">Canal</span>
          <select
            value={canal}
            onChange={(e) => setCanal(e.target.value)}
            className="rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[13.5px] text-tinta outline-none focus:border-azul"
          >
            {CANALES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={enviar}
          className="rounded-[10px] bg-[#1FA971] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40"
        >
          {pending ? "Registrando…" : "Confirmar"}
        </button>
      </div>
      <p className="text-[10.5px] font-medium text-[#4E9E79]">
        Se imputa al primer día pendiente. Queda en auditoría. Vacío = una cuota.
      </p>
      {error && <span className="text-[11px] font-bold text-[#C0392B]">{error}</span>}
      {ok && <span className="text-[11px] font-bold text-[#157A50]">{ok}</span>}
    </div>
  );
}
