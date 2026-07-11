// ─────────────────────────────────────────────────────────────────────────
//  "Mi jornada" — el flujo guiado del SUPERVISOR (y admin) en 3 actos:
//  Apertura (armá el día) · En vivo (la zona ahora) · Cierre (cuadrá la caja).
//  NO reemplaza las pantallas: las ORQUESTA. Cada acto muestra lo justo + un
//  botón que lleva a donde se ACTÚA (Mora / Cobranza / Caja / Chat). Reusa la
//  misma data ya acotada a la zona del gestor (getResumenFinanciero /
//  getRendicionesDia / getCentroAlertas) → un supervisor ve solo lo suyo.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { requireGestor, getActorActual } from "@/lib/auth";
import { puedeVerZona } from "@/lib/permisos";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getResumenFinanciero } from "@/lib/data/asesor";
import { getCierrePorZona, type ResumenCierreZonas } from "@/lib/data/cierreZona";
import { getCentroAlertas, type Alerta } from "@/lib/data/centroAlertas";
import { getResumenCompromisos, type ResumenCompromisos } from "@/lib/data/gestionesCobranza";
import { getActivosConPagos } from "@/lib/data/activos";
import { getControlCobranza, type RankingCobrador } from "@/lib/data/control";
import { getRendicionesDia } from "@/lib/data/rendicion";
import { getDesempenoRango, type DesempenoRango } from "@/lib/data/desempeno";
import { alcanceDelActor } from "@/lib/data/alcance";
import { navVisible } from "@/lib/admin/nav";
import { UYU, diasSemana, meses } from "@/lib/format";
import { fechaISOUY, sumarDiasYmd } from "@/lib/fecha";
import { BarrasComparativas } from "@/components/charts/BarrasComparativas";
import { CierrePorZona } from "@/components/admin/CierrePorZona";
import { AvisarCobrador } from "@/components/admin/AvisarCobrador";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

type Acto = "apertura" | "vivo" | "cierre";
const ACTOS: { id: Acto; n: number; label: string; icon: string; cuando: string }[] = [
  { id: "apertura", n: 1, label: "Apertura", icon: "🌅", cuando: "temprano" },
  { id: "vivo", n: 2, label: "En vivo", icon: "🛰️", cuando: "durante el día" },
  { id: "cierre", n: 3, label: "Cierre", icon: "🌙", cuando: "al cierre" },
];

function horaMontevideo(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Montevideo", hour: "2-digit", hourCycle: "h23" }).format(
      new Date(),
    ),
  );
}

export default async function JornadaPage({
  searchParams,
}: {
  searchParams: Promise<{ acto?: string; fecha?: string }>;
}) {
  const usuario = await requireGestor();
  const db = await createSupabaseServer();
  const alcance = await alcanceDelActor();
  // Herramientas del día visibles para este rol (para el launchpad unificado).
  const toolHrefs = new Set(navVisible(usuario.rol, usuario.es_dev).map((i) => i.href));
  const sp = await searchParams;

  // Fecha de la jornada: ?fecha=YYYY-MM-DD (default HOY; nunca futuro). Con una
  // fecha pasada, "Mi jornada" muestra el HISTORIAL de ese día (solo lectura).
  const hoyYmd = fechaISOUY();
  const pedida = /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha ?? "") ? (sp.fecha as string) : hoyYmd;
  const fechaYmd = pedida > hoyYmd ? hoyYmd : pedida;
  const esHoy = fechaYmd === hoyYmd;

  // Nombre de la zona (etiqueta): `zonas` está bajo RLS para el gestor con zona,
  // así que se resuelve con el cliente admin (igual que en la app del cobrador).
  const zonaNombre = usuario.zona_id
    ? (await createSupabaseAdmin().from("zonas").select("nombre").eq("id", usuario.zona_id).maybeSingle()).data
        ?.nombre ?? null
    : null;

  // Etiqueta larga de la fecha elegida.
  const [fy, fm, fd] = fechaYmd.split("-").map(Number);
  const fechaCal = new Date(fy, fm - 1, fd);
  const fechaLarga = `${diasSemana[fechaCal.getDay()]} ${fechaCal.getDate()} de ${meses[fechaCal.getMonth()]}`;

  // ── HISTORIAL (día pasado): foto de SOLO LECTURA, sin el motor "en vivo" (caro
  //    y solo con sentido para hoy). Reusa la capa de desempeño, acotada a ese día. ──
  if (!esHoy) {
    const dia = await getDesempenoRango({ desde: fechaYmd, hasta: fechaYmd }, alcance);
    return (
      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta capitalize">
              Historial · {fechaLarga}
            </h1>
            <span className="text-[13px] font-medium text-gris">
              {zonaNombre ? `Zona ${zonaNombre} · ` : ""}foto de ese día (solo lectura)
            </span>
          </div>
          <Link
            href="/admin/desempeno"
            className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[12.5px] font-bold text-gris"
          >
            Desempeño por rango →
          </Link>
        </header>
        <DateBar fechaYmd={fechaYmd} hoyYmd={hoyYmd} />
        <HerramientasDia hrefs={toolHrefs} />
        <HistorialDia dia={dia} />
      </div>
    );
  }

  // ── HOY: motor en vivo. PERF — las 3 primitivas caras (RPC de cartera activa,
  //    control de cobranza y rendiciones) se computan UNA sola vez y se comparten
  //    entre resumen/cierre/alertas (antes cada una se recomputaba → ~2× el tiempo). ──
  const hoy = new Date();
  const actor = await getActorActual();
  const activos = await getActivosConPagos(db, alcance);
  const [control, rend] = await Promise.all([
    getControlCobranza(db, hoy, activos, alcance),
    getRendicionesDia(db, hoy, alcance),
  ]);
  const [resumen, cierre, centro, compromisos] = await Promise.all([
    getResumenFinanciero(db, hoy, { alcance, activos, control }),
    getCierrePorZona(db, hoy, alcance, rend),
    getCentroAlertas(db, hoy, alcance, { control, rend }),
    getResumenCompromisos(db, alcance, hoy),
  ]);
  const { cartera, recaudacion, mora, cobradores } = resumen;
  // Zonas que este gestor puede sellar (supervisor de la zona; admin todas).
  const cerrables = actor
    ? cierre.consolidado.zonas.filter((z) => z.zonaId && puedeVerZona(actor, z.zonaId)).map((z) => z.zonaId as string)
    : [];

  const hora = horaMontevideo();
  const saludo = hora < 12 ? "Buen día" : hora < 19 ? "Buenas tardes" : "Buenas noches";
  const primerNombre =
    (usuario.nombre ?? "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
      .join(" ")
      .trim() || "supervisor";

  // Acto por defecto según la hora (mañana=apertura, tarde=en vivo, noche=cierre),
  // sobreescribible por ?acto= (navegación sin JS, como el selector de período).
  const pedido = sp.acto;
  const actoDefault: Acto = hora < 12 ? "apertura" : hora < 18 ? "vivo" : "cierre";
  const acto: Acto = (["apertura", "vivo", "cierre"] as const).includes(pedido as Acto)
    ? (pedido as Acto)
    : actoDefault;

  // ── Señales del cierre, derivadas del consolidado (sin re-consultar rendiciones) ──
  const cons = cierre.consolidado;
  const faltantesN = cons.zonas.reduce(
    (s, z) => s + z.cobradores.filter((c) => c.estado === "faltante").length,
    0,
  );
  const sinRendirN = cons.pendientes;
  const floatCalle = cons.porRendir;
  const esperadoTotal = cobradores.ranking.reduce((s, c) => s + c.esperado, 0);
  const cobradoRuta = cobradores.ranking.reduce((s, c) => s + c.recaudado, 0);
  const avancePct = esperadoTotal > 0 ? Math.min(100, Math.round((cobradoRuta / esperadoTotal) * 100)) : 0;
  const alertasAltas = centro.conteo.alta;
  // Clientes listos para renovar (avance ≥ 75%) — oportunidad de colocar. Barato:
  // sale del `activos` YA cargado (pagado/total), sin consultas extra.
  const renovables = activos.filter((a) => {
    const total = Number(a.cuota_diaria) * Number(a.total_dias);
    return total > 0 && Number(a.pagado) / total >= 0.75;
  }).length;

  return (
    <div className="flex flex-col gap-5">
      {/* Encabezado personalizado */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">
            {saludo}, {primerNombre}
          </h1>
          <span className="text-[13px] font-medium text-gris capitalize">
            {zonaNombre ? `Zona ${zonaNombre} · ` : ""}
            {fechaLarga} · tu jornada en 3 momentos
          </span>
        </div>
        <Link href="/admin" className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[12.5px] font-bold text-gris">
          Ver tablero completo →
        </Link>
      </div>

      {/* Navegación por fecha: revivir la jornada de cualquier día pasado. */}
      <DateBar fechaYmd={fechaYmd} hoyYmd={hoyYmd} />

      {/* Concentrado de la zona: el pulso de tu operación, en una fracción, siempre visible. */}
      <ResumenZona
        capitalEnCalle={cartera.carteraPorCobrar}
        morosos={mora.morosos}
        montoMora={mora.monto}
        moraPct={mora.moraPct}
        recaudadoHoy={recaudacion.hoy}
        clientes={cartera.deudoresActivos}
        creditos={cartera.creditosActivos}
      />

      {/* Launchpad: las herramientas del día, todas en un toque (todo en un solo sitio). */}
      <HerramientasDia hrefs={toolHrefs} />

      {/* Stepper de los 3 actos (guía del día) */}
      <nav className="grid grid-cols-3 gap-2">
        {ACTOS.map((a) => {
          const activo = a.id === acto;
          const chip =
            a.id === "apertura"
              ? faltantesN + sinRendirN + mora.criticos + compromisos.venceHoy.length + compromisos.incumplidos.length
              : a.id === "vivo"
                ? alertasAltas
                : sinRendirN;
          return (
            <Link
              key={a.id}
              href={`/admin/jornada?acto=${a.id}`}
              className={`flex flex-col gap-1 rounded-[15px] border p-3 transition-all ${
                activo
                  ? "acto-activo border-azul shadow-[0_6px_20px_rgba(30,71,200,0.16)]"
                  : "border-borde bg-tarjeta hover:bg-suave hover:shadow-[0_2px_10px_rgba(15,27,61,0.06)]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-bold uppercase tracking-wide ${activo ? "text-azul" : "text-tenue"}`}>
                  Acto {a.n}
                </span>
                {chip > 0 && (
                  <span className="rounded-full bg-[#FBE4E2] px-1.5 py-0.5 text-[10px] font-bold text-[#C0392B] tabular-nums">
                    {chip}
                  </span>
                )}
              </div>
              <span className={`text-[14px] font-extrabold ${activo ? "text-tinta" : "text-cuerpo"}`}>
                {a.icon} {a.label}
              </span>
              <span className={`text-[10.5px] font-medium ${activo ? "text-azul/70" : "text-tenue"}`}>{a.cuando}</span>
            </Link>
          );
        })}
      </nav>

      {acto === "apertura" && (
        <Apertura
          moraCriticos={mora.criticos}
          moraMonto={mora.monto}
          morosos={mora.morosos}
          porCobrarHoy={cartera.porCobrarHoy}
          faltantes={faltantesN}
          montoFaltante={cons.totalFaltante}
          sinRendir={sinRendirN}
          floatCalle={floatCalle}
          rendicionesDisponible={cierre.disponible}
          compromisos={compromisos}
          renovables={renovables}
        />
      )}
      {acto === "vivo" && (
        <EnVivo
          cobradoRuta={cobradoRuta}
          esperadoTotal={esperadoTotal}
          avancePct={avancePct}
          recaudadoHoy={recaudacion.hoy}
          ranking={control.ranking}
          alertas={centro.alertas}
        />
      )}
      {acto === "cierre" && <Cierre cierre={cierre} cerrables={cerrables} />}
    </div>
  );
}

/* ── ACTO 1 · APERTURA ─────────────────────────────────────────────────── */
function Apertura({
  moraCriticos,
  moraMonto,
  morosos,
  porCobrarHoy,
  faltantes,
  montoFaltante,
  sinRendir,
  floatCalle,
  rendicionesDisponible,
  compromisos,
  renovables,
}: {
  moraCriticos: number;
  moraMonto: number;
  morosos: number;
  porCobrarHoy: number;
  faltantes: number;
  montoFaltante: number;
  sinRendir: number;
  floatCalle: number;
  rendicionesDisponible: boolean;
  compromisos: ResumenCompromisos;
  renovables: number;
}) {
  const hayPendiente = faltantes > 0 || sinRendir > 0;
  const hayCompromisos =
    compromisos.venceHoy.length > 0 || compromisos.incumplidos.length > 0 || compromisos.vigentes > 0 || compromisos.cumplidosHoy > 0;
  const montoVenceHoy = compromisos.venceHoy.reduce((s, c) => s + c.monto, 0);
  const montoIncumplido = compromisos.incumplidos.reduce((s, c) => s + Math.max(0, c.monto - c.pagadoDesde), 0);
  return (
    <div className="flex flex-col gap-4">
      <Encabezado
        titulo="Arrancá el día"
        bajada="Revisá lo que quedó pendiente y decidí a quién hay que cobrar hoy, antes de que salga el equipo."
      />

      {/* Instrumentos del supervisor: las acciones del día, a un toque. */}
      <div className="grid grid-cols-3 gap-2">
        <AccionRapida href="/admin/chat" icon="💬" label="Avisar al equipo" sub="mensaje a cobradores" />
        <AccionRapida href="/admin/mora" icon="✍️" label="Registrar gestión" sub="compromiso de pago" />
        <AccionRapida href="/admin/desempeno" icon="🏆" label="Desempeño" sub="últimos 7 días" />
      </div>

      {/* Compromisos de pago (mini-CRM) — auto-verificados contra el libro de pagos. */}
      {hayCompromisos && (
        <Panel
          titulo="Compromisos de pago"
          href="/admin/mora"
          cta="Ir a Mora →"
          tono={compromisos.incumplidos.length > 0 ? "rojo" : compromisos.venceHoy.length > 0 ? "ambar" : "neutro"}
        >
          <div className="grid grid-cols-3 gap-2.5">
            <DatoGrande
              activo={compromisos.venceHoy.length > 0}
              etiqueta="Vencen hoy"
              valor={String(compromisos.venceHoy.length)}
              sub={compromisos.venceHoy.length > 0 ? `${UYU(montoVenceHoy)} prometidos` : "ninguno hoy"}
              tono="ambar"
            />
            <DatoGrande
              activo={compromisos.incumplidos.length > 0}
              etiqueta="Incumplidos"
              valor={String(compromisos.incumplidos.length)}
              sub={compromisos.incumplidos.length > 0 ? `${UYU(montoIncumplido)} sin pagar` : "ninguno"}
            />
            <DatoGrande
              etiqueta="Cumplidos"
              valor={String(compromisos.cumplidosHoy)}
              sub={`${compromisos.vigentes} vigente(s)`}
              tono="azul"
            />
          </div>
          <p className="mt-3 text-[12px] font-medium text-gris">
            El sistema verifica solo contra los pagos: si prometió y no pagó, aparece en <b className="text-tinta">Incumplidos</b>.
          </p>
        </Panel>
      )}

      {/* Lo que quedó abierto de la caja */}
      {hayPendiente ? (
        <Panel titulo="Quedó abierto de la caja" href="/admin/alertas" cta="Centro de alertas →" tono="rojo">
          <div className="grid grid-cols-2 gap-2.5">
            <DatoGrande
              activo={faltantes > 0}
              etiqueta="Faltantes"
              valor={String(faltantes)}
              sub={faltantes > 0 ? `${UYU(montoFaltante)} sin cuadrar` : "todos cuadran"}
            />
            <DatoGrande
              activo={sinRendir > 0}
              etiqueta="Sin rendir"
              valor={String(sinRendir)}
              sub={sinRendir > 0 ? `${UYU(floatCalle)} en la calle` : "todos rindieron"}
              tono="ambar"
            />
          </div>
        </Panel>
      ) : (
        <LineaCalma texto={rendicionesDisponible ? "La caja de ayer quedó limpia: sin faltantes ni float en la calle." : "Sin señales de caja abiertas."} />
      )}

      {/* Plan de cobranza del día */}
      <Panel titulo="A quién cobrar hoy" href="/admin/mora" cta="Ver mora y avisar →" tono="neutro">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
          <DatoGrande
            activo={moraCriticos > 0}
            etiqueta="Mora crítica"
            valor={String(moraCriticos)}
            sub={moraCriticos > 0 ? "16+ días · priorizar" : "sin mora crítica"}
          />
          <DatoGrande etiqueta="En mora" valor={String(morosos)} sub={`${UYU(moraMonto)} vencido`} />
          <DatoGrande etiqueta="Por cobrar hoy" valor={UYU(porCobrarHoy)} sub="cuotas que vencen" tono="azul" />
        </div>
        <p className="mt-3 text-[12px] font-medium text-gris">
          Entrá a <b className="text-tinta">Mora</b> para priorizar y dejarle a cada cobrador el mensaje de a quién visitar.
        </p>
      </Panel>

      {/* Oportunidad de colocación: clientes que ya casi terminan su crédito. */}
      {renovables > 0 && (
        <Link
          href="/admin/renovaciones"
          className="flex items-center justify-between gap-2 rounded-[14px] border border-borde bg-suave px-4 py-3 hover:bg-tarjeta"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-[18px]">🔄</span>
            <div className="flex flex-col">
              <span className="text-[13px] font-extrabold text-tinta">
                {renovables} cliente{renovables === 1 ? "" : "s"} listo{renovables === 1 ? "" : "s"} para renovar
              </span>
              <span className="text-[11.5px] font-medium text-gris">
                Avance ≥ 75% — oportunidad de colocar un nuevo crédito.
              </span>
            </div>
          </div>
          <span className="flex-shrink-0 text-[12px] font-bold text-azul">Renovar →</span>
        </Link>
      )}

      <Siguiente href="/admin/jornada?acto=vivo" texto="Cuando el equipo salga, seguí en “En vivo”" />
    </div>
  );
}

/* ── ACTO 2 · EN VIVO ──────────────────────────────────────────────────── */
function EnVivo({
  cobradoRuta,
  esperadoTotal,
  avancePct,
  recaudadoHoy,
  ranking,
  alertas,
}: {
  cobradoRuta: number;
  esperadoTotal: number;
  avancePct: number;
  recaudadoHoy: number;
  ranking: RankingCobrador[];
  alertas: Alerta[];
}) {
  const faltaMeta = Math.max(0, esperadoTotal - cobradoRuta);
  // Cobradores que necesitan atención: van por debajo de la mitad de su ruta o
  // tienen anomalías. Ordenados peor-primero. Cada uno con un aviso a un toque.
  const atencion = ranking
    .filter((c) => c.esperado > 0 && (c.progreso < 0.5 || c.anomalias > 0))
    .sort((a, b) => a.progreso - b.progreso);
  return (
    <div className="flex flex-col gap-4">
      <Encabezado
        titulo="La zona, ahora"
        bajada="Mirá cómo avanza la ruta mientras los cobradores están en la calle. Lo que dispara señal, arriba."
      />

      {/* Meta del día: avance vs esperado + cuánto falta. */}
      <section className="rounded-[16px] bg-[linear-gradient(155deg,#173063_0%,#0F1B3D_60%)] p-4 text-white shadow-[0_10px_24px_rgba(15,27,61,0.28)]">
        <div className="mb-2 flex items-end justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Cobrado en ruta hoy</span>
            <span className="text-[27px] font-black leading-tight tabular-nums">{UYU(cobradoRuta)}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[12px] font-bold tabular-nums text-white/80">{avancePct}%</span>
            <span className="text-[11px] font-medium text-white/50">meta {UYU(esperadoTotal)}</span>
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/12">
          <div className="h-full rounded-full bg-[linear-gradient(90deg,#34E0A1,#1FA971)]" style={{ width: `${avancePct}%` }} />
        </div>
        <p className="mt-2.5 text-[11.5px] font-medium text-white/60">
          {faltaMeta > 0 ? (
            <>Faltan <b className="text-white">{UYU(faltaMeta)}</b> para la meta del día (si cobran la cuota de cada cliente).</>
          ) : (
            <>Meta del día cubierta. 🎯</>
          )}{" "}
          Recaudo total (incl. cerrados): {UYU(recaudadoHoy)}.
        </p>
      </section>

      {/* Cobradores que necesitan atención + aviso directo a su chat. */}
      {atencion.length > 0 && (
        <Panel titulo="Necesitan atención" href="/admin/campo" cta="Ver control de campo →" tono="rojo">
          <ul className="flex flex-col gap-2">
            {atencion.slice(0, 6).map((c) => (
              <li key={c.cobradorId} className="flex flex-col gap-1.5 rounded-[12px] border border-borde bg-tarjeta px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-bold text-tinta">{c.nombre}</span>
                    <span className="text-[11.5px] font-medium text-gris">
                      {Math.round(c.progreso * 100)}% de la ruta · {UYU(c.recaudado)} de {UYU(c.esperado)}
                      {c.anomalias > 0 ? ` · ${c.anomalias} anomalía(s)` : ""}
                    </span>
                  </div>
                  <AvisarCobrador cobradorId={c.cobradorId} nombre={c.nombre} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Ranking de cobradores */}
      <Panel titulo="Cobradores hoy" href="/admin/cobranza" cta="Ver mapa de cobros →" tono="neutro">
        {ranking.length > 0 ? (
          <BarrasComparativas
            datos={ranking.map((c) => ({
              nombre: c.nombre,
              valor: c.recaudado,
              total: c.esperado,
              sub: `${Math.round(c.progreso * 100)}% de la ruta${c.anomalias > 0 ? ` · ${c.anomalias} anomalía(s)` : ""}`,
              alerta: c.anomalias > 0,
            }))}
          />
        ) : (
          <p className="py-6 text-center text-[12.5px] font-medium text-gris">Todavía no hay actividad de cobradores hoy.</p>
        )}
      </Panel>

      {/* Alertas del día */}
      <Panel titulo="Señales del día" href="/admin/alertas" cta="Centro de alertas →" tono={alertas.length > 0 ? "rojo" : "neutro"}>
        {alertas.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {alertas.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-start gap-2.5 rounded-[12px] bg-suave px-3 py-2.5">
                <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${a.severidad === "alta" ? "bg-[#D64545]" : a.severidad === "media" ? "bg-[#E8A317]" : "bg-[#9AA3BC]"}`} />
                <div className="flex flex-col">
                  <span className="text-[12.5px] font-bold text-tinta">{a.titulo}</span>
                  <span className="text-[11.5px] font-medium text-gris">{a.categoria} · {a.detalle}</span>
                </div>
              </li>
            ))}
            {alertas.length > 5 && (
              <li className="text-center text-[12px] font-bold text-azul">
                <Link href="/admin/alertas">+ {alertas.length - 5} señal(es) más →</Link>
              </li>
            )}
          </ul>
        ) : (
          <p className="py-4 text-center text-[12.5px] font-medium text-verde">Sin señales de riesgo por ahora. 🛡️</p>
        )}
      </Panel>

      <Siguiente href="/admin/jornada?acto=cierre" texto="Cuando vuelvan los cobradores, pasá a “Cierre”" />
    </div>
  );
}

/* ── ACTO 3 · CIERRE (cuadre de caja) ──────────────────────────────────── */
function Cierre({ cierre, cerrables }: { cierre: ResumenCierreZonas; cerrables: string[] }) {
  const c = cierre.consolidado;
  const diferencia = c.totalSobrante - c.totalFaltante;
  return (
    <div className="flex flex-col gap-4">
      <Encabezado
        titulo="Cerrá el día"
        bajada="Recibí el efectivo de cada cobrador, revisá que cuadre y sellá el cierre de tu zona."
      />

      {!cierre.disponible ? (
        <LineaCalma texto="El cierre de jornada necesita la migración de rendición (0013)." />
      ) : (
        <>
          {/* Cuadre de un vistazo: recaudado − gastos = esperado → entregado → diferencia. */}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <TotalCierre etiqueta="Recaudado" valor={UYU(c.totalRecaudado)} color="#157A50" />
            <TotalCierre etiqueta="Entregado" valor={UYU(c.totalEntregado)} color="#1E47C8" />
            <TotalCierre
              etiqueta={c.totalFaltante > 0 ? "Faltante" : "Diferencia"}
              valor={c.totalFaltante > 0 ? UYU(c.totalFaltante) : UYU(diferencia)}
              color={c.totalFaltante > 0 ? "#C0392B" : diferencia > 0 ? "#B9770E" : "#157A50"}
            />
            <TotalCierre etiqueta="Por rendir" valor={UYU(c.porRendir)} color={c.porRendir > 0 ? "#B9770E" : "#8A93AC"} />
          </div>

          {/* Efectivo que el supervisor consolida y entrega a caja central. */}
          <div className="flex items-center justify-between overflow-hidden rounded-[16px] bg-[linear-gradient(150deg,#1E47C8_0%,#13308C_60%,#0F1B3D_100%)] px-4 py-3.5 text-white shadow-[0_10px_24px_rgba(15,27,61,0.28)]">
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/55">Efectivo a caja central</span>
              <span className="text-[11.5px] font-medium text-white/60">
                {c.rendidos} rindi{c.rendidos === 1 ? "ó" : "eron"}
                {c.pendientes > 0 ? ` · ${c.pendientes} en la calle` : " · todos entregaron"}
              </span>
            </div>
            <span className="text-[24px] font-black tabular-nums">{UYU(c.totalEntregado)}</span>
          </div>

          {/* Worksheet de cuadre por zona + sello de custodia (reusa el de Caja). */}
          <CierrePorZona resumen={cierre} cerrables={cerrables} />
        </>
      )}
    </div>
  );
}

/* ── Concentrado de la zona (pulso, siempre visible) ───────────────────── */
function ResumenZona({
  capitalEnCalle,
  morosos,
  montoMora,
  moraPct,
  recaudadoHoy,
  clientes,
  creditos,
}: {
  capitalEnCalle: number;
  morosos: number;
  montoMora: number;
  moraPct: number;
  recaudadoHoy: number;
  clientes: number;
  creditos: number;
}) {
  return (
    <section className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      <PulsoTile etiqueta="Capital en calle" valor={UYU(capitalEnCalle)} sub={`${creditos} créditos activos`} color="#7A4DD6" />
      <PulsoTile etiqueta="Recaudado hoy" valor={UYU(recaudadoHoy)} sub="cobrado en tu zona" color="#157A50" />
      <PulsoTile
        etiqueta="En mora"
        valor={String(morosos)}
        sub={`${UYU(montoMora)} · ${Math.round(moraPct * 100)}% cartera`}
        color={morosos > 0 ? "#C0392B" : "#8A93AC"}
      />
      <PulsoTile etiqueta="Clientes" valor={String(clientes)} sub="con crédito activo" color="#1E47C8" />
    </section>
  );
}

function PulsoTile({ etiqueta, valor, sub, color }: { etiqueta: string; valor: string; sub: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] border border-borde bg-tarjeta p-3.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-gris">{etiqueta}</span>
      <span className="text-[19px] font-extrabold tabular-nums" style={{ color }}>
        {valor}
      </span>
      <span className="text-[11px] font-medium text-tenue">{sub}</span>
    </div>
  );
}

/* ── Launchpad: herramientas del día (todo en un solo sitio) ───────────── */
const TOOLS: { href: string; label: string; icon: string }[] = [
  { href: "/admin/mora", label: "Mora", icon: "⏰" },
  { href: "/admin/cobranza", label: "Cobranza", icon: "🛡️" },
  { href: "/admin/recaudos", label: "Recaudos", icon: "💵" },
  { href: "/admin/caja", label: "Caja", icon: "💰" },
  { href: "/admin/desempeno", label: "Desempeño", icon: "🏆" },
  { href: "/admin/alertas", label: "Alertas", icon: "🚨" },
  { href: "/admin/campo", label: "Campo", icon: "🛰️" },
  { href: "/admin/renovaciones", label: "Renovar", icon: "🔄" },
  { href: "/admin/anulaciones", label: "Anular", icon: "🚫" },
  { href: "/admin/clientes", label: "Clientes", icon: "👤" },
  { href: "/admin/chat", label: "Chat", icon: "💬" },
];

function HerramientasDia({ hrefs }: { hrefs: Set<string> }) {
  const items = TOOLS.filter((t) => hrefs.has(t.href));
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <span className="px-0.5 text-[12px] font-bold uppercase tracking-wide text-gris">Herramientas del día</span>
      <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
        {items.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="flex flex-col items-center gap-1.5 rounded-[14px] border border-borde bg-tarjeta py-3 transition-transform hover:bg-suave active:scale-95"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-[#EEF3FF] text-[17px]">{t.icon}</span>
            <span className="text-[11px] font-bold text-cuerpo">{t.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ── Acción rápida del supervisor (instrumento del día) ────────────────── */
function AccionRapida({ href, icon, label, sub }: { href: string; icon: string; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-1 rounded-[14px] border border-borde bg-tarjeta px-2 py-3 text-center transition-transform hover:bg-suave active:scale-95"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-[#EEF3FF] text-[17px]">{icon}</span>
      <span className="text-[12px] font-bold text-tinta leading-tight">{label}</span>
      <span className="text-[10px] font-medium text-tenue leading-tight">{sub}</span>
    </Link>
  );
}

/* ── Piezas compartidas ────────────────────────────────────────────────── */
function Encabezado({ titulo, bajada }: { titulo: string; bajada: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-[18px] font-extrabold tracking-[-0.01em] text-tinta">{titulo}</h2>
      <p className="text-[13px] font-medium text-gris">{bajada}</p>
    </div>
  );
}

function Panel({
  titulo,
  href,
  cta,
  tono,
  children,
}: {
  titulo: string;
  href: string;
  cta: string;
  tono: "rojo" | "ambar" | "neutro";
  children: ReactNode;
}) {
  // Clases tema-aware (globals.css): el fondo se oscurece en modo oscuro para que
  // el título por token (text-tinta) no quede claro-sobre-claro (invisible).
  const clase = tono === "rojo" ? "panel-rojo" : tono === "ambar" ? "panel-ambar" : "panel-neutro";
  const ctaColor = tono === "rojo" ? "cta-rojo" : tono === "ambar" ? "cta-ambar" : "text-azul";
  return (
    <section className={`rounded-[16px] border p-4 ${clase}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14.5px] font-extrabold text-tinta">{titulo}</h3>
        <Link href={href} className={`text-[12px] font-bold ${ctaColor}`}>
          {cta}
        </Link>
      </div>
      {children}
    </section>
  );
}

function DatoGrande({
  etiqueta,
  valor,
  sub,
  activo = true,
  tono = "rojo",
}: {
  etiqueta: string;
  valor: string;
  sub: string;
  activo?: boolean;
  tono?: "rojo" | "ambar" | "azul";
}) {
  // Azul por token (var) para que en modo oscuro se aclare y no quede ilegible.
  const fg = !activo ? "#8A93AC" : tono === "ambar" ? "#B9770E" : tono === "azul" ? "var(--color-azul)" : "#C0392B";
  return (
    <div className="flex flex-col gap-0.5 rounded-[13px] border border-borde bg-tarjeta px-3.5 py-3">
      <span className="text-[11px] font-bold uppercase tracking-wide text-gris">{etiqueta}</span>
      <span className="text-[21px] font-extrabold tabular-nums" style={{ color: fg }}>
        {valor}
      </span>
      <span className="text-[11px] font-medium text-tenue">{sub}</span>
    </div>
  );
}

function TotalCierre({ etiqueta, valor, color }: { etiqueta: string; valor: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[13px] border border-borde bg-tarjeta p-3 text-center">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-gris">{etiqueta}</span>
      <span className="text-[17px] font-extrabold tabular-nums" style={{ color }}>
        {valor}
      </span>
    </div>
  );
}

function LineaCalma({ texto }: { texto: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] border border-[#CFEBDD] bg-[#F1FBF6] px-4 py-3">
      <span className="text-[16px]">🛡️</span>
      <span className="text-[12.5px] font-medium text-[#157A50]">{texto}</span>
    </div>
  );
}

function Siguiente({ href, texto }: { href: string; texto: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center gap-1.5 rounded-[13px] border border-dashed border-borde bg-suave px-4 py-2.5 text-[12.5px] font-bold text-gris hover:bg-tarjeta"
    >
      {texto} →
    </Link>
  );
}

/* ── Navegación por fecha (revivir jornadas pasadas) — GET, sin JS ──────────── */
function DateBar({ fechaYmd, hoyYmd }: { fechaYmd: string; hoyYmd: string }) {
  const prev = sumarDiasYmd(fechaYmd, -1);
  const next = sumarDiasYmd(fechaYmd, 1);
  const esHoy = fechaYmd === hoyYmd;
  const puedeAvanzar = next <= hoyYmd; // nunca al futuro
  const flecha =
    "flex h-9 w-9 items-center justify-center rounded-[11px] border border-borde bg-tarjeta text-[16px] font-bold text-cuerpo hover:bg-suave";
  return (
    <section className="flex flex-wrap items-center gap-2">
      <Link href={`/admin/jornada?fecha=${prev}`} className={flecha} aria-label="Día anterior">
        ‹
      </Link>
      <form method="get" action="/admin/jornada" className="flex items-center gap-2">
        <input
          type="date"
          name="fecha"
          defaultValue={fechaYmd}
          max={hoyYmd}
          className="h-9 rounded-[11px] border border-borde bg-tarjeta px-3 text-[13px] font-semibold text-tinta outline-none focus:border-azul"
        />
        <button type="submit" className="h-9 rounded-[11px] bg-[#2453DC] px-3.5 text-[13px] font-bold text-white">
          Ver
        </button>
      </form>
      {puedeAvanzar ? (
        <Link href={`/admin/jornada?fecha=${next}`} className={flecha} aria-label="Día siguiente">
          ›
        </Link>
      ) : (
        <span className={`${flecha} cursor-not-allowed opacity-40`} aria-hidden>
          ›
        </span>
      )}
      {!esHoy && (
        <Link
          href="/admin/jornada"
          className="acto-activo flex h-9 items-center justify-center rounded-[11px] border border-azul px-3.5 text-[13px] font-bold text-azul"
        >
          Hoy
        </Link>
      )}
    </section>
  );
}

/* ── Historial de un día (foto de solo lectura) ────────────────────────────── */
function HistorialDia({ dia }: { dia: DesempenoRango }) {
  const entregado = dia.cobradores.reduce((s, c) => s + c.entregado, 0);
  const faltantes = dia.cobradores.reduce((s, c) => s + c.faltantes, 0);
  const rindieron = dia.cobradores.filter((c) => c.rendiciones > 0).length;
  const topRecaudo = Math.max(1, ...dia.cobradores.map((c) => c.recaudado));
  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <PulsoTile etiqueta="Recaudado" valor={UYU(dia.totalRecaudado)} sub={`${dia.totalCobros} cobros`} color="#157A50" />
        <PulsoTile etiqueta="Cobradores" valor={String(dia.cobradoresActivos)} sub="con actividad ese día" color="#1E47C8" />
        <PulsoTile
          etiqueta="Entregado"
          valor={dia.disponibleRendiciones ? UYU(entregado) : "—"}
          sub={dia.disponibleRendiciones ? `${rindieron} rindieron` : "sin rendición"}
          color="#7A4DD6"
        />
        <PulsoTile
          etiqueta="Faltantes"
          valor={String(faltantes)}
          sub={faltantes > 0 ? "en el cierre" : "sin faltantes"}
          color={faltantes > 0 ? "#C0392B" : "#8A93AC"}
        />
      </section>

      <Panel titulo="Cobradores ese día" href="/admin/desempeno" cta="Ver desempeño por rango →" tono="neutro">
        {dia.cobradores.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] font-medium text-gris">No hubo cobros registrados ese día.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {dia.cobradores.map((c, i) => (
              <li key={c.cobradorId} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] font-black text-tenue tabular-nums">#{i + 1}</span>
                  <span className="flex-1 truncate text-[13.5px] font-bold text-tinta">{c.nombre}</span>
                  {c.faltantes > 0 && (
                    <span className="rounded-full bg-[#FBE4E2] px-2 py-0.5 text-[10.5px] font-bold text-[#C0392B]">faltante</span>
                  )}
                  <span className="text-[13px] font-extrabold text-tinta tabular-nums">{UYU(c.recaudado)}</span>
                </div>
                <div className="h-[7px] w-full overflow-hidden rounded-full bg-suave">
                  <div
                    className="h-full rounded-full bg-azul"
                    style={{ transformOrigin: "left", transform: `scaleX(${Math.min(1, c.recaudado / topRecaudo)})` }}
                  />
                </div>
                <span className="text-[11px] font-medium text-gris">
                  {c.cobros} cobros{c.zonaNombre ? ` · ${c.zonaNombre}` : ""}
                  {c.rendiciones > 0 ? ` · entregó ${UYU(c.entregado)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-[11px] leading-[1.5] font-medium text-tenue">
        Historial de solo lectura, del libro de pagos inmutable. Para analizar varios días juntos, usá{" "}
        <Link href="/admin/desempeno" className="font-bold text-azul">
          Desempeño por rango
        </Link>
        .
      </p>
    </div>
  );
}
