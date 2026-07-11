"use client";
// "Aureo ve hoy" — la guía del día, REAL (IA), a medida del gestor y su zona.
// Se pide async (no frena el dashboard): muestra un skeleton mientras Aureo
// "estudia", y luego su guía. Degrada a reglas si no hay IA. Botón para abrir
// el asesor y profundizar.
import { useEffect, useState } from "react";

type Guia = { guia: string; tono: "critico" | "alerta" | "bueno" | "neutro"; fuente: "aureo" | "reglas" };

const ACENTO: Record<Guia["tono"], string> = {
  critico: "#C0392B",
  alerta: "#B9770E",
  bueno: "#157A50",
  neutro: "#1E47C8",
};

export function GuiaAureo() {
  const [guia, setGuia] = useState<Guia | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/aureo-guia")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Guia) => vivo && setGuia(d))
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, []);

  const acento = guia ? ACENTO[guia.tono] : "#1E47C8";

  return (
    <section
      className="overflow-hidden rounded-[16px] border border-borde bg-tarjeta"
      style={{ boxShadow: "0 1px 3px rgba(26,34,71,0.05)" }}
    >
      <div className="flex items-start gap-3 p-4" style={{ borderLeft: `4px solid ${acento}` }}>
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] text-[20px]"
          style={{ background: `${acento}18` }}
        >
          🧭
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-extrabold text-tinta">Aureo ve hoy</span>
            {guia && (
              <span
                className="rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                style={{ background: `${acento}18`, color: acento }}
              >
                {guia.fuente === "aureo" ? "IA · tu zona" : "resumen"}
              </span>
            )}
          </div>

          {!guia && !error && (
            <div className="mt-1 flex flex-col gap-1.5" aria-label="Aureo está estudiando tu zona…">
              <span className="h-2.5 w-[92%] animate-pulse rounded-full bg-suave" />
              <span className="h-2.5 w-[78%] animate-pulse rounded-full bg-suave" />
              <span className="h-2.5 w-[60%] animate-pulse rounded-full bg-suave" />
              <span className="mt-0.5 text-[11px] font-medium text-tenue">Aureo está estudiando tu zona…</span>
            </div>
          )}

          {error && (
            <p className="text-[12.5px] font-medium text-gris">
              No pude armar la guía ahora. Abrí el asesor para consultarlo.
            </p>
          )}

          {guia && (
            <>
              <p className="text-[13px] leading-relaxed font-medium text-cuerpo whitespace-pre-line">{guia.guia}</p>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("aureo:preguntar", { detail: "Profundizá la guía del día: ¿por dónde arranco y qué priorizo?" }),
                  )
                }
                className="mt-1 self-start text-[12px] font-bold"
                style={{ color: acento }}
              >
                Profundizar con Aureo →
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
