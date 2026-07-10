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
import { alcanceDelActor } from "@/lib/data/alcance";
import { navVisible } from "@/lib/admin/nav";
import { UYU, diasSemana, meses } from "@/lib/format";
import { hoyUY } from "@/lib/fecha";
import { BarrasComparativas } from "@/components/charts/BarrasComparativas";
import { CierrePorZona } from "@/components/admin/CierrePorZona";
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
  searchParams: Promise<{ acto?: string }>;
}) {
  const usuario = await requireGestor();
  const hoy = new Date();
  const db = await createSupabaseServer();
  const alcance = await alcanceDelActor();
  // Herramientas del día visibles para este rol (para el launchpad unificado).
  const toolHrefs = new Set(navVisible(usuario.rol, usuario.es_dev).map((i) => i.href));

  const actor = await getActorActual();
  // Perf: NO pedimos getRendicionesDia por separado — getCierrePorZona ya lo trae
  // (consolidado por zona) y de ahí derivamos las señales del cierre. Menos idas a DB.
  const [resumen, cierre, centro, compromisos] = await Promise.all([
    getResumenFinanciero(db, hoy),
    getCierrePorZona(db, hoy, alcance),
    getCentroAlertas(db, hoy, alcance),
    getResumenCompromisos(db, alcance, hoy),
  ]);
  const { cartera, recaudacion, mora, cobradores } = resumen;
  // Zonas que este gestor puede sellar (supervisor de la zona; admin todas).
  const cerrables = actor
    ? cierre.consolidado.zonas.filter((z) => z.zonaId && puedeVerZona(actor, z.zonaId)).map((z) => z.zonaId as string)
    : [];

  // Nombre de la zona (etiqueta): la tabla `zonas` está bloqueada por RLS para el
  // gestor con zona, así que se resuelve con el cliente admin, igual que en la app
  // del cobrador. Admin sin zona → sin etiqueta (ve toda la operación).
  const zonaNombre = usuario.zona_id
    ? (await createSupabaseAdmin().from("zonas").select("nombre").eq("id", usuario.zona_id).maybeSingle()).data
        ?.nombre ?? null
    : null;

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
  const hoyCal = hoyUY(hoy);
  const fechaLarga = `${diasSemana[hoyCal.getDay()]} ${hoyCal.getDate()} de ${meses[hoyCal.getMonth()]}`;

  // Acto por defecto según la hora (mañana=apertura, tarde=en vivo, noche=cierre),
  // sobreescribible por ?acto= (navegación sin JS, como el selector de período).
  const pedido = (await searchParams).acto;
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
                  ? "border-azul bg-[#EEF3FF] shadow-[0_6px_20px_rgba(30,71,200,0.16)]"
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
        />
      )}
      {acto === "vivo" && (
        <EnVivo
          cobradoRuta={cobradoRuta}
          esperadoTotal={esperadoTotal}
          avancePct={avancePct}
          recaudadoHoy={recaudacion.hoy}
          ranking={cobradores.ranking}
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
  ranking: { nombre: string; recaudado: number; esperado: number; progresoPct: number; anomalias: number }[];
  alertas: Alerta[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <Encabezado
        titulo="La zona, ahora"
        bajada="Mirá cómo avanza la ruta mientras los cobradores están en la calle. Lo que dispara señal, arriba."
      />

      {/* Progreso de cobro del día */}
      <section className="rounded-[16px] bg-[linear-gradient(155deg,#173063_0%,#0F1B3D_60%)] p-4 text-white shadow-[0_10px_24px_rgba(15,27,61,0.28)]">
        <div className="mb-2 flex items-end justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Cobrado en ruta hoy</span>
            <span className="text-[27px] font-black leading-tight tabular-nums">{UYU(cobradoRuta)}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[12px] font-bold tabular-nums text-white/80">{avancePct}%</span>
            <span className="text-[11px] font-medium text-white/50">de {UYU(esperadoTotal)}</span>
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/12">
          <div className="h-full rounded-full bg-[linear-gradient(90deg,#34E0A1,#1FA971)]" style={{ width: `${avancePct}%` }} />
        </div>
        <p className="mt-2.5 text-[11.5px] font-medium text-white/55">
          Recaudo total del día (incluye créditos cerrados): {UYU(recaudadoHoy)}.
        </p>
      </section>

      {/* Ranking de cobradores */}
      <Panel titulo="Cobradores hoy" href="/admin/cobranza" cta="Ver mapa de cobros →" tono="neutro">
        {ranking.length > 0 ? (
          <BarrasComparativas
            datos={ranking.map((c) => ({
              nombre: c.nombre,
              valor: c.recaudado,
              total: c.esperado,
              sub: `${c.progresoPct}% de la ruta${c.anomalias > 0 ? ` · ${c.anomalias} anomalía(s)` : ""}`,
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
                {c.rendidos} rindió{c.rendidos === 1 ? "" : "eron"}
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
  { href: "/admin/alertas", label: "Alertas", icon: "🚨" },
  { href: "/admin/campo", label: "Campo", icon: "🛰️" },
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
  const borde = tono === "rojo" ? "#F3C9BF" : tono === "ambar" ? "#F0D9A8" : "#E7ECF5";
  const fondo = tono === "rojo" ? "#FEF6F3" : tono === "ambar" ? "#FEFBF3" : "#FFFFFF";
  const ctaColor = tono === "rojo" ? "text-[#C0392B]" : tono === "ambar" ? "text-[#9A6A0E]" : "text-azul";
  return (
    <section className="rounded-[16px] border p-4" style={{ borderColor: borde, background: fondo }}>
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
  const fg = !activo ? "#8A93AC" : tono === "ambar" ? "#B9770E" : tono === "azul" ? "#1E47C8" : "#C0392B";
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
