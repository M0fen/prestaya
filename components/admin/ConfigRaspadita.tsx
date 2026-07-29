"use client";
// Cómo se GANA una raspadita (control del admin, 0097): gatillo + tope de
// acumuladas. El admin elige si se desbloquea por cada pago, por crédito
// renovado/completado, o solo con las que otorga a mano.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setConfigRaspaditaAction } from "@/lib/acciones/juego";

type Gatillo = "pago" | "renovacion" | "manual";

const OPCIONES: { id: Gatillo; titulo: string; desc: string; emoji: string }[] = [
  { id: "pago", emoji: "📅", titulo: "Por cada pago", desc: "Una raspadita por cada cuota que paga. Es el evento más frecuente." },
  { id: "renovacion", emoji: "🔄", titulo: "Por crédito renovado", desc: "Una por cada crédito que completa/renueva. Premio más especial y espaciado." },
  { id: "manual", emoji: "🎁", titulo: "Solo las que regalás", desc: "No se ganan solas: solo las que vos otorgás a un cliente a mano." },
];

export function ConfigRaspadita({
  gatilloInicial,
  topeInicial,
}: {
  gatilloInicial: Gatillo;
  topeInicial: number;
}) {
  const router = useRouter();
  const [gatillo, setGatillo] = useState<Gatillo>(gatilloInicial);
  const [tope, setTope] = useState(String(topeInicial));
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pend, start] = useTransition();

  const topeN = Math.max(0, Math.min(50, Math.round(Number(tope) || 0)));
  const cambiado = gatillo !== gatilloInicial || topeN !== topeInicial;

  const guardar = () => {
    setMsg(null); setErr(null);
    start(async () => {
      const r = await setConfigRaspaditaAction(gatillo, topeN);
      if (r.ok) { setMsg("Guardado ✓"); router.refresh(); }
      else setErr(r.error);
    });
  };

  return (
    <section className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] font-extrabold text-tinta">¿Cómo se gana una raspadita?</span>
        <span className="text-[12px] font-medium text-gris">
          Vos decidís cuándo un cliente desbloquea una raspadita. Cambialo cuando quieras.
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {OPCIONES.map((o) => {
          const sel = gatillo === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setGatillo(o.id)}
              className={`flex items-start gap-3 rounded-[12px] border p-3 text-left transition-colors ${
                sel ? "border-[#C7D2EC] bg-azul-suave" : "border-borde bg-suave hover:border-campo"
              }`}
            >
              <span className="text-[20px]" aria-hidden="true">{o.emoji}</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={`text-[13px] font-bold ${sel ? "text-azul" : "text-tinta"}`}>{o.titulo}</span>
                <span className="text-[11.5px] font-medium text-gris">{o.desc}</span>
              </span>
              <span
                className={`ml-auto mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border-2 ${
                  sel ? "border-azul bg-azul" : "border-campo"
                }`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      {gatillo !== "manual" && (
        <label className="flex items-center justify-between gap-3 rounded-[12px] border border-borde bg-suave px-3 py-2.5">
          <span className="flex flex-col">
            <span className="text-[12.5px] font-bold text-tinta">Tope de acumuladas</span>
            <span className="text-[11px] font-medium text-gris">Máximo sin jugar que se juntan (para que no acumulen decenas de golpe).</span>
          </span>
          <input
            inputMode="numeric"
            value={tope}
            onChange={(e) => setTope(e.target.value.replace(/[^\d]/g, ""))}
            className="w-14 rounded-[10px] border border-campo px-2.5 py-2 text-center text-[15px] font-bold tabular-nums text-tinta outline-none focus:border-azul"
            aria-label="Tope de raspaditas acumuladas"
          />
        </label>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={guardar}
          disabled={pend || !cambiado}
          className="rounded-full bg-[#7A4DD6] px-4 py-2 text-[13px] font-extrabold text-white active:scale-[0.98] disabled:opacity-40"
        >
          {pend ? "Guardando…" : "Guardar"}
        </button>
        {msg && <span className="text-[12px] font-bold text-verde">{msg}</span>}
        {err && <span className="text-[12px] font-semibold text-[#C0392B]">{err}</span>}
      </div>
    </section>
  );
}
