// Resultados de la RASPADITA para el admin: cuántas se jugaron, qué premios
// cayeron y el historial reciente con nombre del cliente + folio verificable.
// Antes el admin estaba CIEGO (el dato existía en `raspaditas_jugadas` pero no se
// mostraba en ningún lado). Solo lectura; server component.
import type { ResumenRaspaditas } from "@/lib/data/promos";

function fechaHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function RaspaditaResultados({ resumen }: { resumen: ResumenRaspaditas }) {
  const { totalJugadas, beneficios, nada, porPremio, recientes } = resumen;
  const tasa = totalJugadas > 0 ? Math.round((beneficios / totalJugadas) * 100) : 0;

  return (
    <section className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] font-extrabold text-tinta">Resultados de la raspadita</span>
        <span className="text-[12px] font-medium text-gris">
          Todo lo jugado, qué premios cayeron y el historial (con folio verificable).
        </span>
      </div>

      {totalJugadas === 0 ? (
        <p className="rounded-[12px] bg-suave px-3.5 py-4 text-center text-[12.5px] font-medium text-gris">
          Todavía no se jugó ninguna raspadita. Cuando tus clientes jueguen, vas a ver acá el detalle.
        </p>
      ) : (
        <>
          {/* Totales */}
          <div className="grid grid-cols-3 gap-2.5">
            <Tarjeta k="Jugadas" v={totalJugadas.toLocaleString("es-UY")} sub="en total" />
            <Tarjeta k="Ganaron" v={beneficios.toLocaleString("es-UY")} sub={`${tasa}% de las jugadas`} tono="verde" />
            <Tarjeta k="Sin premio" v={nada.toLocaleString("es-UY")} sub="“seguí participando”" />
          </div>

          {/* Qué premios cayeron */}
          {porPremio.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-bold uppercase tracking-[0.03em] text-gris">Qué premios cayeron</span>
              <div className="flex flex-col divide-y divide-linea overflow-hidden rounded-[12px] border border-borde">
                {porPremio.map((p) => (
                  <div key={`${p.tipo}|${p.label}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span aria-hidden="true">{p.tipo === "beneficio" ? "🎉" : "🍀"}</span>
                      <span className="truncate text-[12.5px] font-semibold text-tinta">{p.label}</span>
                    </span>
                    <span className="flex-shrink-0 rounded-full bg-suave px-2.5 py-0.5 text-[11.5px] font-bold tabular-nums text-cuerpo">
                      {p.cantidad.toLocaleString("es-UY")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Historial reciente (con folio verificable) */}
          {recientes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-bold uppercase tracking-[0.03em] text-gris">
                Historial reciente ({recientes.length})
              </span>
              <div className="flex flex-col divide-y divide-linea overflow-hidden rounded-[12px] border border-borde">
                {recientes.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[12.5px] font-bold text-tinta">{r.clienteNombre}</span>
                      <span className="text-[11px] font-medium text-tenue">
                        {r.premioTipo === "beneficio" ? "🎉 " : "🍀 "}
                        {r.premioLabel} · {fechaHora(r.jugadoEn)}
                      </span>
                    </div>
                    {r.folio != null && (
                      <span
                        className="flex-shrink-0 rounded-full bg-azul-suave px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-azul"
                        title="Folio verificable del premio"
                      >
                        N.º {String(r.folio).padStart(6, "0")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Tarjeta({ k, v, sub, tono }: { k: string; v: string; sub: string; tono?: "verde" }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] border border-borde bg-suave p-3">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-gris">{k}</span>
      <span className={`text-[18px] font-extrabold tabular-nums ${tono === "verde" ? "text-verde" : "text-tinta"}`}>{v}</span>
      <span className="text-[10.5px] font-medium text-tenue">{sub}</span>
    </div>
  );
}
