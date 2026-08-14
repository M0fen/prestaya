"use client";
// Bandeja de solicitudes de gasto de ruta (solo admin). Aprobar crea el egreso
// real en la caja; rechazar la cierra sin mover plata. Todo queda auditado.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aprobarGastoRuta, rechazarGastoRuta } from "@/lib/acciones/gastos";
import { UYU, horaDe } from "@/lib/format";
import type { SolicitudGasto } from "@/lib/data/solicitudesGasto";

export function SolicitudesGasto({
  solicitudes,
  puedeAprobar = true,
}: {
  solicitudes: SolicitudGasto[];
  /** Solo el admin aprueba/rechaza; el supervisor VE (botones ocultos). */
  puedeAprobar?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const aprobar = (id: string) => {
    setError(null);
    startTransition(async () => {
      const r = await aprobarGastoRuta({ solicitudId: id });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };
  const rechazar = (id: string) => {
    setError(null);
    startTransition(async () => {
      const r = await rechazarGastoRuta({ solicitudId: id, motivo: motivo.trim() || undefined });
      if (!r.ok) setError(r.error);
      else {
        setRechazando(null);
        setMotivo("");
        router.refresh();
      }
    });
  };

  if (solicitudes.length === 0) {
    return (
      <section className="rounded-[16px] border border-borde bg-verde-suave px-4 py-6 text-center">
        <span className="text-[13px] font-bold text-verde-osc">Sin solicitudes pendientes. ✓</span>
        <p className="mt-1 text-[12px] font-medium text-verde-osc">
          Cuando un cobrador pida un gasto, aparece acá {puedeAprobar ? "para tu aprobación" : "para que lo sigas"}.
        </p>
      </section>
    );
  }

  const totalPendiente = solicitudes.reduce((acc, x) => acc + x.monto, 0);

  return (
    <section className="flex flex-col gap-2.5">
      {error && <p className="rounded-[12px] bg-rojo-suave px-3 py-2 text-[12px] font-bold text-rojo-osc">{error}</p>}

      {/* Resumen: cuánto efectivo está esperando salir de caja, de un vistazo. */}
      <div className="flex items-center justify-between rounded-[12px] bg-ambar-suave px-4 py-2.5">
        <span className="text-[12.5px] font-bold text-ambar-osc">
          {solicitudes.length} solicitud{solicitudes.length === 1 ? "" : "es"} esperando {puedeAprobar ? "tu aprobación" : "aprobación del admin"}
        </span>
        <span className="text-[15px] font-extrabold tabular-nums text-ambar-osc">{UYU(totalPendiente)}</span>
      </div>

      {solicitudes.map((s) => (
        <div key={s.id} className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="text-[14px] font-extrabold text-tinta">{s.cobradorNombre ?? "Cobrador"}</span>
              <span className="text-[12px] font-medium text-gris">
                {s.categoria ?? "Gasto"}
                {s.descripcion ? ` · ${s.descripcion}` : ""} · {horaDe(s.solicitadoEn)}
              </span>
              {/* Contexto para decidir: revisar su actividad de campo antes de aprobar. */}
              <Link href="/admin/campo" className="mt-0.5 w-fit text-[11.5px] font-bold text-azul hover:underline">
                Ver su campo →
              </Link>
            </div>
            <span className="flex-shrink-0 text-[18px] font-black tabular-nums text-rojo-osc">{UYU(s.monto)}</span>
          </div>

          {/* Comprobante que adjuntó el cobrador (foto/factura): verificalo antes de aprobar. */}
          {s.comprobanteUrl ? (
            <a
              href={s.comprobanteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-[12px] border border-borde bg-suave px-2.5 py-2 hover:bg-[#EEF3FF]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.comprobanteUrl}
                alt="Comprobante"
                className="h-12 w-12 flex-shrink-0 rounded-[8px] border border-borde object-cover"
              />
              <span className="flex-1 text-[12px] font-bold text-azul">📎 Ver comprobante adjunto →</span>
            </a>
          ) : (
            <span className="w-fit rounded-[12px] bg-ambar-suave px-2.5 py-1.5 text-[11.5px] font-semibold text-ambar-osc">
              Sin comprobante adjunto
            </span>
          )}

          {!puedeAprobar ? (
            // El supervisor VE la solicitud pero no la resuelve: la aprueba el admin.
            <span className="w-fit rounded-[12px] bg-[#EEF1F8] px-2.5 py-1.5 text-[11.5px] font-semibold text-gris">
              Pendiente de aprobación del administrador
            </span>
          ) : rechazando === s.id ? (
            <div className="flex flex-col gap-2">
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivo del rechazo (opcional)"
                autoFocus
                className="rounded-[12px] border border-borde bg-suave px-3 py-2 text-[13px] text-tinta outline-none focus:border-azul"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRechazando(null)}
                  className="text-[12px] font-bold text-gris hover:underline"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => rechazar(s.id)}
                  className="rounded-[12px] bg-[#C0392B] px-3.5 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-40"
                >
                  Confirmar rechazo
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRechazando(s.id)}
                disabled={pending}
                className="rounded-[12px] border border-borde px-3.5 py-1.5 text-[12.5px] font-bold text-gris hover:bg-suave disabled:opacity-40"
              >
                Rechazar
              </button>
              <button
                type="button"
                onClick={() => aprobar(s.id)}
                disabled={pending}
                className="rounded-[12px] bg-[#1FA971] px-4 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-40"
              >
                {pending ? "…" : "Aprobar"}
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
