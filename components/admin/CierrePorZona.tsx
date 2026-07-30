// Cierre de caja POR ZONA (vista gestor, dentro de Caja). Agrupa las rendiciones
// del día por zona: el supervisor ve/cierra SU zona; el admin ve todas. Muestra,
// por zona, el esperado/entregado/faltante/por-rendir y el detalle por cobrador,
// con el sello de "cerrada" cuando el supervisor confirmó la entrega.
import Link from "next/link";
import { UYU } from "@/lib/format";
import type { ResumenCierreZonas } from "@/lib/data/cierreZona";
import { CLAVE_SIN_ZONA, type EstadoCobradorCierre } from "@/lib/cierreZona";
import { BotonCerrarZona } from "./BotonCerrarZona";

// Tokens tema-aware (globals.css): en oscuro flipean a superficie teñida + texto
// claro legible. Antes eran hex fijos → verde/rojo ilegible sobre fondo oscuro.
const CHIP: Record<EstadoCobradorCierre, { bg: string; fg: string }> = {
  cuadra: { bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)" },
  faltante: { bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)" },
  sobrante: { bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)" },
  pendiente: { bg: "var(--color-suave)", fg: "var(--color-gris)" },
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
          <code className="rounded bg-suave px-1 font-mono text-[11.5px]">0013_rendiciones.sql</code>.
        </p>
      </section>
    );
  }

  const { consolidado } = resumen;
  if (consolidado.zonas.length === 0) return null;

  const cerrable = new Set(cerrables);
  // Operación PLANA (sin zonas): un único bucket sin zona. Se presenta como
  // "Cierre del día" en vez de "Cierre por zona / Sin zona" (que parece un error).
  const soloSinZona = consolidado.zonas.length === 1 && !consolidado.zonas[0].zonaId;

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-tinta">{soloSinZona ? "Cierre del día" : "Cierre por zona"}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <TotalChip label="Entregado" valor={consolidado.totalEntregado} kind="verde" />
          {consolidado.totalFaltante > 0 && (
            <TotalChip label="Faltante" valor={consolidado.totalFaltante} kind="rojo" />
          )}
          {consolidado.porRendir > 0 && (
            <TotalChip label="Por rendir" valor={consolidado.porRendir} kind="ambar" />
          )}
        </div>
      </div>

      {consolidado.zonas.map((z) => {
        const clave = z.zonaId ?? CLAVE_SIN_ZONA;
        return (
        <div
          key={z.zonaId ?? "sin-zona"}
          className="rounded-[16px] border border-borde bg-tarjeta p-4"
        >
          {/* Encabezado de la zona */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[14px] font-extrabold text-tinta">
                {z.zonaId ? z.zonaNombre : "Caja del día"}
              </span>
              <span className="text-[11px] font-medium text-tenue">
                {z.rendidos} rindi{z.rendidos === 1 ? "ó" : "eron"}
                {z.pendientes > 0 ? ` · ${z.pendientes} sin rendir` : ""}
              </span>
            </div>
            {z.confirmado ? (
              <span className="rounded-full bg-verde-suave px-2.5 py-1 text-[11.5px] font-bold text-verde-osc">
                Cerrada ✓ {z.confirmado.supervisorNombre ? `· ${z.confirmado.supervisorNombre}` : ""}
              </span>
            ) : z.totalFaltante > 0 ? (
              <span className="rounded-full bg-rojo-suave px-2.5 py-1 text-[11.5px] font-bold text-rojo-osc">
                Faltante {UYU(z.totalFaltante)}
              </span>
            ) : null}
          </div>

          {/* Totales de la zona */}
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            <Mini label="Esperado" valor={z.totalEsperado} />
            <Mini label="Entregado" valor={z.totalEntregado} tono="var(--color-verde-osc)" />
            <Mini
              label={z.porRendir > 0 ? "Por rendir" : "Diferencia"}
              valor={z.porRendir > 0 ? z.porRendir : z.totalSobrante - z.totalFaltante}
              tono={z.porRendir > 0 ? "var(--color-ambar-osc)" : z.totalFaltante > 0 ? "var(--color-rojo-osc)" : "var(--color-verde-osc)"}
            />
          </div>

          {/* Detalle por cobrador */}
          <ul className="mt-2 flex flex-col divide-y divide-linea">
            {z.cobradores.map((c) => {
              const t = CHIP[c.estado];
              const postCierre = c.cobroPostCierre ?? 0;
              return (
                <li key={c.cobradorId} className="flex flex-col gap-1 py-2">
                  <div className="flex items-center justify-between gap-2">
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
                  </div>
                  {postCierre > 1 && (
                    <span className="rounded-[8px] bg-ambar-suave px-2 py-1 text-[11px] font-bold text-ambar-osc">
                      ⚠️ Cobró {UYU(postCierre)} DESPUÉS de cerrar — esa plata no entró a esta rendición.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Cerrar (supervisor de la zona / admin; el admin además la "Caja del día"
              del bucket sin zona). Requiere 0047. */}
          {!z.confirmado && resumen.confirmacionesDisponible && cerrable.has(clave) && (
            <BotonCerrarZona
              zonaId={clave}
              totalEntregado={z.totalEntregado}
              pendientes={z.pendientes}
              esSinZona={!z.zonaId}
            />
          )}
        </div>
        );
      })}

      {(consolidado.totalFaltante > 0 || consolidado.porRendir > 0) && (
        <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
          {consolidado.totalFaltante > 0 && (
            <>
              Los <b className="text-rojo-osc">faltantes</b> bajan el score de confianza del cobrador y quedan en su
              cuenta corriente.{" "}
            </>
          )}
          {consolidado.porRendir > 0 && <>Lo <b className="text-ambar-osc">por rendir</b> es float aún en la calle. </>}
          Actuá desde el <Link href="/admin/alertas" className="font-bold text-azul">Centro de alertas</Link>.
        </p>
      )}
    </section>
  );
}

function TotalChip({ label, valor, kind }: { label: string; valor: number; kind: "verde" | "rojo" | "ambar" }) {
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11.5px] font-bold"
      style={{ background: `var(--color-${kind}-suave)`, color: `var(--color-${kind}-osc)` }}
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
