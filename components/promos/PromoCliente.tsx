"use client";
// Juegos PROMOCIONALES en la vista de cliente: raspadita + quiniela.
// ⚠️ Sin dinero real: premios = beneficios simbólicos. El resultado de la
// raspadita lo decide el SERVIDOR (jugarRaspadita); acá solo se revela.
// Quiniela: el número es ASIGNADO (los últimos 3 dígitos del número de registro).
// El cliente NO elige; participa solo por estar al día.
import { useEffect, useState } from "react";
import { participarQuiniela } from "@/app/c/[token]/actions";
import { RaspaditaCanvas } from "@/components/promos/RaspaditaCanvas";
import { formatearSuerte } from "@/lib/quiniela";

export interface PromoData {
  raspaDisponibles: number;
  quiniela: {
    id: string;
    titulo: string;
    premioTexto: string;
    /** Número de la suerte asignado (últimos 3 del registro); null si no tiene. */
    miNumero: number | null;
    /** Está al día (sin días atrasados) → participa. */
    alDia: boolean;
    /** Ya quedó registrado en el sorteo. */
    participando: boolean;
  } | null;
}

export function PromoCliente({ promo, token = null }: { promo: PromoData; token?: string | null }) {
  const hayRaspa = promo.raspaDisponibles > 0;
  const hayQuiniela = Boolean(promo.quiniela);
  if (!hayRaspa && !hayQuiniela) return null;

  return (
    <section className="flex flex-col gap-3">
      <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
        Juegos y sorteos
      </span>
      {hayRaspa && <RaspaditaCanvas token={token} disponibles={promo.raspaDisponibles} />}
      {promo.quiniela && <Quiniela token={token} q={promo.quiniela} />}
      <p className="text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
        Juegos promocionales, sin dinero: los premios son beneficios de tu crédito. 🎁
      </p>
    </section>
  );
}

function Quiniela({
  token,
  q,
}: {
  token: string | null;
  q: {
    id: string;
    titulo: string;
    premioTexto: string;
    miNumero: number | null;
    alDia: boolean;
    participando: boolean;
  };
}) {
  const [enSorteo, setEnSorteo] = useState(q.participando);

  // Auto-participación: si está al día, tiene número y aún no está registrado,
  // lo inscribimos solo (una vez). El número es ASIGNADO; el cliente no elige.
  useEffect(() => {
    if (!q.alDia || q.miNumero == null || q.participando) return;
    if (!token) {
      setEnSorteo(true); // demo (sin token): simula, no escribe nada
      return;
    }
    let vivo = true;
    participarQuiniela({ token }).then((r) => {
      if (vivo && r.ok) setEnSorteo(true);
    });
    return () => {
      vivo = false;
    };
  }, [token, q.alDia, q.miNumero, q.participando]);

  const numeroTxt = formatearSuerte(q.miNumero);

  return (
    <div className="rounded-[18px] border border-[#DCE3F4] bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[18px]">🍀</span>
        <span className="text-[15px] font-extrabold text-tinta">{q.titulo}</span>
      </div>
      <p className="mb-3 text-[12.5px] font-medium text-gris">Premio: {q.premioTexto}</p>

      {q.miNumero == null ? (
        <div className="rounded-[12px] bg-[#F4F7FE] px-3 py-3 text-center text-[12.5px] font-medium text-gris">
          Tu número de la suerte se asigna con tu crédito. ¡Muy pronto! 🍀
        </div>
      ) : (
        <>
          {/* El número de la suerte: grande y ASIGNADO (no se elige). */}
          <div className="flex flex-col items-center gap-1 rounded-[14px] bg-[linear-gradient(135deg,#EEF3FF,#E4ECFF)] px-4 py-3">
            <span className="text-[11px] font-bold tracking-[0.09em] text-[#1E47C8] uppercase">
              Este es tu número de la suerte
            </span>
            <span className="text-[38px] leading-none font-black tracking-[0.08em] text-[#13308C] tabular-nums">
              {numeroTxt}
            </span>
          </div>

          {q.alDia || enSorteo ? (
            <div className="mt-2.5 rounded-[12px] bg-[#E7F7EF] px-3 py-2.5 text-center text-[13px] font-bold text-[#157A50]">
              ✓ Estás en el sorteo. ¡Mucha suerte! 🍀
            </div>
          ) : (
            <div className="mt-2.5 rounded-[12px] bg-[#FFF7E8] px-3 py-2.5 text-center text-[12.5px] font-semibold text-[#96610b]">
              Ponete al día y tu <b>{numeroTxt}</b> entra al sorteo. 💙
            </div>
          )}
        </>
      )}

      <p className="mt-2 text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
        Tu número son los últimos 3 dígitos de tu número de registro. Participás por estar al día.
      </p>
    </div>
  );
}
