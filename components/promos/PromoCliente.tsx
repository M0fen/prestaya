"use client";
// Juegos PROMOCIONALES en la vista de cliente: raspadita + quiniela.
// ⚠️ Sin dinero real: premios = beneficios simbólicos. El resultado de la
// raspadita lo decide el SERVIDOR (jugarRaspadita); acá solo se revela.
import { useState } from "react";
import { participarQuiniela } from "@/app/c/[token]/actions";
import { RaspaditaCanvas } from "@/components/promos/RaspaditaCanvas";

export interface PromoData {
  raspaDisponibles: number;
  quiniela: { id: string; titulo: string; premioTexto: string; rangoMin: number; rangoMax: number } | null;
  participacionNumero: number | null;
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
      {promo.quiniela && (
        <Quiniela token={token} q={promo.quiniela} miNumero={promo.participacionNumero} />
      )}
      <p className="text-[10px] leading-[1.5] font-medium text-[#AEB6CC]">
        Juegos promocionales, sin dinero: los premios son beneficios de tu crédito. 🎁
      </p>
    </section>
  );
}

function Quiniela({
  token,
  q,
  miNumero,
}: {
  token: string | null;
  q: { id: string; titulo: string; premioTexto: string; rangoMin: number; rangoMax: number };
  miNumero: number | null;
}) {
  const [numero, setNumero] = useState<number>(miNumero ?? q.rangoMin);
  const [estado, setEstado] = useState<"idle" | "enviando" | "ok" | "error">(
    miNumero != null ? "ok" : "idle",
  );
  const [error, setError] = useState("");
  const yaJugo = miNumero != null || estado === "ok";

  const participar = async () => {
    setEstado("enviando");
    setError("");
    if (!token) {
      // Vista demo (sin token): confirma localmente, sin escribir nada.
      setEstado("ok");
      return;
    }
    const r = await participarQuiniela({ token, numero });
    if (r.ok) setEstado("ok");
    else {
      setError(r.error);
      setEstado("error");
    }
  };

  return (
    <div className="rounded-[18px] border border-[#DCE3F4] bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[18px]">🍀</span>
        <span className="text-[15px] font-extrabold text-tinta">{q.titulo}</span>
      </div>
      <p className="mb-3 text-[12.5px] font-medium text-gris">Premio: {q.premioTexto}</p>

      {yaJugo ? (
        <div className="rounded-[12px] bg-[#E7F7EF] px-3 py-2.5 text-[13px] font-bold text-[#157A50]">
          ✓ Estás participando con el número <b>{numero}</b>. ¡Suerte!
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={q.rangoMin}
            max={q.rangoMax}
            value={numero}
            onChange={(e) => setNumero(Number(e.target.value))}
            className="w-24 rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-center text-[16px] font-extrabold text-tinta outline-none focus:border-azul tabular-nums"
          />
          <button
            type="button"
            onClick={participar}
            disabled={estado === "enviando"}
            className="flex-1 rounded-full bg-azul px-4 py-2.5 text-[14px] font-extrabold text-white active:scale-[0.98] disabled:opacity-60"
          >
            {estado === "enviando" ? "Enviando…" : "Elegir número"}
          </button>
        </div>
      )}
      {estado === "error" && <p className="mt-2 text-[12px] font-semibold text-[#D64545]">{error}</p>}
      <p className="mt-2 text-[11px] font-medium text-[#AEB6CC]">
        Participás por estar al día. Números del {q.rangoMin} al {q.rangoMax}.
      </p>
    </div>
  );
}
