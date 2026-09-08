// Barras por día para el panel del piloto (una serie, sin leyenda: el título la
// nombra). Marcas finas, 2 px de aire entre barras, domingos tenues, tooltip
// nativo por barra y las dos cifras que importan a la derecha. Sin librería:
// es un flex de divs que se renderiza en el servidor.
import { esDomingo, etiquetaDia, resumenSerie, type PuntoDia } from "@/lib/piloto/series";

export function BarrasDias({
  titulo,
  serie,
  formato,
  color = "var(--color-azul)",
  alto = 64,
  nota,
}: {
  titulo: string;
  serie: PuntoDia[];
  formato: (n: number) => string;
  color?: string;
  alto?: number;
  nota?: string;
}) {
  const { total, promedioHabil, max } = resumenSerie(serie);
  const hoy = serie[serie.length - 1];
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-borde bg-tarjeta p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-bold text-gris">{titulo}</span>
        <span className="text-[11px] font-medium text-tenue tabular-nums">
          hoy <b className="text-tinta">{formato(hoy?.valor ?? 0)}</b> · prom. hábil {formato(Math.round(promedioHabil))}
        </span>
      </div>
      <div className="flex items-end gap-[2px]" style={{ height: alto }} role="img" aria-label={`${titulo}: ${serie.map((p) => `${etiquetaDia(p.dia)} ${formato(p.valor)}`).join(", ")}`}>
        {serie.map((p, i) => {
          const h = max > 0 ? Math.max(p.valor > 0 ? 3 : 1, Math.round((p.valor / max) * alto)) : 1;
          const dom = esDomingo(p.dia);
          const ultimo = i === serie.length - 1;
          return (
            <div key={p.dia} className="group relative flex h-full flex-1 items-end" title={`${etiquetaDia(p.dia)}: ${formato(p.valor)}`}>
              <div
                className="w-full rounded-t-[4px]"
                style={{
                  height: h,
                  background: color,
                  opacity: dom ? 0.25 : ultimo ? 1 : 0.7,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] font-medium text-tenue-2 tabular-nums">
        <span>{serie[0] ? etiquetaDia(serie[0].dia) : ""}</span>
        <span>total {formato(total)}</span>
        <span>{hoy ? etiquetaDia(hoy.dia) : ""}</span>
      </div>
      {nota && <span className="text-[10.5px] font-medium text-tenue-2">{nota}</span>}
    </div>
  );
}
