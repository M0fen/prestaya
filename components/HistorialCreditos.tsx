// ─────────────────────────────────────────────────────────────────────────
//  HISTORIAL DE CRÉDITOS del cliente — la misma vista en la oficina y en la calle.
//
//  Responde las preguntas que se hacen antes de volver a prestarle:
//    · ¿cuántas veces ya renovó? (la cadena, con su número de vuelta)
//    · ¿este vino de una renovación o fue una venta nueva? ¿quién se lo colocó?
//    · ¿pagó bien? — un crédito de 35 días pagado en 155 se ve IDÉNTICO a uno
//      perfecto si no se mira el tiempo real. Acá se mira.
//
//  Todo es DERIVADO (lib/data/ficha.ts): nada de esto se guarda en la base.
// ─────────────────────────────────────────────────────────────────────────
import { UYU } from "@/lib/format";
import type { CreditoFicha } from "@/lib/data/ficha";

const ETIQUETA: Record<CreditoFicha["tipo"], { texto: string; bg: string; fg: string }> = {
  renovacion: { texto: "🔁 Renovación", bg: "#EDE7FB", fg: "#6D4AC7" },
  venta: { texto: "💵 Venta nueva", bg: "#E4F5EC", fg: "#157A50" },
  tienda: { texto: "🛒 Tienda", bg: "#E7ECFF", fg: "#13308C" },
  importado: { texto: "📄 De Disapp", bg: "#EEF1F8", fg: "#6B7494" },
};

const ESTADO: Record<string, { texto: string; bg: string; fg: string }> = {
  activo: { texto: "En curso", bg: "#FDF3E2", fg: "#8A6D1E" },
  finalizado: { texto: "Pagado ✓", bg: "#E4F5EC", fg: "#157A50" },
  refinanciado: { texto: "Renovado", bg: "#EDE7FB", fg: "#6D4AC7" },
};

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split("-");
  return d && m ? `${d}/${m}/${String(y).slice(2)}` : s;
}

export function HistorialCreditos({
  creditos,
  titulo = "Historial de créditos",
}: {
  creditos: CreditoFicha[];
  titulo?: string;
}) {
  if (creditos.length === 0) {
    return (
      <section className="rounded-[16px] border border-borde bg-white p-4">
        <span className="text-[13px] font-extrabold text-tinta">{titulo}</span>
        <p className="mt-2 text-[12.5px] font-medium text-gris">
          Todavía no tiene créditos registrados.
        </p>
      </section>
    );
  }

  // Cuántos terminó de pagar y cuánto capital se le colocó en total: el resumen
  // que contesta "¿este cliente ya devolvió plata o es su primera vez?".
  const pagados = creditos.filter((c) => c.estado !== "activo").length;
  const colocadoTotal = creditos.reduce((s, c) => s + c.monto, 0);

  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-extrabold text-tinta">{titulo}</span>
        <span className="text-[11.5px] font-semibold text-gris tabular-nums">
          {creditos.length} en total · {pagados} pagado{pagados === 1 ? "" : "s"}
        </span>
      </div>
      <span className="text-[11.5px] font-medium text-gris tabular-nums">
        Se le colocaron {UYU(colocadoTotal)} a lo largo del tiempo.
      </span>

      <ul className="flex flex-col gap-2">
        {creditos.map((c) => {
          const et = ETIQUETA[c.tipo];
          const es = ESTADO[c.estado] ?? { texto: c.estado, bg: "#EEF1F8", fg: "#6B7494" };
          // ¿Tardó de más? Se compara contra el plazo que le tocaba, no contra un
          // número fijo: un semanal de 4 cuotas son 28 días, un diario de 30 son 35.
          const tardo =
            c.diasReales != null && c.diasDePlazo != null && c.diasReales > c.diasDePlazo * 1.25;
          const alDia = c.diasReales != null && c.diasDePlazo != null && !tardo;
          return (
            <li key={c.id} className="flex flex-col gap-1.5 rounded-[12px] bg-suave p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-[14px] font-extrabold text-tinta tabular-nums">
                    {UYU(c.monto)}
                    <span className="font-semibold text-gris">
                      {" · "}cuota {UYU(c.cuota)} × {c.totalDias}
                    </span>
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background: et.bg, color: et.fg }}
                    >
                      {et.texto}
                    </span>
                    {c.vueltaNro > 1 && (
                      <span className="rounded-full bg-[#EEF3FF] px-2 py-0.5 text-[10px] font-bold text-[#1E47C8]">
                        {c.vueltaNro}ª vuelta
                      </span>
                    )}
                    {c.productoNombre && (
                      <span className="truncate text-[10.5px] font-semibold text-gris">
                        {c.productoNombre}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold"
                  style={{ background: es.bg, color: es.fg }}
                >
                  {es.texto}
                </span>
              </div>

              <span className="text-[11.5px] leading-[1.45] font-medium text-gris tabular-nums">
                Empezó {fechaCorta(c.fechaInicio)}
                {c.finalizadoEn ? ` · terminó ${fechaCorta(c.finalizadoEn)}` : ""}
                {" · pagó "}
                {UYU(c.pagadoTotal)} de {UYU(c.totalAPagar)}
                {c.colocadoPor ? ` · lo dio ${c.colocadoPor}` : ""}
              </span>

              {/* CÓMO pagó: el dato que decide si conviene volver a prestarle. */}
              {tardo && (
                <span className="rounded-[9px] bg-[#FDF3E2] px-2.5 py-1.5 text-[11.5px] leading-[1.4] font-bold text-[#8A6D1E] tabular-nums">
                  ⏳ Lo pagó en {c.diasReales} días · le tocaban {c.diasDePlazo}
                </span>
              )}
              {alDia && (
                <span className="text-[11.5px] font-bold text-[#157A50] tabular-nums">
                  👌 Pagó en {c.diasReales} días · le tocaban {c.diasDePlazo}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
