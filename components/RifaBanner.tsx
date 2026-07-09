"use client";
// Banner de RIFA en la vista del cliente. Muestra el mensaje del admin y un
// botón "Ver premio" que revela la foto del premio (+ su texto). Promocional.
import { useState } from "react";

export interface RifaVista {
  titulo: string;
  mensaje: string;
  premioTexto: string | null;
  botonTexto: string;
  fotoUrl: string | null;
}

export function RifaBanner({ rifa }: { rifa: RifaVista }) {
  const [abierto, setAbierto] = useState(false);
  const hayPremio = Boolean(rifa.fotoUrl || rifa.premioTexto);

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
      </div>
    </section>
  );
}
