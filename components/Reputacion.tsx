// Reputación POSITIVA del cliente (anclaje de identidad — PNL). Solo se
// muestran cosas buenas: nunca "riesgo" ni "regular". Si no hay nada positivo
// que mostrar, no renderiza.
import type { Calificacion } from "@/types/db";

const ETIQUETA: Partial<Record<Calificacion, { texto: string; emoji: string }>> =
  {
    excelente: { texto: "Cliente excelente", emoji: "⭐" },
    bueno: { texto: "Buen pagador", emoji: "👍" },
  };

export function Reputacion({
  calificacion,
  creditosPagados,
}: {
  calificacion: Calificacion;
  creditosPagados: number;
}) {
  const cal = ETIQUETA[calificacion];
  if (!cal && creditosPagados <= 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-0.5">
      {cal && (
        <span className="flex items-center gap-1.5 rounded-full border border-[#DCE6FB] bg-[#EEF3FF] px-3 py-1 text-[12px] font-bold text-azul">
          <span aria-hidden="true">{cal.emoji}</span>
          {cal.texto}
        </span>
      )}
      {creditosPagados > 0 && (
        <span className="flex items-center gap-1.5 rounded-full border border-[#C7ECDA] bg-[#E7F6EF] px-3 py-1 text-[12px] font-bold text-[#157A50]">
          <span aria-hidden="true">🏆</span>
          {creditosPagados}{" "}
          {creditosPagados === 1
            ? "crédito completado"
            : "créditos completados"}
        </span>
      )}
    </div>
  );
}
