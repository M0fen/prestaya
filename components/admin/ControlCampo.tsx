// Control de campo (admin): por cada cobrador, su score de sospecha del día +
// las señales (planchado, fuera de zona, sin moverse, GPS apagado) + la lista de
// acciones con hora, cliente, monto, GPS y "ver en mapa". Presentacional (server).
import type { ResumenCobradorDia } from "@/lib/data/bitacora";
import { AvisarCobrador } from "@/components/admin/AvisarCobrador";
import { UYU } from "@/lib/format";

const NIVEL: Record<string, { bg: string; fg: string; label: string }> = {
  ok: { bg: "#E4F5EC", fg: "#157A50", label: "Sin señales" },
  observar: { bg: "#FDF3E2", fg: "#B9770E", label: "Observar" },
  alerta: { bg: "#FBE4E2", fg: "#C0392B", label: "Alerta" },
};

const ICONO: Record<string, string> = {
  cobro: "💵",
  no_pago: "🚪",
  censo: "🧭",
  gasto: "🧾",
  cierre_jornada: "🔒",
  ver_ficha: "👁️",
};

function horaUY(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—"; // sin hora legible (evita romper con "Invalid Date")
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function ControlCampo({ resumen }: { resumen: ResumenCobradorDia[] }) {
  if (resumen.length === 0) {
    return (
      <div className="rounded-[16px] border border-borde bg-tarjeta p-6 text-center">
        <p className="text-[13px] font-medium text-gris">
          No hay actividad de campo registrada ese día. (Requiere la migración 0024 corrida.)
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {resumen.map((c) => {
        const n = NIVEL[c.senales.nivel] ?? NIVEL.ok;
        return (
          <section key={c.actorId} className="rounded-[18px] border border-borde bg-tarjeta p-4">
            <div className="mb-2 flex items-center gap-3">
              <span className="text-[15px] font-extrabold text-tinta">{c.actorNombre}</span>
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                style={{ background: n.bg, color: n.fg }}
                title="Score de SOSPECHA del día (0–100, mayor = más sospecha). Es lo opuesto al score de CONFIANZA del Centro de alertas (mayor = mejor)."
              >
                {n.label} · sospecha {c.senales.score}/100
              </span>
              <span className="ml-auto text-[12px] font-medium text-gris">
                {c.senales.cobros} cobro{c.senales.cobros === 1 ? "" : "s"} · {c.eventos.length} acciones
              </span>
            </div>

            {/* Detectaste la maña → actuá sin salir: avisá al cobrador a su chat. */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <AvisarCobrador cobradorId={c.actorId} nombre={c.actorNombre} />
            </div>

            {/* Motivos / alertas */}
            {c.senales.motivos.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {c.senales.motivos.map((m, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-[#FBE4E2] px-2.5 py-1 text-[11px] font-semibold text-[#C0392B]"
                  >
                    ⚠ {m}
                  </span>
                ))}
              </div>
            )}

            {/* Lista de acciones */}
            <ul className="flex flex-col divide-y divide-linea">
              {c.eventos.map((e) => {
                const hayGps = e.gpsLat != null && e.gpsLng != null;
                return (
                  <li key={e.id} className="flex items-center gap-2.5 py-2 text-[12.5px]">
                    <span className="w-11 flex-shrink-0 font-semibold text-gris tabular-nums">
                      {horaUY(e.serverTs)}
                    </span>
                    <span aria-hidden="true">{ICONO[e.accion] ?? "•"}</span>
                    <span className="min-w-0 flex-1 truncate text-tinta">
                      <span className="font-semibold">{e.accion.replace("_", " ")}</span>
                      {e.clienteNombre ? ` · ${e.clienteNombre}` : ""}
                      {e.monto != null ? ` · ${UYU(e.monto)}` : ""}
                    </span>
                    {/* GPS / zona */}
                    {e.accion === "cobro" && e.enZona === false && (
                      <span className="flex-shrink-0 rounded-full bg-[#FBE4E2] px-1.5 py-0.5 text-[10px] font-bold text-[#C0392B]">
                        fuera de zona
                      </span>
                    )}
                    {hayGps ? (
                      <a
                        href={`https://www.google.com/maps?q=${e.gpsLat},${e.gpsLng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 rounded-full bg-[#EEF3FF] px-2 py-0.5 text-[10px] font-bold text-azul"
                      >
                        📍 mapa
                      </a>
                    ) : (
                      <span className="flex-shrink-0 rounded-full bg-[#FBE4E2] px-2 py-0.5 text-[10px] font-bold text-[#C0392B]">
                        sin GPS
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
