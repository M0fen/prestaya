// Caja / Tesorería (admin/supervisor): resumen del día (o del mes), ingresos vs
// egresos, efectivo a rendir por cobrador, libro de movimientos y alta de
// gastos/desembolsos/aportes/retiros. Los cobros vienen de `pagos`.
import Link from "next/link";
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getResumenCaja, type PeriodoCaja, type LineaLibro } from "@/lib/data/caja";
import { getRendicionesDia } from "@/lib/data/rendicion";
import { FormMovimientoCaja } from "@/components/admin/FormMovimientoCaja";
import { RendicionesDia } from "@/components/admin/RendicionesDia";
import { UYU, horaDe, meses } from "@/lib/format";

export const dynamic = "force-dynamic";

function fechaHora(iso: string, mostrarDia: boolean): string {
  const d = new Date(iso);
  const hm = horaDe(iso);
  return mostrarDia ? `${d.getDate()} ${meses[d.getMonth()].slice(0, 3)} ${hm}` : hm;
}

const COLOR_LINEA: Record<LineaLibro["tipo"], string> = {
  cobro: "#1FA971",
  ingreso: "#1FA971",
  egreso: "#C0392B",
  desembolso: "#C0562B",
  retiro: "#B9770E",
};

export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const periodo: PeriodoCaja = p === "mes" ? "mes" : "hoy";
  await requireGestor();
  const db = await createSupabaseServer();
  const r = await getResumenCaja(db, periodo);
  const esMes = periodo === "mes";
  // Rendiciones de jornada: solo tienen sentido en la vista del día.
  const rendiciones = esMes ? null : await getRendicionesDia(db);

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Caja</h1>
          <span className="text-[13px] font-medium text-gris">
            {esMes ? "Movimiento del mes" : "Resumen del día"} — ingresos, egresos y efectivo.
          </span>
        </div>
        <div className="flex gap-1.5">
          {(["hoy", "mes"] as const).map((op) => (
            <Link
              key={op}
              href={`/admin/caja?p=${op}`}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold ${
                periodo === op ? "bg-[#2453DC] text-white" : "bg-white text-[#6B7494]"
              }`}
            >
              {op === "hoy" ? "Hoy" : "Mes"}
            </Link>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi label="Ingresos" valor={UYU(r.ingresosTotal)} tono="#157A50" />
        <Kpi label="Egresos" valor={UYU(r.egresosTotal)} tono="#C0392B" />
        <Kpi label="Neto" valor={UYU(r.neto)} tono={r.neto >= 0 ? "#157A50" : "#C0392B"} />
        <Kpi label="Cobros" valor={`${r.cobrosCantidad}`} sub={UYU(r.cobros)} />
      </div>

      <FormMovimientoCaja />

      {/* Desglose de egresos */}
      {r.egresosPorCategoria.length > 0 && (
        <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
          <span className="text-[13px] font-bold text-tinta">Egresos por categoría</span>
          <ul className="mt-2 flex flex-col divide-y divide-[#EEF1F8]">
            {r.egresosPorCategoria.map((e) => (
              <li key={e.categoria} className="flex items-center justify-between py-2">
                <span className="text-[13px] font-medium text-[#3A445F]">{e.categoria}</span>
                <span className="text-[13.5px] font-extrabold text-tinta tabular-nums">
                  {UYU(e.monto)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Efectivo a rendir por cobrador */}
      {r.porCobrador.length > 0 && (
        <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
          <span className="text-[13px] font-bold text-tinta">
            {esMes ? "Recaudado por cobrador" : "Efectivo a rendir hoy"}
          </span>
          <ul className="mt-2 flex flex-col divide-y divide-[#EEF1F8]">
            {r.porCobrador.map((c) => (
              <li key={c.nombre} className="flex items-center justify-between py-2">
                <span className="text-[13px] font-semibold text-tinta">{c.nombre}</span>
                <span className="text-[12px] font-medium text-gris">
                  {c.cobros} cobro{c.cobros === 1 ? "" : "s"}
                </span>
                <span className="text-[13.5px] font-extrabold text-tinta tabular-nums">
                  {UYU(c.recaudado)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Rendiciones de jornada (solo hoy) */}
      {rendiciones && <RendicionesDia r={rendiciones} />}

      {/* Libro de movimientos */}
      <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
        <span className="text-[13px] font-bold text-tinta">Libro de caja</span>
        {r.libro.length === 0 ? (
          <p className="mt-2 text-[13px] font-medium text-gris">Sin movimientos en el período.</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-[#EEF1F8]">
            {r.libro.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-semibold text-tinta">{l.concepto}</span>
                  <span className="text-[11px] font-medium text-[#8A93AD]">
                    {fechaHora(l.fechaIso, esMes)}
                  </span>
                </div>
                <span
                  className="flex-shrink-0 text-[13.5px] font-extrabold tabular-nums"
                  style={{ color: COLOR_LINEA[l.tipo] }}
                >
                  {l.signo > 0 ? "+" : "−"}
                  {UYU(l.monto)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
        Los cobros entran automáticamente desde la calle (tabla de pagos, inmutable). Acá se
        cargan gastos, desembolsos, aportes y retiros. El neto = ingresos − egresos.
      </p>
    </div>
  );
}

function Kpi({
  label,
  valor,
  sub,
  tono,
}: {
  label: string;
  valor: string;
  sub?: string;
  tono?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] bg-white p-3.5 shadow-[0_1px_3px_rgba(26,34,71,0.05)]">
      <span className="text-[11px] font-semibold text-[#8A93AD]">{label}</span>
      <span className="text-[19px] font-extrabold tabular-nums" style={{ color: tono ?? "#1A2247" }}>
        {valor}
      </span>
      {sub && <span className="text-[11px] font-semibold text-gris tabular-nums">{sub}</span>}
    </div>
  );
}
