"use client";
// Bandeja de solicitudes de anulación pendientes. La SEGUNDA persona (admin u
// otro gestor distinto al que pidió) confirma o rechaza. Quien la pidió no
// puede confirmar su propia solicitud (doble registro; el server lo re-valida).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { confirmarAnulacionAction, rechazarAnulacionAction } from "@/lib/acciones/anulaciones";
import type { SolicitudAnulacion } from "@/lib/data/anulaciones";

// Fecha/hora legible con fallback: una fecha ilegible da "—" (no "Invalid Date").
function fechaHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-UY");
}

export function SolicitudesAnulacion({
  solicitudes,
  yoId,
}: {
  solicitudes: SolicitudAnulacion[];
  yoId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ejecutar(p: Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await p;
      if (!r.ok) setError(r.error ?? "No se pudo procesar.");
      else router.refresh();
    });
  }

  if (solicitudes.length === 0) {
    return (
      <p className="rounded-[14px] border border-dashed border-[#DCE3F1] bg-tarjeta px-4 py-8 text-center text-[13px] font-medium text-gris">
        No hay solicitudes de anulación pendientes. Todo en orden ✓
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="rounded-[12px] bg-[#FDECEA] px-4 py-2.5 text-[12.5px] font-bold text-[#C0392B]">
          {error}
        </div>
      )}
      {solicitudes.map((s) => {
        const esMia = s.solicitadoPor === yoId;
        return (
          <div key={s.id} className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-[14px] font-extrabold text-tinta">
                  {s.clienteNombre ?? "Cliente"} · {s.monto != null ? UYU(s.monto) : "—"}
                </span>
                <span className="text-[12px] font-medium text-gris">
                  Pidió {s.solicitadoPorNombre ?? "—"} · {fechaHora(s.solicitadoEn)}
                </span>
              </div>
              <span className="flex-shrink-0 rounded-full bg-[#FDF3E2] px-2.5 py-0.5 text-[11px] font-bold text-[#B9770E]">
                Pendiente
              </span>
            </div>
            <p className="rounded-[10px] bg-suave px-3 py-2 text-[12.5px] font-medium text-tinta">
              “{s.motivo?.trim() || "Sin motivo"}”
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const m = prompt("Motivo del rechazo (opcional):") ?? "";
                  ejecutar(rechazarAnulacionAction({ solicitudId: s.id, motivo: m }));
                }}
                className="rounded-[10px] border border-[#DCE3F1] px-3.5 py-1.5 text-[12px] font-bold text-gris hover:bg-suave disabled:opacity-40"
              >
                Rechazar
              </button>
              <button
                type="button"
                disabled={pending || esMia}
                title={esMia ? "No podés confirmar tu propia solicitud (doble registro)" : undefined}
                onClick={() => {
                  if (confirm("¿Confirmar la anulación? El pago queda anulado (no se borra).")) {
                    ejecutar(confirmarAnulacionAction({ solicitudId: s.id }));
                  }
                }}
                className="rounded-[10px] bg-[#C0392B] px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
              >
                {esMia ? "La pediste vos" : "Confirmar anulación"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
