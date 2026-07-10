// ─────────────────────────────────────────────────────────────────────────
//  "Mi jornada" — el flujo guiado del SUPERVISOR (y admin) en 3 actos:
//  Apertura (armá el día) · En vivo (la zona ahora) · Cierre (cuadrá la caja).
//  NO reemplaza las pantallas: las ORQUESTA. Cada acto muestra lo justo + un
//  botón que lleva a donde se ACTÚA (Mora / Cobranza / Caja / Chat). Reusa la
//  misma data ya acotada a la zona del gestor (getResumenFinanciero /
//  getRendicionesDia / getCentroAlertas) → un supervisor ve solo lo suyo.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getResumenFinanciero } from "@/lib/data/asesor";
import { getRendicionesDia } from "@/lib/data/rendicion";
import { getCentroAlertas, type Alerta } from "@/lib/data/centroAlertas";
import { alcanceDelActor } from "@/lib/data/alcance";
import { UYU, diasSemana, meses } from "@/lib/format";
import { hoyUY } from "@/lib/fecha";
import { BarrasComparativas } from "@/components/charts/BarrasComparativas";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

type Acto = "apertura" | "vivo" | "cierre";
const ACTOS: { id: Acto; n: number; label: string; icon: string }[] = [
  { id: "apertura", n: 1, label: "Apertura", icon: "🌅" },
  { id: "vivo", n: 2, label: "En vivo", icon: "🛰️" },
  { id: "cierre", n: 3, label: "Cierre", icon: "🌙" },
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

  const [resumen, rend, centro] = await Promise.all([
    getResumenFinanciero(db, hoy),
    getRendicionesDia(db, hoy, alcance),
    getCentroAlertas(db, hoy, alcance),
  ]);
  const { cartera, recaudacion, mora, cobradores } = resumen;

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

  // ── Señales que alimentan el "chip" de cada acto (para que el stepper hable) ──
  const faltantes = rend.rendidas.filter((r) => r.diferencia < 0);
  const sinRendir = rend.pendientes.filter((p) => p.recaudado > 0);
  const floatCalle = sinRendir.reduce((s, p) => s + p.recaudado, 0);
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

      {/* Stepper de los 3 actos (guía del día) */}
      <nav className="grid grid-cols-3 gap-2">
        {ACTOS.map((a) => {
          const activo = a.id === acto;
          const chip =
            a.id === "apertura"
              ? faltantes.length + sinRendir.length + mora.criticos
              : a.id === "vivo"
                ? alertasAltas
                : sinRendir.length;
          return (
            <Link
              key={a.id}
              href={`/admin/jornada?acto=${a.id}`}
              className={`flex flex-col gap-1 rounded-[15px] border p-3 transition-colors ${
                activo ? "border-azul bg-[#EEF3FF]" : "border-borde bg-tarjeta hover:bg-suave"
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
          faltantes={faltantes.length}
          montoFaltante={rend.totalFaltante}
          sinRendir={sinRendir.length}
          floatCalle={floatCalle}
          rendicionesDisponible={rend.disponible}
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
      {acto === "cierre" && (
        <Cierre
          rendidas={rend.rendidas}
          pendientes={sinRendir}
          totalFaltante={rend.totalFaltante}
          disponible={rend.disponible}
        />
      )}
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
}) {
  const hayPendiente = faltantes > 0 || sinRendir > 0;
  return (
    <div className="flex flex-col gap-4">
      <Encabezado
        titulo="Arrancá el día"
        bajada="Revisá lo que quedó pendiente y decidí a quién hay que cobrar hoy, antes de que salga el equipo."
      />

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

/* ── ACTO 3 · CIERRE ───────────────────────────────────────────────────── */
function Cierre({
  rendidas,
  pendientes,
  totalFaltante,
  disponible,
}: {
  rendidas: { cobradorId: string; cobradorNombre?: string; recaudado: number; entregado: number; diferencia: number }[];
  pendientes: { cobradorId: string; nombre: string; recaudado: number; cobros: number }[];
  totalFaltante: number;
  disponible: boolean;
}) {
  const totalRecaudado = rendidas.reduce((s, r) => s + r.recaudado, 0) + pendientes.reduce((s, p) => s + p.recaudado, 0);
  const totalEntregado = rendidas.reduce((s, r) => s + r.entregado, 0);
  return (
    <div className="flex flex-col gap-4">
      <Encabezado
        titulo="Cerrá el día"
        bajada="Recibí el efectivo de cada cobrador, revisá que cuadre y sellá el cierre de tu zona."
      />

      {!disponible && (
        <LineaCalma texto="El estado de rendiciones no está disponible (falta correr la migración de rendición)." />
      )}

      {/* Totales del cierre */}
      <div className="grid grid-cols-3 gap-2.5">
        <TotalCierre etiqueta="Recaudado" valor={UYU(totalRecaudado)} color="#157A50" />
        <TotalCierre etiqueta="Entregado" valor={UYU(totalEntregado)} color="#1E47C8" />
        <TotalCierre etiqueta="Faltante" valor={UYU(totalFaltante)} color={totalFaltante > 0 ? "#C0392B" : "#8A93AC"} />
      </div>

      {/* Quién todavía no rindió */}
      {pendientes.length > 0 && (
        <Panel titulo={`Falta que rindan (${pendientes.length})`} href="/admin/caja" cta="Ir a Caja →" tono="ambar">
          <ul className="flex flex-col gap-2">
            {pendientes.map((p) => (
              <li key={p.cobradorId} className="flex items-center justify-between rounded-[12px] bg-suave px-3 py-2.5">
                <span className="text-[13px] font-bold text-tinta">{p.nombre}</span>
                <span className="text-[12.5px] font-semibold tabular-nums text-[#9A6A0E]">
                  {UYU(p.recaudado)} · {p.cobros} cobro(s) en la calle
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Ya rindieron */}
      <Panel titulo={`Rindieron (${rendidas.length})`} href="/admin/caja" cta="Cerrar mi zona →" tono="neutro">
        {rendidas.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {rendidas.map((r) => {
              const falta = r.diferencia < 0;
              const sobra = r.diferencia > 0;
              return (
                <li key={r.cobradorId} className="flex items-center justify-between rounded-[12px] bg-suave px-3 py-2.5">
                  <div className="flex flex-col">
                    <span className="text-[13px] font-bold text-tinta">{r.cobradorNombre ?? "Cobrador"}</span>
                    <span className="text-[11.5px] font-medium text-gris tabular-nums">
                      Recaudó {UYU(r.recaudado)} · entregó {UYU(r.entregado)}
                    </span>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums ${
                      falta ? "bg-[#FBE4E2] text-[#C0392B]" : sobra ? "bg-[#FBF1DC] text-[#9A6A0E]" : "bg-[#E7F6EF] text-[#157A50]"
                    }`}
                  >
                    {falta ? `Falta ${UYU(-r.diferencia)}` : sobra ? `Sobra ${UYU(r.diferencia)}` : "Cuadra"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-6 text-center text-[12.5px] font-medium text-gris">Todavía no rindió ningún cobrador hoy.</p>
        )}
        <Link
          href="/admin/caja"
          className="mt-3 flex items-center justify-center rounded-[13px] bg-azul px-4 py-3 text-[13.5px] font-extrabold text-white hover:bg-azul-osc"
        >
          Recibir efectivo y cerrar mi zona
        </Link>
      </Panel>
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
