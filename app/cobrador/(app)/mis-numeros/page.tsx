// "Mis números" — la foto del propio cobrador: comisión del mes, recaudo del mes
// y de la semana, ticket, días activos y jornadas que cuadraron. Motivación +
// transparencia. Solo ve LO SUYO (no a sus compañeros).
import Link from "next/link";
import { getUsuarioActual } from "@/lib/auth";
import { getMisNumeros } from "@/lib/data/misNumeros";
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

      {/* Comisión del mes — la plata que va ganando (positivo). */}
      <section className="overflow-hidden rounded-[18px] bg-[linear-gradient(150deg,#157A50_0%,#0E5E3D_100%)] p-4 text-white shadow-[0_10px_24px_rgba(14,94,61,0.3)]">
        <span className="text-[11px] font-semibold tracking-wide text-white/60 uppercase">
          Comisión ganada este mes {n.comisionPct > 0 ? `· ${n.comisionPct}%` : ""}
        </span>
        <div className="mt-0.5 flex items-end justify-between">
          <span className="text-[30px] leading-none font-black tabular-nums">{UYU(n.comisionMes)}</span>
          <span className="text-[12px] font-medium text-white/70">de {UYU(n.mesRecaudado)} recaudados</span>
        </div>
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
