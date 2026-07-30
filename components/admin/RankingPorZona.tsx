// "Cobradores hoy" AGRUPADO por zona → supervisor (En vivo de Mi jornada). Antes
// era una tira plana de 52 barras ("se pierde cargando toda esa info"); ahora
// secciones colapsables por zona con subtotal recaudado/meta, cada una con su
// supervisor en el encabezado. Presentacional (server-safe).
import { BarrasComparativas } from "@/components/charts/BarrasComparativas";
import { UYU } from "@/lib/format";
import type { RankingCobrador } from "@/lib/data/control";

const SIN_ZONA = "__sin_zona__";

export function RankingPorZona({
  ranking,
  zonaNombre,
  supervisoresPorZona = {},
}: {
  ranking: RankingCobrador[];
  zonaNombre: Record<string, string>;
  supervisoresPorZona?: Record<string, string[]>;
}) {
  const map = new Map<
    string,
    { clave: string; nombre: string; sups: string[]; filas: RankingCobrador[]; rec: number; esp: number }
  >();
  for (const c of ranking) {
    const clave = c.zonaId ?? SIN_ZONA;
    let g = map.get(clave);
    if (!g) {
      g = {
        clave,
        nombre: c.zonaId ? (zonaNombre[c.zonaId] ?? "Zona") : "Sin zona (interior)",
        sups: c.zonaId ? (supervisoresPorZona[c.zonaId] ?? []) : [],
        filas: [],
        rec: 0,
        esp: 0,
      };
      map.set(clave, g);
    }
    g.filas.push(c);
    g.rec += c.recaudado;
    g.esp += c.esperado;
  }
  const grupos = [...map.values()].sort((a, b) => b.rec - a.rec); // el que más recaudó, arriba
  for (const g of grupos) g.filas.sort((a, b) => b.recaudado - a.recaudado);

  return (
    <div className="flex flex-col gap-2">
      {grupos.map((g) => {
        const pct = g.esp > 0 ? Math.round((g.rec / g.esp) * 100) : 0;
        return (
          <details key={g.clave} open className="group rounded-[12px] border border-linea">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[12px] bg-suave px-3 py-2 select-none">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[12.5px] font-extrabold text-tinta">📍 {g.nombre}</span>
                <span className="truncate text-[10.5px] font-medium text-tenue">
                  {g.sups.length ? `Sup: ${g.sups.join(", ")}` : "Sin supervisor"} · {g.filas.length} cobr.
                </span>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-[12px] font-black tabular-nums text-tinta">
                  {UYU(g.rec)}
                  <span className="font-medium text-gris"> / {UYU(g.esp)} · {pct}%</span>
                </span>
                <span aria-hidden className="text-[10px] text-gris transition-transform group-open:rotate-90">▶</span>
              </div>
            </summary>
            <div className="px-3 py-2">
              <BarrasComparativas
                datos={g.filas.map((c) => ({
                  nombre: c.nombre,
                  valor: c.recaudado,
                  total: c.esperado,
                  sub: `${Math.round(c.progreso * 100)}% de la ruta${c.anomalias > 0 ? ` · ${c.anomalias} anomalía(s)` : ""}`,
                  alerta: c.anomalias > 0,
                }))}
              />
            </div>
          </details>
        );
      })}
    </div>
  );
}
