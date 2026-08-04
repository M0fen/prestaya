// "Mis números" — la foto del propio cobrador: comisión de la QUINCENA (la
// cadencia con la que se paga, 08-05) y del mes, recaudo, ticket, días activos,
// jornadas que cuadraron y el historial de comisiones YA cobradas. Motivación +
// transparencia. Solo ve LO SUYO (no a sus compañeros).
import Link from "next/link";
import { getUsuarioActual } from "@/lib/auth";
import { getMisNumeros } from "@/lib/data/misNumeros";
import { etiquetaPeriodoKey } from "@/lib/data/comisiones";
import { ApodoEditor } from "@/components/cobrador/ApodoEditor";
import { UYU, meses } from "@/lib/format";
import { hoyUY } from "@/lib/fecha";

export const dynamic = "force-dynamic";

export default async function MisNumerosPage() {
  const usuario = await getUsuarioActual();
  if (!usuario) return null;
  const n = await getMisNumeros(usuario.id);
  const hoy = hoyUY();
  const mesLabel = `${meses[hoy.getMonth()]} ${hoy.getFullYear()}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[19px] font-extrabold tracking-[-0.01em] text-tinta">Mis números</h1>
          <span className="text-[12.5px] font-medium text-gris capitalize">{mesLabel}</span>
        </div>
        <Link href="/cobrador" className="rounded-full bg-[#EEF3FF] px-3.5 py-1.5 text-[12.5px] font-bold text-azul">
          ← Mi ruta
        </Link>
      </div>

      {/* Comisión de la QUINCENA — la que se COBRA (se liquida por quincena, 08-05). */}
      <section className="overflow-hidden rounded-[18px] bg-[linear-gradient(150deg,#157A50_0%,#0E5E3D_100%)] p-4 text-white shadow-[0_10px_24px_rgba(14,94,61,0.3)]">
        <span className="text-[11px] font-semibold tracking-wide text-white/60 uppercase">
          Comisión de esta quincena {n.comisionPct > 0 ? `· ${n.comisionPct}%` : ""}
        </span>
        <div className="mt-0.5 flex items-end justify-between">
          <span className="text-[30px] leading-none font-black tabular-nums">{UYU(n.comisionQuincena)}</span>
          <span className="text-[12px] font-medium text-white/70">de {UYU(n.quincenaRecaudado)} recaudados</span>
        </div>
        <p className="mt-2 text-[11px] leading-[1.45] font-medium text-white/60">
          {Number(n.quincenaDesde.slice(8, 10)) === 1 ? "Del 1 al 15" : "Del 16 a fin de mes"} — la
          comisión se paga por quincena. En el mes llevás {UYU(n.comisionMes)}.
        </p>
      </section>

      {/* Grid de estadísticas del mes. */}
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi label="Recaudado (mes)" valor={UYU(n.mesRecaudado)} tono="#157A50" />
        <Kpi label="Últimos 7 días" valor={UYU(n.semanaRecaudado)} tono="#1E47C8" />
        <Kpi label="Cobros del mes" valor={String(n.mesCobros)} />
        <Kpi label="Ticket promedio" valor={UYU(n.ticketPromedio)} />
        <Kpi label="Días activos" valor={String(n.mesDiasActivos)} sub="con al menos un cobro" />
        <Kpi
          label="Jornadas cuadradas"
          valor={`${n.cuadradas}/${n.rendiciones}`}
          sub={n.rendiciones > 0 ? "cerraste sin faltante" : "sin cierres aún"}
          tono={n.rendiciones > 0 && n.cuadradas === n.rendiciones ? "#157A50" : undefined}
        />
      </div>

      {/* Historial de comisiones YA cobradas (qué, cuándo y de qué período). */}
      {n.liquidaciones.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <span className="px-0.5 text-[11.5px] font-bold uppercase tracking-wide text-gris">
            Comisiones cobradas
          </span>
          <ul className="flex flex-col divide-y divide-[#F0F2F9] rounded-[14px] border border-[#E6EAF4] bg-white">
            {n.liquidaciones.map((l) => (
              <li key={`${l.periodoKey}-${l.liquidadoEn}`} className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                <div className="flex flex-col leading-tight">
                  <span className="text-[12.5px] font-bold text-tinta">{etiquetaPeriodoKey(l.periodoKey)}</span>
                  <span className="text-[10.5px] font-medium text-tenue">
                    pagada el {new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", day: "numeric", month: "short" }).format(new Date(l.liquidadoEn))}
                  </span>
                </div>
                <span className="text-[14px] font-extrabold tabular-nums text-[#157A50]">{UYU(l.monto)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sobrenombre: cómo te ven los clientes en el recibo. */}
      <ApodoEditor apodoActual={(usuario.apodo ?? "").trim() || null} />

      <p className="px-0.5 text-[11px] leading-[1.5] font-medium text-tenue">
        Tu comisión sale del recaudo real que registrás (libro de pagos inmutable). Cuantas más jornadas cuadres y
        menos faltantes tengas, más confianza y mejor tu cuenta.
      </p>
    </div>
  );
}

function Kpi({ label, valor, sub, tono }: { label: string; valor: string; sub?: string; tono?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] border border-[#E6EAF4] bg-white p-3.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-gris">{label}</span>
      <span className="text-[19px] font-extrabold tabular-nums" style={{ color: tono ?? "#0F1B3D" }}>
        {valor}
      </span>
      {sub && <span className="text-[10.5px] font-medium text-tenue">{sub}</span>}
    </div>
  );
}
