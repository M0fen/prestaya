// Rendiciones de jornada del día (vista gestor, dentro de Caja). Muestra quién
// ya rindió (entregado vs esperado + diferencia) y quién recaudó pero todavía no
// rindió. El faltante total es la señal anti-fuga del día.
import { UYU } from "@/lib/format";
import { ETIQUETA_ESTADO, type EstadoRendicion } from "@/lib/rendicion";
import type { ResumenRendiciones } from "@/lib/data/rendicion";

const TONO: Record<EstadoRendicion, { bg: string; fg: string }> = {
  cuadra: { bg: "#E4F5EC", fg: "#157A50" },
  faltante: { bg: "#FBE4E2", fg: "#C0392B" },
  sobrante: { bg: "#FDF3E2", fg: "#B9770E" },
};

export function RendicionesDia({ r }: { r: ResumenRendiciones }) {
  if (!r.disponible) {
    return (
      <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
        <span className="text-[13px] font-bold text-tinta">Rendiciones de jornada</span>
        <p className="mt-1.5 text-[12.5px] font-medium text-gris">
          Para habilitar el cierre de jornada del cobrador, corré la migración{" "}
          <code className="rounded bg-[#F0F3FA] px-1 font-mono text-[11.5px]">0013_rendiciones.sql</code>.
        </p>
      </section>
    );
  }

  if (r.rendidas.length === 0 && r.pendientes.length === 0) return null;

  return (
    <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[13px] font-bold text-tinta">Rendiciones de jornada</span>
        {r.totalFaltante > 0 && (
          <span className="rounded-full bg-[#FBE4E2] px-2.5 py-0.5 text-[11.5px] font-bold text-[#C0392B]">
            Faltante {UYU(r.totalFaltante)}
          </span>
        )}
      </div>

      {/* Rendidas */}
      {r.rendidas.length > 0 && (
        <ul className="flex flex-col divide-y divide-[#EEF1F8]">
          {r.rendidas.map((x) => {
            const t = TONO[x.estado];
            return (
              <li key={x.id} className="flex items-center justify-between gap-2 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-semibold text-tinta">{x.cobradorNombre}</span>
                  <span className="text-[11px] font-medium text-[#8A93AD]">
                    entregó {UYU(x.entregado)} · esperado {UYU(x.recaudado - x.gastos)}
                    {x.gastos > 0 ? ` · gastos ${UYU(x.gastos)}` : ""}
                  </span>
                </div>
                <span
                  className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold"
                  style={{ background: t.bg, color: t.fg }}
                >
                  {x.estado === "cuadra"
                    ? ETIQUETA_ESTADO.cuadra
                    : `${x.diferencia < 0 ? "−" : "+"}${UYU(Math.abs(x.diferencia))}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Pendientes de rendir */}
      {r.pendientes.length > 0 && (
        <div className="mt-2 border-t border-[#EEF1F8] pt-2">
          <span className="text-[11px] font-bold tracking-wide text-[#8A93AD] uppercase">Falta rendir</span>
          <ul className="mt-1 flex flex-col divide-y divide-[#EEF1F8]">
            {r.pendientes.map((p) => (
              <li key={p.cobradorId} className="flex items-center justify-between py-1.5">
                <span className="text-[13px] font-semibold text-tinta">{p.nombre}</span>
                <span className="text-[12px] font-medium text-gris">
                  recaudó {UYU(p.recaudado)} · {p.cobros} cobro{p.cobros === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
