"use client";
// "Recordarle a mi supervisor" — en cada pedido pendiente con horas encima.
// Manda push + chat de zona y ofrece el WhatsApp del supervisor con el texto.
import { useState, useTransition } from "react";
import { recordarPedido } from "@/lib/acciones/recordarPedido";

export function RecordarPedido({ solicitudId, horas }: { solicitudId: string; horas: number }) {
  const [res, setRes] = useState<Awaited<ReturnType<typeof recordarPedido>> | null>(null);
  const [pend, start] = useTransition();
  // Antes de 1 h no tiene sentido empujar: que respire.
  if (horas < 1) return null;

  if (res?.ok) {
    return (
      <div className="flex flex-col gap-1.5 rounded-[10px] bg-tarjeta px-2.5 py-2 text-[11.5px] font-semibold text-verde-osc">
        <span>
          ✓ Le avisamos {res.supervisorNombre ? `a ${res.supervisorNombre.split(" ")[0]}` : "a la oficina"}
          {res.chat ? " por el chat de la zona" : ""}{res.avisados > 0 ? " y al celular" : ""}.
        </span>
        {res.whatsapp && (
          <a href={res.whatsapp} target="_blank" rel="noopener noreferrer"
            className="w-fit rounded-full bg-[#25D366] px-3 py-1.5 text-[12px] font-extrabold text-white active:scale-95"
            onClick={(e) => e.stopPropagation()}>
            Mandarle WhatsApp también →
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pend}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); start(async () => setRes(await recordarPedido({ solicitudId }))); }}
        className="w-fit rounded-full border border-ambar-osc/40 bg-tarjeta px-3 py-1.5 text-[12px] font-extrabold text-ambar-osc active:scale-95 disabled:opacity-60"
      >
        {pend ? "Avisando…" : "🔔 Recordarle a mi supervisor"}
      </button>
      {res && !res.ok && <span className="text-[11px] font-semibold text-rojo-osc">{res.error}</span>}
    </div>
  );
}
