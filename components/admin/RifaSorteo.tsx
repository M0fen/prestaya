"use client";
// Sorteo REAL de la rifa (admin): ve los participantes con su número, sortea un
// ganador al azar (o elige uno), y cierra la rifa dejando el ganador + comprobante.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sortearRifa } from "@/lib/acciones/rifas";
import type { ParticipanteRifa } from "@/lib/data/rifas";

export function RifaSorteo({
  rifaId,
  estado,
  participantes,
  ganadorNombre,
  ganadorNumero,
  folio,
}: {
  rifaId: string;
  estado: "abierta" | "cerrada";
  participantes: ParticipanteRifa[];
  ganadorNombre: string | null;
  ganadorNumero: number | null;
  folio: number | null;
}) {
  const router = useRouter();
  const [verLista, setVerLista] = useState(false);
  const [elegido, setElegido] = useState<string>(""); // clienteId elegido a mano (o "")
  const [confirmar, setConfirmar] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pend, start] = useTransition();

  const sortear = () => {
    setErr(null);
    start(async () => {
      const r = await sortearRifa({ rifaId, ganadorClienteId: elegido || null });
      if (r.ok) { setConfirmar(false); router.refresh(); }
      else { setErr(r.error); setConfirmar(false); }
    });
  };

  return (
    <section className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-extrabold text-tinta">Sorteo</span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
            estado === "cerrada" ? "bg-suave text-gris" : "bg-verde-suave text-verde-osc"
          }`}
        >
          {estado === "cerrada" ? "Sorteada" : "Abierta"}
        </span>
      </div>

      {estado === "cerrada" ? (
        <div className="flex flex-col gap-1 rounded-[12px] border border-[#DCE6FB] bg-azul-suave p-3.5">
          <span className="text-[12px] font-semibold text-gris">🏆 Ganador</span>
          <span className="text-[16px] font-extrabold text-tinta">{ganadorNombre ?? "—"}</span>
          <span className="text-[12.5px] font-medium text-gris">
            Número {ganadorNumero != null ? String(ganadorNumero).padStart(3, "0") : "—"}
            {folio != null && ` · Comprobante N.º ${String(folio).padStart(6, "0")}`}
          </span>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 rounded-[12px] bg-suave px-3.5 py-2.5">
            <span className="text-[12.5px] font-semibold text-gris">Participantes</span>
            <span className="text-[16px] font-extrabold tabular-nums text-tinta">{participantes.length}</span>
          </div>

          {participantes.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setVerLista((v) => !v)}
                className="w-fit text-[12px] font-bold text-azul"
              >
                {verLista ? "Ocultar participantes" : "Ver participantes"}
              </button>
              {verLista && (
                <div className="flex max-h-56 flex-col divide-y divide-linea overflow-auto rounded-[12px] border border-borde">
                  {participantes.map((p) => (
                    <label key={p.clienteId} className="flex cursor-pointer items-center gap-2 px-3 py-1.5">
                      <input
                        type="radio"
                        name="ganador"
                        checked={elegido === p.clienteId}
                        onChange={() => setElegido(elegido === p.clienteId ? "" : p.clienteId)}
                      />
                      <span className="rounded-full bg-suave px-2 py-0.5 text-[11px] font-bold tabular-nums text-cuerpo">
                        {String(p.numero).padStart(3, "0")}
                      </span>
                      <span className="truncate text-[12.5px] font-semibold text-tinta">{p.clienteNombre}</span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          {err && <span className="text-[12px] font-semibold text-[#C0392B]">{err}</span>}

          {!confirmar ? (
            <button
              type="button"
              onClick={() => setConfirmar(true)}
              disabled={participantes.length === 0}
              className="rounded-full bg-[#7A4DD6] px-4 py-2.5 text-[13px] font-extrabold text-white active:scale-[0.98] disabled:opacity-40"
            >
              {elegido ? "Cerrar con el ganador elegido" : "Sortear ganador al azar"}
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-[12px] border border-[#F0D9A8] bg-ambar-suave p-3">
              <span className="text-[12.5px] font-semibold text-ambar-osc">
                {elegido
                  ? "Vas a cerrar la rifa con el ganador que elegiste. No se puede deshacer."
                  : "Vas a sortear un ganador al azar y cerrar la rifa. No se puede deshacer."}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmar(false)} disabled={pend}
                  className="flex-1 rounded-full border border-campo py-2 text-[13px] font-bold text-gris">Cancelar</button>
                <button type="button" onClick={sortear} disabled={pend}
                  className="flex-1 rounded-full bg-[#1FA971] py-2 text-[13px] font-extrabold text-white disabled:opacity-60">
                  {pend ? "Sorteando…" : "Confirmar sorteo"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
