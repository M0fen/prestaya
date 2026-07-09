// Evolución del score en el tiempo (sparkline). Derivado puro del historial
// (lib/scoring → evolucionScore): recomputa el puntaje a cada mes. Sin datos
// guardados. Uso interno (gestores).
import { Sparkline } from "@/components/charts/Sparkline";
import type { PuntoEvolucion } from "@/lib/scoring";
import { meses } from "@/lib/format";

function etiquetaMes(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  // Fecha ilegible → "—": sin esto, meses[NaN] es undefined y .slice() rompe.
  if (isNaN(d.getTime())) return "—";
  return `${meses[d.getMonth()].slice(0, 3)} ${String(d.getFullYear()).slice(2)}`;
}

export function ScoreEvolucion({ serie }: { serie: PuntoEvolucion[] }) {
  if (serie.length < 2) {
    return (
      <div className="rounded-[14px] border border-borde bg-tarjeta p-4">
        <span className="text-[12px] font-bold text-tinta">Evolución del score</span>
        <p className="mt-1 text-[11.5px] font-medium text-gris">
          Todavía no hay suficiente historial para mostrar la evolución.
        </p>
      </div>
    );
  }

  const primero = serie[0];
  const ultimo = serie[serie.length - 1];
  const delta = ultimo.puntaje - primero.puntaje;
  const sube = delta >= 0;
  const color = sube ? "#1FA971" : "#D64545";

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-borde bg-tarjeta p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold text-tinta">Evolución del score</span>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
          style={{ background: sube ? "#E4F5EC" : "#FBE4E2", color }}
        >
          {sube ? "▲ +" : "▼ "}
          {delta} pts
        </span>
      </div>

      <Sparkline valores={serie.map((p) => p.puntaje)} color={color} alto={44} />

      <div className="flex items-center justify-between text-[11px] font-medium text-tenue tabular-nums">
        <span>
          {etiquetaMes(primero.fecha)} · {primero.puntaje}
        </span>
        <span className="font-bold text-tinta">
          {etiquetaMes(ultimo.fecha)} · {ultimo.puntaje}/1000
        </span>
      </div>
    </div>
  );
}
