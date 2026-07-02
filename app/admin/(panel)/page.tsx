// Dashboard del panel: foto de la operación (stock: cartera/mora al instante) +
// MOVIMIENTO por período (día/semana/mes/año, con comparativa y serie) +
// tendencias y el bloque proactivo "Aureo ve hoy".
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getResumenFinanciero } from "@/lib/data/asesor";
import { getSerieRecaudo } from "@/lib/data/series";
import { getResumenPeriodo, normalizarPeriodo, PERIODOS } from "@/lib/data/periodo";
import { generarInsights } from "@/lib/insights";
import { UYU, diasSemana, meses } from "@/lib/format";
import { Sparkline } from "@/components/charts/Sparkline";
import { Columnas } from "@/components/charts/Columnas";
import { BarrasComparativas } from "@/components/charts/BarrasComparativas";
import { Donut } from "@/components/charts/Donut";
import { AureoInsights } from "@/components/admin/AureoInsights";
import Link from "next/link";

export const dynamic = "force-dynamic";

function fechaHoyLarga(d: Date): string {
  return `${diasSemana[d.getDay()]}, ${d.getDate()} de ${meses[d.getMonth()]}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  await requireGestor();
  const hoy = new Date();
  const db = await createSupabaseServer();
  const periodo = normalizarPeriodo((await searchParams).periodo);

  const [resumen, serie, mov, reportesRes] = await Promise.all([
    getResumenFinanciero(db, hoy),
    getSerieRecaudo(db, hoy, 14),
    getResumenPeriodo(db, periodo, hoy),
    db.from("reportes").select("*", { count: "exact", head: true }).eq("estado", "nuevo"),
  ]);
  const reportesNuevos = reportesRes.count ?? 0;

  const { cartera, recaudacion, mora, cobradores } = resumen;
  const alDia = Math.max(0, cartera.carteraPorCobrar - mora.monto);

  const insights = generarInsights({
    moraPct: mora.moraPct,
    montoEnMora: mora.monto,
    morosos: mora.morosos,
    criticos: mora.criticos,
    carteraPorCobrar: cartera.carteraPorCobrar,
    recaudadoHoy: recaudacion.hoy,
    recaudadoMes: recaudacion.mes,
    topRiesgo: mora.topRiesgo,
    cobradores: cobradores.ranking,
    alertas: cobradores.alertas,
    serie: { promedio: serie.promedio, hoy: serie.hoy, tendencia: serie.tendencia },
  });

  const recaudos = serie.dias.map((d) => d.recaudado);
  const tendPct = Math.round(serie.tendencia * 100);
  const varPct = mov.variacionPct === null ? null : Math.round(mov.variacionPct * 100);

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">
            Resumen de la operación
          </h1>
          <span className="text-[13px] font-medium text-gris capitalize">
            {fechaHoyLarga(hoy)}
          </span>
        </div>
        {reportesNuevos > 0 && (
          <Link
            href="/admin/clientes"
            className="rounded-full bg-[#FCE8E8] px-3 py-1.5 text-[12.5px] font-bold text-[#C0392B]"
          >
            {reportesNuevos} reporte(s) sin atender
          </Link>
        )}
      </div>

      {/* KPIs de STOCK (al instante) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etiqueta="Por cobrar" valor={UYU(cartera.carteraPorCobrar)} sub={`${cartera.creditosActivos} crédito(s) activo(s)`} acento="#1E47C8" />
        <div className="flex flex-col gap-1 rounded-[16px] border border-[#E6EAF4] bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold tracking-wide text-gris uppercase">Recaudado hoy</span>
            {serie.tendencia !== 0 && (
              <span className={`text-[11px] font-bold tabular-nums ${tendPct >= 0 ? "text-verde" : "text-rojo"}`}>
                {tendPct >= 0 ? "▲" : "▼"} {Math.abs(tendPct)}%
              </span>
            )}
          </div>
          <span className="text-[23px] leading-tight font-extrabold tabular-nums text-verde">{UYU(recaudacion.hoy)}</span>
          <div className="mt-0.5"><Sparkline valores={recaudos} color="#1FA971" alto={30} /></div>
          <span className="text-[12px] font-medium text-[#8A93AD]">Mes: {UYU(recaudacion.mes)}</span>
        </div>
        <Kpi etiqueta="En mora" valor={UYU(mora.monto)} sub={`${mora.morosos} atrasado(s) · ${Math.round(mora.moraPct * 100)}% cartera`} acento="#E06A6A" />
        <Kpi etiqueta="Capital colocado" valor={UYU(cartera.capitalColocado)} sub={`${cartera.clientesActivos} cliente(s) activo(s)`} acento="#7A4DD6" />
      </div>

      {/* Aureo ve hoy (proactivo) */}
      <AureoInsights insights={insights} />

      {/* MOVIMIENTO por período (día/semana/mes/año) */}
      <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <h2 className="text-[15px] font-extrabold text-tinta">Movimiento</h2>
            <span className="text-[12px] font-medium text-gris">{mov.etiqueta}</span>
          </div>
          {/* Selector de período (sin JS: navega por query param) */}
          <div className="flex rounded-full bg-[#F0F3FA] p-0.5">
            {PERIODOS.map((p) => {
              const activo = p.id === periodo;
              return (
                <Link
                  key={p.id}
                  href={p.id === "dia" ? "/admin" : `/admin?periodo=${p.id}`}
                  className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-colors ${
                    activo ? "bg-white text-azul shadow-[0_1px_2px_rgba(26,34,71,0.1)]" : "text-gris hover:text-tinta"
                  }`}
                >
                  {p.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Tiles del período */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="flex flex-col gap-1 rounded-[13px] bg-[#F1FBF6] p-3.5">
            <span className="text-[11px] font-bold tracking-wide text-[#157A50] uppercase">Recaudado</span>
            <span className="text-[20px] font-extrabold tabular-nums text-verde">{UYU(mov.recaudado)}</span>
            <div className="flex items-center gap-1.5">
              {varPct === null ? (
                <span className="text-[11.5px] font-medium text-[#8A93AD]">sin base previa</span>
              ) : (
                <span className={`text-[11.5px] font-bold ${varPct >= 0 ? "text-verde" : "text-rojo"}`}>
                  {varPct >= 0 ? "▲" : "▼"} {Math.abs(varPct)}% vs anterior
                </span>
              )}
            </div>
          </div>
          <Tile etiqueta="Cobros" valor={String(mov.cobros)} sub={`ticket ${UYU(mov.ticketPromedio)}`} />
          <Tile etiqueta="Colocado" valor={UYU(mov.colocado)} sub={`${mov.creditosNuevos} crédito(s) nuevo(s)`} acento="#7A4DD6" />
          <Tile etiqueta="Finalizados" valor={String(mov.creditosFinalizados)} sub="créditos saldados" />
        </div>

        {/* Serie interna del período */}
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12.5px] font-bold text-tinta">Recaudo {mov.serieUnidad}</span>
            <span className="text-[11.5px] font-medium text-gris">{mov.cobros} cobro(s)</span>
          </div>
          {mov.recaudado > 0 ? (
            <Columnas
              datos={mov.serie.map((b) => ({ etiqueta: b.etiqueta, valor: b.valor, esHoy: b.esActual }))}
            />
          ) : (
            <p className="py-6 text-center text-[12.5px] font-medium text-[#AEB6CC]">
              Sin cobros en este período todavía.
            </p>
          )}
        </div>

        {/* Recaudo por cobrador en el período */}
        {mov.porCobrador.length > 0 && (
          <div className="mt-5 border-t border-[#EEF1F8] pt-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[12.5px] font-bold text-tinta">Recaudo por cobrador</span>
              <span className="text-[11.5px] font-medium text-gris">{mov.etiqueta}</span>
            </div>
            <BarrasComparativas
              datos={mov.porCobrador.map((c) => ({
                nombre: c.nombre,
                valor: c.recaudado,
                total: mov.recaudado,
                sub: `${c.cobros} cobro(s) · ${
                  mov.recaudado > 0 ? Math.round((c.recaudado / mov.recaudado) * 100) : 0
                }% del período`,
              }))}
            />
          </div>
        )}
      </section>

      {/* Cobradores + mora por antigüedad */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-extrabold text-tinta">Cobradores hoy</h2>
            <Link href="/admin/cobranza" className="text-[12px] font-bold text-azul">Ver control →</Link>
          </div>
          <BarrasComparativas
            datos={cobradores.ranking.map((c) => ({
              nombre: c.nombre,
              valor: c.recaudado,
              total: c.esperado,
              sub: `${c.progresoPct}% de la ruta${c.anomalias > 0 ? ` · ${c.anomalias} anomalía(s)` : ""}`,
              alerta: c.anomalias > 0,
            }))}
          />
        </section>

        <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-extrabold text-tinta">Mora por antigüedad</h2>
            <Link href="/admin/mora" className="text-[12px] font-bold text-azul">Ver mora →</Link>
          </div>
          {mora.monto > 0 ? (
            <Donut
              centroValor={UYU(mora.monto)}
              centroEtiqueta="en mora"
              segmentos={mora.tramos.map((t, i) => ({
                etiqueta: t.tramo,
                valor: t.monto,
                color: ["#E8A317", "#E06A6A", "#C0392B"][i],
              }))}
            />
          ) : (
            <p className="py-8 text-center text-[12.5px] font-medium text-verde">🎉 Sin mora vencida. Cartera al día.</p>
          )}
        </section>
      </div>

      {/* Cartera + estado */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-5">
          <h2 className="mb-4 text-[15px] font-extrabold text-tinta">Cartera por cobrar</h2>
          <Donut
            centroValor={UYU(cartera.carteraPorCobrar)}
            centroEtiqueta="saldo total"
            segmentos={[
              { etiqueta: "Al día", valor: alDia, color: "#1FA971" },
              { etiqueta: "Vencido (mora)", valor: mora.monto, color: "#E06A6A" },
            ]}
          />
        </section>
        <section className="grid grid-cols-2 gap-3 self-start">
          <Mini etiqueta="Créditos activos" valor={cartera.creditosActivos} />
          <Mini etiqueta="Finalizados" valor={cartera.creditosFinalizados} />
          <Mini etiqueta="Incobrables" valor={cartera.incobrables} alerta={cartera.incobrables > 0} />
          <Mini etiqueta="En estado crítico" valor={mora.criticos} alerta={mora.criticos > 0} />
        </section>
      </div>
    </div>
  );
}

function Kpi({ etiqueta, valor, sub, acento }: { etiqueta: string; valor: string; sub: string; acento: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[16px] border border-[#E6EAF4] bg-white p-4">
      <span className="text-[11.5px] font-bold tracking-wide text-gris uppercase">{etiqueta}</span>
      <span className="text-[23px] leading-tight font-extrabold tabular-nums" style={{ color: acento }}>{valor}</span>
      <span className="text-[12px] font-medium text-[#8A93AD]">{sub}</span>
    </div>
  );
}

function Tile({ etiqueta, valor, sub, acento = "#0F1B3D" }: { etiqueta: string; valor: string; sub: string; acento?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[13px] bg-[#F7F9FD] p-3.5">
      <span className="text-[11px] font-bold tracking-wide text-gris uppercase">{etiqueta}</span>
      <span className="text-[20px] font-extrabold tabular-nums" style={{ color: acento }}>{valor}</span>
      <span className="text-[11.5px] font-medium text-[#8A93AD]">{sub}</span>
    </div>
  );
}

function Mini({ etiqueta, valor, alerta = false }: { etiqueta: string; valor: number; alerta?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-[13px] border border-[#E6EAF4] bg-white px-4 py-3">
      <span className="text-[12.5px] font-semibold text-gris">{etiqueta}</span>
      <span className={`text-[18px] font-extrabold tabular-nums ${alerta ? "text-[#C0392B]" : "text-tinta"}`}>{valor}</span>
    </div>
  );
}
