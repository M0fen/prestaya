"use client";
// Solicitudes de renovación PENDIENTES. El admin aprueba (crea el crédito) o
// rechaza; el supervisor solo las ve "en espera".
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { aprobarSolicitud, rechazarSolicitud } from "@/app/admin/(panel)/renovaciones/actions";
import type { SolicitudRenovacion } from "@/lib/data/solicitudesRenovacion";

export function SolicitudesRenovacion({
  solicitudes,
  esAdmin,
}: {
  solicitudes: SolicitudRenovacion[];
  esAdmin: boolean;
}) {
  if (solicitudes.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
        Solicitudes de renovación · pendientes ({solicitudes.length})
      </span>
      <div className="flex flex-col gap-2">
        {solicitudes.map((s) => (
          <Item key={s.id} s={s} esAdmin={esAdmin} />
        ))}
      </div>
    </section>
  );
}

function Item({ s, esAdmin }: { s: SolicitudRenovacion; esAdmin: boolean }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const aprobar = () =>
    startTransition(async () => {
      setError(null);
      const r = await aprobarSolicitud(s.id);
      if (r.ok) router.refresh();
      else setError(r.error);
    });

  const rechazar = () =>
    startTransition(async () => {
      setError(null);
      const r = await rechazarSolicitud(s.id, motivo);
      if (r.ok) router.refresh();
      else setError(r.error);
    });

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-[#DCE7FB] bg-[#F7F9FF] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[14px] font-bold text-tinta">{s.clienteNombre}</span>
          <span className="text-[12px] font-medium text-gris tabular-nums">
            {UYU(s.monto)} × {s.totalDias} ({s.frecuencia})
          </span>
          {s.solicitadoPorNombre && (
            <span className="text-[11px] font-medium text-tenue">
              Pidió: {s.solicitadoPorNombre}
            </span>
          )}
        </div>
        {esAdmin ? (
          <div className="flex flex-shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setRechazando((v) => !v)}
              disabled={pendiente}
              className="rounded-full border border-borde px-3 py-1.5 text-[12px] font-bold text-gris disabled:opacity-50"
            >
              Rechazar
            </button>
            <button
              type="button"
              onClick={aprobar}
              disabled={pendiente}
              className="rounded-full bg-[#1FA971] px-3.5 py-1.5 text-[12px] font-extrabold text-white disabled:opacity-50"
            >
              {pendiente ? "…" : "Aprobar"}
            </button>
          </div>
        ) : (
          <span className="flex-shrink-0 rounded-full bg-[#EEF3FF] px-2.5 py-1 text-[11px] font-bold text-azul">
            Esperando al admin
          </span>
        )}
      </div>

      {esAdmin && rechazando && (
        <div className="flex gap-2">
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={300}
            placeholder="Motivo del rechazo (opcional)"
            className="flex-1 rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[13px] outline-none focus:border-azul"
          />
          <button
            type="button"
            onClick={rechazar}
            disabled={pendiente}
            className="rounded-full bg-[#D64545] px-3.5 py-2 text-[12px] font-bold text-white disabled:opacity-50"
          >
            Confirmar
          </button>
        </div>
      )}

      {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}
    </div>
  );
}
