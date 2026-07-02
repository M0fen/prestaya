"use client";
// Bloque "Aureo ve hoy" — lo que el asesor detecta AUTOMÁTICAMENTE al abrir el
// panel, sin que nadie pregunte. Los insights se calculan en el servidor (núcleo
// puro `generarInsights`, gratis e instantáneo). Cada tarjeta con una pregunta
// sugerida abre el asesor IA flotante ya con la consulta (evento `aureo:preguntar`).
import type { Insight, TonoInsight } from "@/lib/insights";

const ESTILO: Record<TonoInsight, { borde: string; fondo: string; chip: string }> = {
  critico: { borde: "#F3C9C4", fondo: "#FDF3F2", chip: "#C0392B" },
  alerta: { borde: "#F4E2BE", fondo: "#FEF9EE", chip: "#B7791F" },
  bueno: { borde: "#C6E9D8", fondo: "#F1FBF6", chip: "#1FA971" },
  neutro: { borde: "#DCE3F4", fondo: "#F7F9FD", chip: "#4B5578" },
};

/** Pide al asesor flotante que se abra y consulte algo. */
export function preguntarAAureo(texto: string) {
  window.dispatchEvent(new CustomEvent("aureo:preguntar", { detail: texto }));
}

export function AureoInsights({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;

  return (
    <section className="rounded-[16px] border border-[#E6EAF4] bg-[linear-gradient(135deg,#0F1B3D,#1B2E5E)] p-5 text-white">
      <div className="mb-3.5 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,#2453DC,#13308C)] text-[18px]">
          💡
        </div>
        <div className="flex flex-col leading-tight">
          <h2 className="text-[15px] font-extrabold">Aureo ve hoy</h2>
          <span className="text-[11px] font-medium text-white/50">
            Señales automáticas sobre tus datos reales
          </span>
        </div>
      </div>

      <div className="grid gap-2.5 md:grid-cols-2">
        {insights.map((i) => {
          const c = ESTILO[i.tono];
          return (
            <div
              key={i.id}
              className="flex flex-col gap-1.5 rounded-[13px] p-3.5"
              style={{ background: c.fondo, border: `1px solid ${c.borde}` }}
            >
              <div className="flex items-start gap-2">
                <span className="text-[17px] leading-none">{i.icono}</span>
                <span className="text-[13.5px] font-extrabold text-tinta">{i.titulo}</span>
              </div>
              <p className="text-[12.5px] leading-relaxed font-medium text-gris">{i.detalle}</p>
              {i.pregunta && (
                <button
                  type="button"
                  onClick={() => preguntarAAureo(i.pregunta!)}
                  className="mt-0.5 self-start rounded-full px-2.5 py-1 text-[11.5px] font-bold text-white transition-opacity active:scale-95"
                  style={{ background: c.chip }}
                >
                  Preguntá a Aureo →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
