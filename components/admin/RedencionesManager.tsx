"use client";
// Gestor de redenciones de estrellas (admin). Lista las solicitudes PENDIENTES
// y permite aprobar/rechazar. Al resolver, refresca. El premio real lo entrega
// la oficina (Mauricio); acá se registra la decisión (queda en auditoría).
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RedencionPendiente } from "@/lib/data/estrellas";
import { aprobarRedencion, rechazarRedencion } from "@/lib/acciones/estrellas";

export function RedencionesManager({ pendientes }: { pendientes: RedencionPendiente[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);

  const resolver = async (id: string, accion: "aprobar" | "rechazar") => {
    setOcupado(id);
    const r = accion === "aprobar" ? await aprobarRedencion(id) : await rechazarRedencion(id);
    setOcupado(null);
    if (r.ok) router.refresh();
  };

  if (pendientes.length === 0) {
    return (
      <div className="rounded-[16px] border border-borde bg-tarjeta p-6 text-center">
        <p className="text-[13px] font-medium text-gris">
          No hay canjes pendientes. Cuando un cliente pida canjear estrellas, aparece acá.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {pendientes.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-3 rounded-[16px] border border-borde bg-tarjeta p-3.5"
        >
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#FFF8E6] text-[20px]" aria-hidden="true">
            ⭐
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14px] font-bold text-tinta">{r.clienteNombre}</span>
            <span className="text-[12px] font-medium text-gris">
              Pide <b className="text-[#C79A1E]">{r.estrellas}</b> estrella{r.estrellas > 1 ? "s" : ""} · {r.ciclo}
            </span>
          </div>
          <div className="flex flex-shrink-0 gap-2">
            <button
              type="button"
              disabled={ocupado === r.id}
              onClick={() => resolver(r.id, "rechazar")}
              className="rounded-full border border-borde px-3 py-1.5 text-[12.5px] font-bold text-gris hover:bg-suave disabled:opacity-50"
            >
              Rechazar
            </button>
            <button
              type="button"
              disabled={ocupado === r.id}
              onClick={() => resolver(r.id, "aprobar")}
              className="rounded-full bg-[#1FA971] px-3.5 py-1.5 text-[12.5px] font-bold text-white active:scale-95 disabled:opacity-50"
            >
              {ocupado === r.id ? "…" : "Aprobar"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
