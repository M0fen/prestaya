// Dashboard del panel: foto de la operación (stock: cartera/mora al instante) +
// MOVIMIENTO por período (día/semana/mes/año, con comparativa y serie) +
// tendencias y el bloque proactivo "Aureo ve hoy".
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getResumenFinanciero } from "@/lib/data/asesor";
import { getSerieRecaudo } from "@/lib/data/series";
import { getResumenPeriodo, normalizarPeriodo, PERIODOS } from "@/lib/data/periodo";
import { getRendicionesDia } from "@/lib/data/rendicion";
import { getActivosConPagos } from "@/lib/data/activos";
import { alcanceDelActor } from "@/lib/data/alcance";
import { getLiquidacionDiaria, type LiquidacionDia } from "@/lib/data/liquidacion";
import { getDesempenoRango } from "@/lib/data/desempeno";
import { generarInsights } from "@/lib/insights";
import { conTimeout } from "@/lib/timeout";
import { fechaISOUY } from "@/lib/fecha";
import { UYU, diasSemana, meses } from "@/lib/format";
import { saludoHora, primerNombre } from "@/lib/saludo";
import { BienvenidaCard } from "@/components/BienvenidaCard";
import { Sparkline } from "@/components/charts/Sparkline";
import { Columnas } from "@/components/charts/Columnas";
import { BarrasComparativas } from "@/components/charts/BarrasComparativas";
import { Donut } from "@/components/charts/Donut";
import { AureoInsights } from "@/components/admin/AureoInsights";
import { GuiaAureo } from "@/components/admin/GuiaAureo";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function fechaHoyLarga(d: Date): string {
  return `${diasSemana[d.getDay()]}, ${d.getDate()} de ${meses[d.getMonth()]}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; cobs?: string }>;
}) {
  const usuario = await requireGestor();
  // Cada rol arranca en SU pantalla: el supervisor opera desde "Mi jornada"
  // (su hub del día), no desde el Resumen del negocio. Refuerza la jerarquía si
  // entra por URL directa; el admin sí gobierna desde este dashboard.
  if (!esAdmin(usuario.rol)) redirect("/admin/jornada");
  const admin = esAdmin(usuario.rol);
  const hoy = new Date();
  const db = await createSupabaseServer();
  const sp = await searchParams;
  const periodo = normalizarPeriodo(sp.periodo);
  // "Cobradores": período del ranking (hoy | mes | año). Mes/Año se resuelven con
  // la RPC de agregación (rápida y acotada a la zona); Hoy usa el control en vivo.
  const cobsPeriodo = sp.cobs === "mes" || sp.cobs === "anio" ? sp.cobs : "hoy";

  // Alcance del gestor (admin → todo; supervisor → su zona). Acota la franja de
  // "Control del día" (faltantes/sin-rendir) a lo que ESE gestor debe vigilar.
  const alcance = await alcanceDelActor();
  // Perf: el alcance (para el supervisor implica consultar sus cobradores+clientes)
  // y la cartera activa (RPC) se resuelven UNA vez y se comparten, en vez de que
  // cada función los re-resuelva (antes: alcance ×3 + RPC ×2 → dashboard lento).
  // Tope de tiempo GENEROSO (22s): un cuelgue real del RPC/agregado lanza →
  // lo toma el error.tsx del panel ("Reintentar") en vez de un skeleton eterno.
  // Money-safe: LANZA, nunca degrada a un $0 falso. Una carga legítima (1-5s) ni
  // lo roza.
  const TOPE_MS = 22_000;
  const activos = await conTimeout(getActivosConPagos(db, alcance), TOPE_MS, "dashboard.activos");
  // Base (siempre): cartera/mora/cobradores YA vienen acotadas a la zona del
  // gestor (supervisor → su zona; admin → todo). El "Movimiento" y la serie salen
  // de RPCs de agregado GLOBAL: se muestran SOLO al dueño (para no mezclar zonas).
  // Perf: las 3 tandas (base + serie/mov del dueño + ranking mes/año) son
  // INDEPENDIENTES entre sí → una sola tanda en paralelo (antes: 3 en cascada).
  const hoyYmd = fechaISOUY(hoy);
  const [resumen, liquidacion, rend, serieMov, cobradoresRango] = await conTimeout(
    Promise.all([
      getResumenFinanciero(db, hoy, { alcance, activos }),
      getLiquidacionDiaria(db, hoy, alcance),
      getRendicionesDia(db, hoy, alcance),
      admin
        ? Promise.all([getSerieRecaudo(db, hoy, 14), getResumenPeriodo(db, periodo, hoy)])
        : Promise.resolve([null, null] as [null, null]),
      cobsPeriodo === "hoy"
        ? Promise.resolve(null)
        : getDesempenoRango(
            db,
            { desde: cobsPeriodo === "mes" ? `${hoyYmd.slice(0, 7)}-01` : `${hoyYmd.slice(0, 4)}-01-01`, hasta: hoyYmd },
            alcance,
          ),
    ]),
    TOPE_MS,
    "dashboard.resumen",
  );
  const [serie, mov] = serieMov;
  const reportesNuevos = resumen.reportesNuevos;

  const { cartera, recaudacion, mora, cobradores } = resumen;
  // "Al día" = saldo total − mora EN TÉRMINO − CARTERA VENCIDA (castigo). Antes se
  // restaba solo la mora en término, así que la cartera vencida (deuda de plazo
  // terminado) se pintaba VERDE "Al día" → el dueño veía una cartera "sana" que en
  // realidad es deuda de castigo. Ahora la vencida es su propio gajo.
  const alDia = Math.max(0, cartera.carteraPorCobrar - mora.monto - mora.carteraVencida);

  // ── CONTROL DEL DÍA (anti-fuga, primera plana) ──────────────────────────
  // Las 4 señales de riesgo del dueño, de un vistazo, cada una clickeable a
  // donde se actúa. Todo reusa data ya cargada y acotada a la zona del gestor.
  const faltantes = rend.rendidas.filter((r) => r.diferencia < 0);
  const sinRendir = rend.pendientes; // recaudaron pero no cerraron: float en calle
  const floatCalle = sinRendir.reduce((s, p) => s + p.recaudado, 0);
  const senalesRiesgo =
    faltantes.length + sinRendir.length + mora.criticos + cobradores.alertas.length;

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
    // La serie es un agregado global (solo admin). Para el supervisor, neutra.
    serie: serie
      ? { promedio: serie.promedio, hoy: serie.hoy, tendencia: serie.tendencia }
      : { promedio: 0, hoy: 0, tendencia: 0 },
  });

  const recaudos = serie ? serie.dias.map((d) => d.recaudado) : [];
  const tendPct = serie ? Math.round(serie.tendencia * 100) : 0;
  const varPct = mov && mov.variacionPct !== null ? Math.round(mov.variacionPct * 100) : null;

  // Toggle "Cobradores" (Hoy/Mes/Año): links que preservan el período de Movimiento.
  const cobsHref = (v: "hoy" | "mes" | "anio"): string => {
    const p = new URLSearchParams();
    if (periodo !== "dia") p.set("periodo", periodo);
    if (v !== "hoy") p.set("cobs", v);
    const qs = p.toString();
    return qs ? `/admin?${qs}` : "/admin";
  };
  const topRango = cobradoresRango ? Math.max(1, ...cobradoresRango.cobradores.map((c) => c.recaudado)) : 1;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      {/* Bienvenida cálida (solo la 1ª vez, se puede cerrar). */}
      <BienvenidaCard
        id="admin"
        saludo={`¡Qué bueno verte, ${primerNombre(usuario.nombre)}! 👋`}
        titulo="Este es el pulso de tu negocio."
        cuerpo="De un vistazo ves lo que entró hoy, la mora y cómo va tu equipo. Cuando quieras el paso a paso del día, entrá a Mi jornada."
        cta={{ href: "/admin/tutorial", texto: "Ver cómo se usa" }}
      />

      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[12.5px] font-bold text-azul">
            {saludoHora(hoy)}, {primerNombre(usuario.nombre)} 👋
          </span>
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">
            Resumen de la operación
          </h1>
          <span className="text-[13px] font-medium text-gris capitalize">
            {fechaHoyLarga(hoy)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Foco del día: caer en "Mi jornada" (el hub guiado). CTA primario. */}
          <Link
            href="/admin/jornada"
            className="rounded-full bg-[linear-gradient(135deg,#2453DC,#13308C)] px-4 py-1.5 text-[12.5px] font-extrabold text-white shadow-[0_4px_14px_rgba(19,48,140,0.32)] transition-transform active:scale-95"
          >
            🧭 Ir a Mi jornada →
          </Link>
          {reportesNuevos > 0 && (
            <Link
              href="/admin/clientes"
              className="rounded-full bg-[#FCE8E8] px-3 py-1.5 text-[12.5px] font-bold text-[#C0392B]"
            >
              {reportesNuevos} reporte(s) sin atender
            </Link>
          )}
          {/* Acceso al Centro de alertas (anti-fuga): resalta si hay señales de
              riesgo hoy (faltantes/sin-rendir/mora crítica/anomalías), no solo
              las de vigilancia — así un faltante SÍ enciende el badge. */}
          <Link
            href="/admin/alertas"
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ${
              senalesRiesgo > 0
                ? "bg-[#FBE4E2] text-[#C0392B]"
                : "border border-borde bg-tarjeta text-gris"
            }`}
          >
            🚨 {senalesRiesgo > 0
              ? `${senalesRiesgo} señal(es) de riesgo`
              : "Centro de alertas"}
          </Link>
        </div>
      </div>

      {/* CONTROL DEL DÍA: las señales de fuga/riesgo en primera plana. */}
      <ControlDelDia
        faltantes={faltantes.length}
        montoFaltante={rend.totalFaltante}
        sinRendir={sinRendir.length}
        floatCalle={floatCalle}
        moraCriticos={mora.criticos}
        anomalias={cobradores.alertas.length}
        rendicionesDisponible={rend.disponible}
      />

      {/* Acceso rápido: atajos a las pantallas más usadas (estilo Disapp). */}
      <AccesoRapido admin={admin} />

      {/* Resumen financiero de la cartera (Ventas Crédito), directo, SOLO admin. */}
      {admin && (
        <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-extrabold text-tinta">Ventas Crédito (cartera activa)</h2>
            <Link href="/admin/informe-cartera" className="text-[12px] font-bold text-azul">Ver detalle →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Mini2 etiqueta="Ventas Crédito" valor={UYU(cartera.capitalColocado)} />
            <Mini2 etiqueta="Con Intereses" valor={UYU(cartera.conIntereses)} color="var(--color-verde-osc)" />
            <Mini2 etiqueta="Recaudo" valor={UYU(cartera.recaudadoAcumulado)} color="var(--color-azul)" />
            <Mini2 etiqueta="Cartera Pendiente" valor={UYU(cartera.carteraPorCobrar)} color="var(--color-ambar-osc)" />
            <Mini2
              etiqueta="% Recaudo"
              valor={`${cartera.conIntereses > 0 ? Math.round((cartera.recaudadoAcumulado / cartera.conIntereses) * 1000) / 10 : 0}%`}
              color="var(--color-rojo-osc)"
            />
          </div>
        </section>
      )}

      {/* HÉROE: el recaudo del día LIDERA la pantalla (número grande + sparkline).
          Un solo foco por pantalla: la plata que entró hoy. */}
      <section className="flex flex-col gap-1.5 rounded-[20px] border border-borde bg-tarjeta p-5 shadow-[0_10px_28px_rgba(19,48,140,0.1)]">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-bold tracking-wide text-gris uppercase">Recaudo de hoy</span>
          {serie && serie.tendencia !== 0 && (
            <span className={`rounded-full bg-suave px-2 py-0.5 text-[11.5px] font-bold tabular-nums ${tendPct >= 0 ? "text-verde-osc" : "text-rojo-osc"}`}>
              {tendPct >= 0 ? "▲" : "▼"} {Math.abs(tendPct)}%
            </span>
          )}
        </div>
        <span className="text-[38px] leading-none font-black tabular-nums tracking-[-0.02em] text-verde">{UYU(recaudacion.hoy)}</span>
        {serie && <div className="mt-1"><Sparkline valores={recaudos} color="#1FA971" alto={46} /></div>}
        <span className="text-[12.5px] font-medium text-tenue">
          Mes: <b className="text-cuerpo tabular-nums">{UYU(recaudacion.mes)}</b>
        </span>
      </section>

      {/* Banda secundaria (orden/nombres de Disapp). 2 acentos con significado:
          verde=plata que entra (héroe), rojo=riesgo (mora); el resto tinta neutra. */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <Kpi etiqueta="Total de ventas activas" valor={String(cartera.creditosActivos)} sub="créditos en calle" acento="var(--color-tinta)" />
        <Kpi etiqueta="Por cobrar hoy" valor={UYU(cartera.porCobrarHoy)} sub="cuotas que vencen hoy" acento="var(--color-tinta)" />
        <Kpi etiqueta="Total de clientes" valor={String(cartera.clientesActivos)} sub={`${cartera.deudoresActivos} con crédito activo`} acento="var(--color-tinta)" />
        <Kpi etiqueta="Ventas en mora" valor={String(mora.morosos)} sub={`${UYU(mora.monto)} · ${Math.round(mora.moraPct * 100)}% cartera`} acento="var(--color-rojo)" />
        <Kpi etiqueta="Cartera vencida" valor={String(mora.vencidosCreditos)} sub={`${UYU(mora.carteraVencida)} · plazo terminado`} acento="var(--color-ambar-osc)" />
        <Kpi etiqueta="Capital en calle" valor={UYU(cartera.carteraPorCobrar)} sub="deuda pendiente total" acento="var(--color-tinta)" />
      </div>

      {/* Liquidación diaria por cobrador */}
      <LiquidacionDiaria liq={liquidacion} />

      {/* Aureo ve hoy: la guía del día REAL (IA async, a medida de la zona) +
          las señales automáticas deterministas debajo. */}
      <GuiaAureo />
      <AureoInsights insights={insights} titulo="Además, Aureo nota" />

      {/* MOVIMIENTO por período (día/semana/mes/año) — agregado GLOBAL, solo dueño. */}
      {admin && mov && (
      <section className="rounded-[16px] border border-borde bg-tarjeta p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <h2 className="text-[15px] font-extrabold text-tinta">Movimiento</h2>
            <span className="text-[12px] font-medium text-gris">{mov.etiqueta}</span>
          </div>
          {/* Selector de período (sin JS: navega por query param) */}
          <div className="flex rounded-full bg-suave p-0.5">
            {PERIODOS.map((p) => {
              const activo = p.id === periodo;
              return (
                <Link
                  key={p.id}
                  href={p.id === "dia" ? "/admin" : `/admin?periodo=${p.id}`}
                  className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-colors ${
                    activo ? "bg-tarjeta text-azul shadow-[0_1px_2px_rgba(26,34,71,0.1)]" : "text-gris hover:text-tinta"
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
                <span className="text-[11.5px] font-medium text-tenue">sin base previa</span>
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
          <div className="mt-5 border-t border-linea pt-4">
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
      )}

      {/* Cobradores + mora por antigüedad */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-[16px] border border-borde bg-tarjeta p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-extrabold text-tinta">Cobradores</h2>
            {/* Período del ranking: Hoy (control en vivo) / Este mes / Este año. */}
            <div className="flex rounded-full bg-suave p-0.5">
              {([["hoy", "Hoy"], ["mes", "Este mes"], ["anio", "Este año"]] as const).map(([id, label]) => {
                const activo = cobsPeriodo === id;
                return (
                  <Link
                    key={id}
                    href={cobsHref(id)}
                    className={`rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors ${
                      activo ? "bg-tarjeta text-azul shadow-[0_1px_2px_rgba(26,34,71,0.1)]" : "text-gris hover:text-tinta"
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
          {cobsPeriodo === "hoy" ? (
            <BarrasComparativas
              datos={cobradores.ranking.map((c) => ({
                nombre: c.nombre,
                valor: c.recaudado,
                total: c.esperado,
                sub: `${c.progresoPct}% de la ruta${c.anomalias > 0 ? ` · ${c.anomalias} anomalía(s)` : ""}`,
                alerta: c.anomalias > 0,
              }))}
            />
          ) : cobradoresRango && cobradoresRango.cobradores.length > 0 ? (
            <>
              <BarrasComparativas
                datos={cobradoresRango.cobradores.map((c) => ({
                  nombre: c.nombre,
                  valor: c.recaudado,
                  total: topRango,
                  sub: `${c.cobros} cobros · ${c.diasActivos} día${c.diasActivos === 1 ? "" : "s"} activo${c.diasActivos === 1 ? "" : "s"}`,
                }))}
              />
              <p className="mt-3 text-[11.5px] font-medium text-tenue">
                Total {cobsPeriodo === "mes" ? "del mes" : "del año"}: {UYU(cobradoresRango.totalRecaudado)} ·{" "}
                {cobradoresRango.totalCobros} cobros · {cobradoresRango.cobradoresActivos} cobradores
              </p>
            </>
          ) : (
            <p className="py-6 text-center text-[12.5px] font-medium text-gris">Sin cobros en el período.</p>
          )}
        </section>

        <section className="rounded-[16px] border border-borde bg-tarjeta p-5">
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
        <section className="rounded-[16px] border border-borde bg-tarjeta p-5">
          <h2 className="mb-4 text-[15px] font-extrabold text-tinta">Cartera por cobrar</h2>
          <Donut
            centroValor={UYU(cartera.carteraPorCobrar)}
            centroEtiqueta="saldo total"
            segmentos={[
              { etiqueta: "Al día", valor: alDia, color: "#1FA971" },
              { etiqueta: "En mora", valor: mora.monto, color: "#E8A317" },
              { etiqueta: "Cartera vencida", valor: mora.carteraVencida, color: "#D64545" },
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

/**
 * Franja "Control del día": las 4 señales de riesgo del dueño en primera plana,
 * cada una clickeable a donde se ACTÚA. Marca la lente de necesidad (revela fuga
 * + da control). Cuando todo está limpio, una línea verde calma (sin alarmismo).
 * Todo lo que muestra ya viene acotado a la zona del gestor.
 */
function ControlDelDia({
  faltantes,
  montoFaltante,
  sinRendir,
  floatCalle,
  moraCriticos,
  anomalias,
  rendicionesDisponible,
}: {
  faltantes: number;
  montoFaltante: number;
  sinRendir: number;
  floatCalle: number;
  moraCriticos: number;
  anomalias: number;
  rendicionesDisponible: boolean;
}) {
  const hayRiesgo = faltantes > 0 || sinRendir > 0 || moraCriticos > 0 || anomalias > 0;

  // Todo en orden: reconocerlo, sin ocupar espacio ni gritar.
  if (!hayRiesgo) {
    return (
      <section className="flex items-center gap-2.5 rounded-[14px] border border-[#CFEBDD] bg-[#F1FBF6] px-4 py-3">
        <span className="text-[16px]">🛡️</span>
        <span className="text-[13px] font-bold text-[#157A50]">Control del día: todo en orden.</span>
        <span className="text-[12px] font-medium text-[#4E9E79]">
          {rendicionesDisponible
            ? "Sin faltantes de caja, todos rindieron, sin mora crítica ni anomalías."
            : "Sin mora crítica ni anomalías de cobradores."}
        </span>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-[#F3C9BF] bg-[#FEF6F3] p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[14px] font-extrabold text-tinta">
          🛡️ Control del día
        </span>
        <Link href="/admin/alertas" className="text-[12px] font-bold text-[#C0392B]">
          Centro de alertas →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <ControlTile
          activo={faltantes > 0}
          href="/admin/alertas"
          titulo="Faltantes de caja"
          valor={faltantes}
          sub={faltantes > 0 ? `${UYU(montoFaltante)} sin cuadrar` : "todos cuadran"}
        />
        <ControlTile
          activo={sinRendir > 0}
          href="/admin/alertas"
          titulo="Sin rendir"
          valor={sinRendir}
          sub={sinRendir > 0 ? `${UYU(floatCalle)} en la calle` : "todos rindieron"}
          tono="ambar"
        />
        <ControlTile
          activo={moraCriticos > 0}
          href="/admin/mora"
          titulo="Mora crítica"
          valor={moraCriticos}
          sub={moraCriticos > 0 ? "en alto riesgo de castigo" : "sin mora crítica"}
        />
        <ControlTile
          activo={anomalias > 0}
          href="/admin/alertas"
          titulo="Anomalías"
          valor={anomalias}
          sub={anomalias > 0 ? "conducta de cobrador" : "sin anomalías"}
          tono="ambar"
        />
      </div>
    </section>
  );
}

/** Un tile de la franja de control. Rojo/ámbar si hay señal, apagado si 0. */
function ControlTile({
  activo,
  href,
  titulo,
  valor,
  sub,
  tono = "rojo",
}: {
  activo: boolean;
  href: string;
  titulo: string;
  valor: number;
  sub: string;
  tono?: "rojo" | "ambar";
}) {
  const c = activo
    ? tono === "rojo"
      ? { bg: "#FFFFFF", bd: "#F3C0B8", fg: "#C0392B" }
      : { bg: "#FFFFFF", bd: "#F0D9A8", fg: "#B9770E" }
    : { bg: "#FBFCFE", bd: "#E7ECF5", fg: "#8A93AC" };
  return (
    <Link
      href={href}
      className="flex flex-col gap-0.5 rounded-[13px] border px-3.5 py-3 transition-shadow hover:shadow-[0_2px_10px_rgba(0,0,0,0.06)]"
      style={{ background: c.bg, borderColor: c.bd }}
    >
      <span className="text-[11px] font-bold uppercase tracking-wide text-gris">{titulo}</span>
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[22px] font-extrabold tabular-nums" style={{ color: c.fg }}>
          {valor}
        </span>
        {activo && <span className="text-[12px] font-bold" style={{ color: c.fg }}>Ver →</span>}
      </div>
      <span className="text-[11px] font-medium text-tenue">{sub}</span>
    </Link>
  );
}

/** Atajos a las pantallas más usadas (estilo "Acceso rápido" de Disapp). */
function AccesoRapido({ admin }: { admin: boolean }) {
  const items: { href: string; label: string; icon: string; soloAdmin?: boolean }[] = [
    { href: "/admin/informe-cartera", label: "Ventas Crédito", icon: "💳", soloAdmin: true },
    { href: "/admin/cobranza", label: "Cobros del día", icon: "🛡️" },
    { href: "/admin/caja", label: "Caja diaria", icon: "💰" },
    { href: "/admin/recaudos", label: "Recaudos", icon: "💵" },
    { href: "/admin/alertas", label: "Alertas", icon: "🚨" },
    { href: "/admin/recibos", label: "Recibos", icon: "🧾", soloAdmin: true },
    { href: "/admin/clientes", label: "Clientes", icon: "👤" },
    { href: "/admin/para-clientes", label: "Para tus clientes", icon: "🎯", soloAdmin: true },
  ].filter((i) => admin || !i.soloAdmin);
  return (
    <section className="flex flex-col gap-2">
      <span className="text-[12px] font-bold uppercase tracking-wide text-gris">Acceso rápido</span>
      <div className="flex flex-wrap gap-2.5">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className="flex min-w-[92px] flex-1 flex-col items-center gap-1.5 rounded-[16px] border border-borde bg-tarjeta px-3 py-3 text-center hover:bg-suave"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-[#EEF3FF] text-[17px]">
              {i.icon}
            </span>
            <span className="text-[11.5px] font-bold text-cuerpo leading-tight">{i.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Mini-estadística compacta para el resumen de cartera. */
function Mini2({ etiqueta, valor, color = "var(--color-tinta)" }: { etiqueta: string; valor: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[13px] bg-suave p-3">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-tenue">{etiqueta}</span>
      <span className="text-[17px] font-extrabold tabular-nums" style={{ color }}>{valor}</span>
    </div>
  );
}

function Kpi({ etiqueta, valor, sub, acento }: { etiqueta: string; valor: string; sub: string; acento: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[16px] border border-borde bg-tarjeta p-4">
      <span className="text-[11.5px] font-bold tracking-wide text-gris uppercase">{etiqueta}</span>
      <span className="text-[23px] leading-tight font-extrabold tabular-nums tracking-[-0.02em]" style={{ color: acento }}>{valor}</span>
      <span className="text-[12px] font-medium text-tenue">{sub}</span>
    </div>
  );
}

function Tile({ etiqueta, valor, sub, acento = "var(--color-tinta)" }: { etiqueta: string; valor: string; sub: string; acento?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[13px] bg-suave p-3.5">
      <span className="text-[11px] font-bold tracking-wide text-gris uppercase">{etiqueta}</span>
      <span className="text-[20px] font-extrabold tabular-nums tracking-[-0.02em]" style={{ color: acento }}>{valor}</span>
      <span className="text-[11.5px] font-medium text-tenue">{sub}</span>
    </div>
  );
}

function Mini({ etiqueta, valor, alerta = false }: { etiqueta: string; valor: number; alerta?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-[13px] border border-borde bg-tarjeta px-4 py-3">
      <span className="text-[12.5px] font-semibold text-gris">{etiqueta}</span>
      <span className={`text-[18px] font-extrabold tabular-nums ${alerta ? "text-[#C0392B]" : "text-tinta"}`}>{valor}</span>
    </div>
  );
}

/** Tabla "Liquidación diaria" por cobrador (paridad Disapp). */
function LiquidacionDiaria({ liq }: { liq: LiquidacionDia }) {
  const cellNum = "px-3 py-2.5 text-right tabular-nums";
  return (
    <section className="rounded-[16px] border border-borde bg-tarjeta p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="text-[15px] font-extrabold text-tinta">Liquidación diaria</h2>
          <span className="text-[12px] font-medium text-gris">
            {liq.cajasCerradas}/{liq.totalCobradores} cajas cerradas
            {!liq.disponibleRendiciones && " · (estado no disponible)"}
          </span>
        </div>
        <div className="flex gap-5">
          <div className="flex flex-col items-end">
            {/* "En ruta" (por cobrador) para distinguirlo del hero "Recaudo de hoy",
                que incluye oficina/panel. Antes decía "Recaudo total" y engañaba. */}
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-gris">Recaudo en ruta</span>
            <span className="text-[16px] font-extrabold tabular-nums text-verde">{UYU(liq.recaudoTotal)}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-gris">Caja final total</span>
            <span className="text-[16px] font-extrabold tabular-nums text-tinta">{UYU(liq.cajaFinalTotal)}</span>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-linea text-[11px] font-bold uppercase tracking-wide text-gris">
              <th className="px-3 py-2 text-left">Vendedor</th>
              <th className="px-3 py-2 text-right">Base</th>
              <th className="px-3 py-2 text-right">Visitas</th>
              <th className="px-3 py-2 text-right">Recaudo</th>
              <th className="px-3 py-2 text-right">Retiros</th>
              <th className="px-3 py-2 text-right">Ventas</th>
              <th className="px-3 py-2 text-right">Caja final</th>
              <th className="px-3 py-2 text-center">Estado</th>
            </tr>
          </thead>
          <tbody>
            {liq.filas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-[13px] font-medium text-gris">
                  Sin cobradores con actividad hoy.
                </td>
              </tr>
            )}
            {liq.filas.map((f) => (
              <tr key={f.cobradorId} className="border-b border-[#F4F6FB] last:border-0">
                <td className="px-3 py-2.5 font-semibold text-tinta">{f.nombre}</td>
                <td className={`${cellNum} text-gris`}>{f.base === null ? "—" : UYU(f.base)}</td>
                <td className={`${cellNum} text-gris`}>{f.visitas}</td>
                <td className={`${cellNum} font-bold text-verde`}>{UYU(f.recaudo)}</td>
                <td className={`${cellNum} text-gris`}>{f.retiros > 0 ? UYU(f.retiros) : "—"}</td>
                <td className={`${cellNum} text-gris`}>{f.ventas}</td>
                <td className={`${cellNum} font-bold text-tinta`}>{UYU(f.cajaFinal)}</td>
                <td className="px-3 py-2.5 text-center">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      f.estado === "cerrada"
                        ? "bg-[#E7F6EF] text-[#157A50]"
                        : "bg-[#FBF1DC] text-[#9A6A0E]"
                    }`}
                  >
                    {f.estado === "cerrada" ? "Cerrada" : "Abierta"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
