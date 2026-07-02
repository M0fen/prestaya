// Barras horizontales de progreso — para el ranking de cobradores (recaudado
// vs esperado) u otras comparativas parte/total. HTML/CSS puro, con transición
// en el ancho para que “crezca” al cargar. Sin JS de cliente.
import { UYU } from "@/lib/format";

export interface BarraDato {
  nombre: string;
  valor: number;
  total: number;
  /** Nota a la derecha (p. ej. "3 cobrados · 2 pend."). */
  sub?: string;
  /** Marca de anomalía (pinta la barra en rojo). */
  alerta?: boolean;
}

interface Props {
  datos: BarraDato[];
  color?: string;
  colorAlerta?: string;
}

export function BarrasComparativas({
  datos,
  color = "#2453DC",
  colorAlerta = "#D64545",
}: Props) {
  if (datos.length === 0) {
    return (
      <p className="py-6 text-center text-[12.5px] font-medium text-[#AEB6CC]">
        Sin actividad de cobradores todavía hoy.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {datos.map((d) => {
        const pct = d.total > 0 ? Math.min(100, Math.round((d.valor / d.total) * 100)) : 0;
        const c = d.alerta ? colorAlerta : color;
        return (
          <div key={d.nombre} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[12.5px] font-bold text-tinta">
                {d.alerta && <span title="Anomalía detectada">⚠️ </span>}
                {d.nombre}
              </span>
              <span className="flex-shrink-0 text-[12px] font-semibold tabular-nums text-gris">
                {UYU(d.valor)}
                <span className="text-[#AEB6CC]"> / {UYU(d.total)}</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#EDF1F9]">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${c}, ${c}CC)` }}
              />
            </div>
            {d.sub && (
              <span className="text-[11px] font-medium text-[#8A93AD]">{d.sub}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
