// Cierre de caja POR ZONA (vista gestor, dentro de Caja). Agrupa las rendiciones
// del día por zona: el supervisor ve/cierra SU zona; el admin ve todas. Muestra,
// por zona, el esperado/entregado/faltante/por-rendir y el detalle por cobrador,
// con el sello de "cerrada" cuando el supervisor confirmó la entrega.
import Link from "next/link";
import { UYU } from "@/lib/format";
import type { ResumenCierreZonas } from "@/lib/data/cierreZona";
import type { EstadoCobradorCierre } from "@/lib/cierreZona";
import { BotonCerrarZona } from "./BotonCerrarZona";

const CHIP: Record<EstadoCobradorCierre, { bg: string; fg: string }> = {
  cuadra: { bg: "#E4F5EC", fg: "#157A50" },
  faltante: { bg: "#FBE4E2", fg: "#C0392B" },
  sobrante: { bg: "#FDF3E2", fg: "#B9770E" },
  pendiente: { bg: "#EEF1F8", fg: "#6B7494" },
};

export function CierrePorZona({
  resumen,
  cerrables,
}: {
  resumen: ResumenCierreZonas;
  /** IDs de zona que el usuario actual puede cerrar (supervisor de la zona / admin). */
  cerrables: string[];
}) {
  if (!resumen.disponible) {
    return (
      <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
        <span className="text-[13px] font-bold text-tinta">Cierre por zona</span>
        <p className="mt-1.5 text-[12.5px] font-medium text-gris">
          Para habilitar el cierre de jornada, corré la migración{" "}
          <code className="rounded bg-[#F0F3FA] px-1 font-mono text-[11.5px]">0013_rendiciones.sql</code>.
        </p>
      </section>
    );
  }

  const { consolidado } = resumen;
  if (consolidado.zonas.length === 0) return null;

  const cerrable = new Set(cerrables);

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-tinta">Cierre por zona</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <TotalChip label="Entregado" valor={consolidado.totalEntregado} tono="#157A50" />
          {consolidado.totalFaltante > 0 && (
            <TotalChip label="Faltante" valor={consolidado.totalFaltante} tono="#C0392B" />
          )}
          {consolidado.porRendir > 0 && (
            <TotalChip label="Por rendir" valor={consolidado.porRendir} tono="#B9770E" />
          )}
        </div>
      </div>

      {consolidado.zonas.map((z) => (
        <div
          key={z.zonaId ?? "sin-zona"}
          className="rounded-[16px] border border-borde bg-tarjeta p-4"
        >
          {/* Encabezado de la zona */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[14px] font-extrabold text-tinta">{z.zonaNombre}</span>
              <span className="text-[11px] font-medium text-tenue">
                {z.rendidos} rindi{z.rendidos === 1 ? "ó" : "eron"}
                {z.pendientes > 0 ? ` · ${z.pendientes} sin rendir` : ""}
              </span>
            </div>
            {z.confirmado ? (
              <span className="rounded-full bg-[#E4F5EC] px-2.5 py-1 text-[11.5px] font-bold text-[#157A50]">
                Cerrada ✓ {z.confirmado.supervisorNombre ? `· ${z.confirmado.supervisorNombre}` : ""}
              </span>
            ) : z.totalFaltante > 0 ? (
              <span className="rounded-full bg-[#FBE4E2] px-2.5 py-1 text-[11.5px] font-bold text-[#C0392B]">
                Faltante {UYU(z.totalFaltante)}
              </span>
            ) : null}
          </div>

          {/* Totales de la zona */}
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            <Mini label="Esperado" valor={z.totalEsperado} />
            <Mini label="Entregado" valor={z.totalEntregado} tono="#157A50" />
            <Mini
              label={z.porRendir > 0 ? "Por rendir" : "Diferencia"}
              valor={z.porRendir > 0 ? z.porRendir : z.totalSobrante - z.totalFaltante}
              tono={z.porRendir > 0 ? "#B9770E" : z.totalFaltante > 0 ? "#C0392B" : "#157A50"}
            />
          </div>

          {/* Detalle por cobrador */}
          <ul className="mt-2 flex flex-col divide-y divide-linea">
            {z.cobradores.map((c) => {
              const t = CHIP[c.estado];
              return (
                <li key={c.cobradorId} className="flex items-center justify-between gap-2 py-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-semibold text-tinta">{c.nombre}</span>
                    <span className="text-[11px] font-medium text-tenue">
                      {c.estado === "pendiente"
                        ? `recaudó ${UYU(c.recaudado)} · sin rendir`
                        : `entregó ${UYU(c.entregado)} · esperado ${UYU(c.esperado)}`}
                    </span>
                  </div>
                  <span
                    className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold"
                    style={{ background: t.bg, color: t.fg }}
                  >
                    {c.estado === "pendiente"
                      ? "Sin rendir"
                      : c.estado === "cuadra"
                        ? "Cuadra ✓"
                        : `${c.diferencia < 0 ? "−" : "+"}${UYU(Math.abs(c.diferencia))}`}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Cerrar la zona (solo supervisor de la zona / admin, y si 0047 corrió) */}
          {z.zonaId && !z.confirmado && resumen.confirmacionesDisponible && cerrable.has(z.zonaId) && (
            <BotonCerrarZona
              zonaId={z.zonaId}
              totalEntregado={z.totalEntregado}
              pendientes={z.pendientes}
            />
          )}
        </div>
      ))}

      {(consolidado.totalFaltante > 0 || consolidado.porRendir > 0) && (
        <p className="text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
          {consolidado.totalFaltante > 0 && (
            <>
              Los <b className="text-[#C0392B]">faltantes</b> bajan el score de confianza del cobrador y quedan en su
              cuenta corriente.{" "}
            </>
          )}
          {consolidado.porRendir > 0 && <>Lo <b className="text-[#B9770E]">por rendir</b> es float aún en la calle. </>}
          Actuá desde el <Link href="/admin/alertas" className="font-bold text-azul">Centro de alertas</Link>.
        </p>
      )}
    </section>
  );
}

function TotalChip({ label, valor, tono }: { label: string; valor: number; tono: string }) {
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11.5px] font-bold"
      style={{ background: `${tono}18`, color: tono }}
    >
      {label} {UYU(valor)}
    </span>
  );
}

function Mini({ label, valor, tono }: { label: string; valor: number; tono?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] bg-suave px-3 py-2">
      <span className="text-[10.5px] font-semibold text-tenue">{label}</span>
      <span className="text-[14px] font-extrabold tabular-nums" style={{ color: tono ?? "var(--color-tinta)" }}>
        {UYU(valor)}
      </span>
    </div>
  );
}
