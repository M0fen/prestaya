// Gráfico de columnas (barras verticales) con HTML/CSS puro — ideal para la
// serie de recaudo diario. Cada columna tiene tooltip nativo (title) y una
// transición suave al pasar el mouse. Resalta el día de hoy. Sin JS de cliente.
import { UYU } from "@/lib/format";

export interface DatoColumna {
  etiqueta: string;
  valor: number;
  esHoy?: boolean;
  /** Texto del tooltip; por defecto etiqueta + monto. */
  tooltip?: string;
}

interface Props {
  datos: DatoColumna[];
  color?: string;
  colorHoy?: string;
  /** Alto del área de barras en px. */
  alto?: number;
}

export function Columnas({
  datos,
  color = "#2453DC",
  colorHoy = "#1FA971",
  alto = 132,
}: Props) {
  const max = Math.max(...datos.map((d) => d.valor), 1);
  // Muestra etiqueta en ~6 marcas para no amontonar en 14+ columnas.
  const cada = Math.ceil(datos.length / 7);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-[3px]" style={{ height: alto }}>
        {datos.map((d, i) => {
          const h = Math.max(2, Math.round((d.valor / max) * (alto - 4)));
          return (
            <div key={d.etiqueta + i} className="group flex flex-1 items-end justify-center" style={{ height: alto }}>
              <div
                title={d.tooltip ?? `${d.etiqueta}: ${UYU(d.valor)}`}
                className="w-full max-w-[26px] rounded-t-[4px] transition-[height,opacity] duration-300 group-hover:opacity-80"
                style={{
                  height: h,
                  background: d.esHoy
                    ? colorHoy
                    : `linear-gradient(180deg, ${color}, ${color}CC)`,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px]">
        {datos.map((d, i) => (
          <div key={d.etiqueta + i} className="flex-1 text-center">
            {i % cada === 0 || d.esHoy ? (
              <span
                className={`text-[9.5px] font-semibold whitespace-nowrap ${
                  d.esHoy ? "text-verde" : "text-[#AEB6CC]"
                }`}
              >
                {d.esHoy ? "hoy" : d.etiqueta}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
