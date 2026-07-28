// Historial de gastos RESUELTOS (aprobados/rechazados) — server component, colapsable
// con <details> nativo (sin JS). Recupera la evidencia anti-fraude que antes se perdía
// al resolver: comprobante, quién resolvió y cuándo, y el motivo de rechazo. Solo lectura.
import { UYU, horaDe, meses } from "@/lib/format";
import type { SolicitudGasto } from "@/lib/data/solicitudesGasto";

function cuando(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()} ${meses[d.getMonth()].slice(0, 3)} ${horaDe(iso)}`;
}

export function HistorialGastos({ resueltos }: { resueltos: SolicitudGasto[] }) {
  if (resueltos.length === 0) return null;

  const aprobados = resueltos.filter((s) => s.estado === "aprobada");
  const totalAprobado = aprobados.reduce((a, s) => a + s.monto, 0);

  return (
    <details className="group rounded-[16px] border border-borde bg-tarjeta">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-[13px] font-bold text-tinta [&::-webkit-details-marker]:hidden">
        <span>
          Historial de gastos resueltos
          <span className="ml-1.5 font-medium text-gris">({resueltos.length})</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[11.5px] font-medium text-gris">
            {aprobados.length} aprobados · {UYU(totalAprobado)}
          </span>
          <span className="text-gris transition-transform group-open:rotate-180" aria-hidden>
            ▾
          </span>
        </span>
      </summary>

      <ul className="flex flex-col divide-y divide-linea border-t border-linea">
        {resueltos.map((s) => {
          const aprobado = s.estado === "aprobada";
          return (
            <li key={s.id} className="flex items-start gap-3 px-4 py-3">
              <span
                className={`mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                  aprobado ? "bg-verde-suave text-verde-osc" : "bg-rojo-suave text-rojo-osc"
                }`}
              >
                {aprobado ? "Aprobado" : "Rechazado"}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-bold text-tinta">
                  {s.cobradorNombre ?? "Cobrador"}
                  <span className="ml-1.5 font-medium text-gris">
                    {s.categoria ?? "Gasto"}
                    {s.descripcion ? ` · ${s.descripcion}` : ""}
                  </span>
                </span>
                <span className="text-[11.5px] font-medium text-tenue">
                  {s.resueltoPorNombre ? `${aprobado ? "Aprobó" : "Rechazó"} ${s.resueltoPorNombre}` : ""} · {cuando(s.resueltoEn)}
                </span>
                {!aprobado && s.motivoRechazo && (
                  <span className="mt-0.5 text-[11.5px] font-medium text-rojo-osc">Motivo: {s.motivoRechazo}</span>
                )}
                {s.comprobanteUrl && (
                  <a
                    href={s.comprobanteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 w-fit text-[11.5px] font-bold text-azul hover:underline"
                  >
                    📎 Ver comprobante →
                  </a>
                )}
              </div>
              <span
                className={`flex-shrink-0 text-[14px] font-extrabold tabular-nums ${aprobado ? "text-rojo-osc" : "text-tenue line-through"}`}
              >
                {UYU(s.monto)}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
