"use client";
// Banner de RIFA en la vista del cliente. Muestra el mensaje del admin, revela la
// foto del premio, y —si es un SORTEO abierto y hay token— deja PARTICIPAR (recibe
// un número de ticket). Promocional, sin dinero.
import { useState, useTransition } from "react";
import { participarRifa } from "@/app/c/[token]/actions";

export interface RifaVista {
  titulo: string;
  mensaje: string;
  premioTexto: string | null;
  botonTexto: string;
  fotoUrl: string | null;
  /** Ciclo de sorteo (0098). Solo la vista real del cliente los pasa. */
  estado?: "abierta" | "cerrada";
  /** El número de ticket del cliente si YA participa (o null). */
  miNumero?: number | null;
}

export function RifaBanner({ rifa, token = null }: { rifa: RifaVista; token?: string | null }) {
  const [abierto, setAbierto] = useState(false);
  const [numero, setNumero] = useState<number | null>(rifa.miNumero ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [pend, start] = useTransition();
  const hayPremio = Boolean(rifa.fotoUrl || rifa.premioTexto);
  // Sorteo activo: hay token (vista real), la rifa está abierta y sabemos el estado.
  const esSorteo = !!token && rifa.estado === "abierta";
  const cerrada = rifa.estado === "cerrada";

  const participar = () => {
    if (!token) return;
    setErr(null);
    start(async () => {
      const r = await participarRifa({ token });
      if (r.ok) setNumero(r.numero);
      else setErr(r.error);
    });
  };

  return (
    <section className="overflow-hidden rounded-[18px] bg-[linear-gradient(135deg,#7A4DD6,#2453DC)] text-white shadow-[0_10px_24px_rgba(36,83,220,0.28)]">
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span className="text-[18px]" aria-hidden>🎁</span>
          <span className="text-[15px] font-extrabold tracking-[-0.01em]">{rifa.titulo}</span>
        </div>
        {rifa.mensaje && (
          <p className="text-[13px] leading-[1.5] font-medium text-white/90">{rifa.mensaje}</p>
        )}

        {hayPremio && (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            className="mt-1 w-fit rounded-full bg-white/95 px-4 py-2 text-[13px] font-extrabold text-[#2453DC] active:scale-[0.98]"
            style={{ transition: "transform .1s" }}
          >
            {abierto ? "Ocultar premio" : `${rifa.botonTexto} →`}
          </button>
        )}

        {abierto && hayPremio && (
          <div className="mt-1 flex flex-col gap-2 rounded-[14px] bg-white/10 p-2">
            {rifa.fotoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={rifa.fotoUrl}
                alt={rifa.premioTexto ?? "Premio de la rifa"}
                className="w-full rounded-[10px] object-cover"
              />
            )}
            {rifa.premioTexto && (
              <p className="px-1 pb-1 text-[13px] font-bold text-white">{rifa.premioTexto}</p>
            )}
          </div>
        )}

        {/* Participación en el sorteo (solo vista real del cliente) */}
        {esSorteo && (
          numero != null ? (
            <div className="mt-1 flex items-center gap-2 rounded-[12px] bg-white/15 px-3 py-2">
              <span className="text-[16px]" aria-hidden>🎟️</span>
              <span className="text-[12.5px] font-semibold text-white/90">
                ¡Estás participando! Tu número es <b className="tabular-nums">{String(numero).padStart(3, "0")}</b>
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={participar}
              disabled={pend}
              className="mt-1 w-fit rounded-full bg-white px-4 py-2 text-[13px] font-extrabold text-[#5B2FC0] active:scale-[0.98] disabled:opacity-70"
            >
              {pend ? "Entrando…" : "🎟️ Participar en la rifa"}
            </button>
          )
        )}
        {cerrada && !!token && (
          <p className="mt-1 text-[12px] font-medium text-white/80">La rifa ya se cerró. ¡Atento a la próxima! 🍀</p>
        )}
        {err && <p className="mt-1 text-[12px] font-semibold text-[#FFD9D9]">{err}</p>}
      </div>
    </section>
  );
}
