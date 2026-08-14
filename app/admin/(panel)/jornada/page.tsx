// ─────────────────────────────────────────────────────────────────────────
//  "Mi jornada" — el flujo guiado del SUPERVISOR (y admin) en 3 actos:
//  Apertura (armá el día) · En vivo (la zona ahora) · Cierre (cuadrá la caja).
//  NO reemplaza las pantallas: las ORQUESTA. Cada acto muestra lo justo + un
//  botón que lleva a donde se ACTÚA (Mora / Cobranza / Caja / Chat). Reusa la
//  misma data ya acotada a la zona del gestor (getResumenFinanciero /
//  getRendicionesDia / getCentroAlertas) → un supervisor ve solo lo suyo.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { requireGestor, actorDeUsuario } from "@/lib/auth";
import { puedeVerZona } from "@/lib/permisos";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getResumenFinanciero } from "@/lib/data/asesor";
import { getCierrePorZona, type ResumenCierreZonas } from "@/lib/data/cierreZona";
import { CLAVE_SIN_ZONA } from "@/lib/cierreZona";
import { getCentroAlertas, type Alerta } from "@/lib/data/centroAlertas";
import { getResumenCompromisos, type ResumenCompromisos } from "@/lib/data/gestionesCobranza";
import { getActivosConPagos } from "@/lib/data/activos";
import { getControlCobranza, type RankingCobrador } from "@/lib/data/control";
import { getRendicionesDia, getJornadasSinRendir, type JornadaAbierta } from "@/lib/data/rendicion";
import { JornadasSinRendir } from "@/components/admin/JornadasSinRendir";
import { getDesempenoRango, type DesempenoRango } from "@/lib/data/desempeno";
import { contarSolicitudesGastoPendientes } from "@/lib/data/solicitudesGasto";
import { getSolicitudesPendientes as getSolicitudesAnulacionPendientes } from "@/lib/data/anulaciones";
import { getBitacoraGestorDia, type RegistroAuditoria } from "@/lib/data/auditoria";
import { alcanceDelActor } from "@/lib/data/alcance";
import { getAperturasDia, getBasesDelDia } from "@/lib/data/aperturas";
import { BaseCajaManager, type CobradorBase } from "@/components/admin/BaseCajaManager";
import { OnboardingDia1 } from "@/components/OnboardingDia1";
import { ActivarAvisos } from "@/components/pwa/ActivarAvisos";
import { RankingPorZona } from "@/components/admin/RankingPorZona";
import { conTimeout } from "@/lib/timeout";
import { reportarError } from "@/lib/observabilidad";
import { navVisible } from "@/lib/admin/nav";
import { UYU, diasSemana, meses, horaDe } from "@/lib/format";
import { fechaISOUY, sumarDiasYmd } from "@/lib/fecha";
import { CierrePorZona } from "@/components/admin/CierrePorZona";
import { AvisarCobrador } from "@/components/admin/AvisarCobrador";
import { BienvenidaCard } from "@/components/BienvenidaCard";
import { AutoRefresco } from "@/components/admin/AutoRefresco";
import { Icono, ICONO_NAV, type NombreIcono } from "@/components/Iconos";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

// Tope de tiempo GENEROSO (22s) para la carga de datos: un cuelgue real lanza →
// lo toma el error.tsx del panel ("Reintentar"), no un skeleton eterno. Money-safe:
// LANZA, jamás degrada a un $0 falso. Una carga legítima (1-5s) ni lo roza.
const TOPE_MS = 22_000;

type Acto = "apertura" | "vivo" | "cierre";
const ACTOS: { id: Acto; n: number; label: string; icon: NombreIcono; cuando: string }[] = [
  { id: "apertura", n: 1, label: "Apertura", icon: "apertura", cuando: "temprano" },
  { id: "vivo", n: 2, label: "En vivo", icon: "vivo", cuando: "durante el día" },
  { id: "cierre", n: 3, label: "Cierre", icon: "cierre", cuando: "al cierre" },
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
  // Sesión leída UNA vez: el actor se deriva del usuario ya resuelto y se reusa
  // para el alcance (antes: requireGestor + getActorActual + alcanceDelActor → 3×
  // getUser ≈ 0,5 s).
  const actor = await actorDeUsuario(usuario);
  const alcance = await alcanceDelActor(actor);
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
  // El SUPERVISOR no tiene `usuarios.zona_id` (su zona vive en `supervisor_zonas`),
  // así que si supervisa UNA sola zona, la resolvemos desde ahí para el encabezado.
  const adminZ = createSupabaseAdmin();
  let zonaNombre: string | null = null;
  if (usuario.zona_id) {
    zonaNombre =
      (await adminZ.from("zonas").select("nombre").eq("id", usuario.zona_id).maybeSingle()).data?.nombre ?? null;
  } else {
    const sz = await adminZ.from("supervisor_zonas").select("zona_id").eq("supervisor_id", usuario.id);
    const zids = (sz.data ?? []).map((r) => r.zona_id as string);
    if (zids.length === 1) {
      zonaNombre = (await adminZ.from("zonas").select("nombre").eq("id", zids[0]).maybeSingle()).data?.nombre ?? null;
    }
  }

  // Etiqueta larga de la fecha elegida.
  const [fy, fm, fd] = fechaYmd.split("-").map(Number);
  const fechaCal = new Date(fy, fm - 1, fd);
  const fechaLarga = `${diasSemana[fechaCal.getDay()]} ${fechaCal.getDate()} de ${meses[fechaCal.getMonth()]}`;

  // ── HISTORIAL (día pasado): foto de SOLO LECTURA, sin el motor "en vivo" (caro
  //    y solo con sentido para hoy). Reusa la capa de desempeño, acotada a ese día. ──
  if (!esHoy) {
    const dia = await conTimeout(
      getDesempenoRango(db, { desde: fechaYmd, hasta: fechaYmd }, alcance),
      TOPE_MS,
      "jornada.historial",
    );
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
  // cartera activa + rendiciones INDEPENDIENTES → EN PARALELO. (actor ya está
  // resuelto arriba y reusado — sin recargar la sesión.)
  const [activos, rend] = await conTimeout(
    Promise.all([getActivosConPagos(db, alcance), getRendicionesDia(db, hoy, alcance)]),
    TOPE_MS,
    "jornada.base",
  );
  const control = await conTimeout(
    getControlCobranza(db, hoy, activos, alcance),
    TOPE_MS,
    "jornada.control",
  );
  const [resumen, cierre, centro, compromisos, bitacora] = await conTimeout(
    Promise.all([
      getResumenFinanciero(db, hoy, { alcance, activos, control }),
      getCierrePorZona(db, hoy, alcance, rend),
      getCentroAlertas(db, hoy, alcance, { control, rend }),
      getResumenCompromisos(db, alcance, hoy),
      getBitacoraGestorDia(db, usuario.id, hoy),
    ]),
    TOPE_MS,
    "jornada.vivo",
  );
  const { cartera, recaudacion, mora, cobradores } = resumen;
  // Zonas que este gestor puede sellar (supervisor de la zona; admin todas).
  const cerrables = actor
    ? cierre.consolidado.zonas
        .filter((z) => (z.zonaId ? puedeVerZona(actor, z.zonaId) : actor.rol === "admin"))
        .map((z) => z.zonaId ?? CLAVE_SIN_ZONA)
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

  // Base de caja del día (0105): con cuánto arranca cada cobrador. Solo se arma en
  // Apertura del día de HOY (setear la base de un día pasado no tiene sentido). Se
  // lee con el cliente admin acotado por `cobIds` (mismo patrón que el resto del
  // panel); la escritura (setApertura) sí corre bajo la RLS del gestor.
  // Zona → nombre y zona → supervisor(es): tablas chicas, se leen SIEMPRE porque la
  // jerarquía la usan tanto la Base de caja (Apertura) como "Cobradores hoy" (En vivo).
  const [zonasRes, supZonasRes, supsRes] = await conTimeout(
    Promise.all([
      adminZ.from("zonas").select("id, nombre"),
      adminZ.from("supervisor_zonas").select("supervisor_id, zona_id"),
      adminZ.from("usuarios").select("id, nombre").eq("rol", "supervisor"),
    ]),
    TOPE_MS,
    "jornada.zonas",
  );
  const zonaNombreMap: Record<string, string> = {};
  for (const z of zonasRes.data ?? []) zonaNombreMap[z.id as string] = z.nombre as string;
  const supN = new Map((supsRes.data ?? []).map((u) => [u.id as string, u.nombre as string]));
  const supervisoresPorZona: Record<string, string[]> = {};
  for (const sz of supZonasRes.data ?? []) {
    const nombre = supN.get(sz.supervisor_id as string);
    if (nombre) (supervisoresPorZona[sz.zona_id as string] ??= []).push(nombre);
  }

  // Jornadas viejas sin acta: la plata que quedó en la calle sin papel. Solo se
  // consultan en el acto de CIERRE (es donde se resuelven) para no cargarle a la
  // apertura una consulta que ahí no se usa.
  let jornadasAbiertas: JornadaAbierta[] = [];
  if (acto === "cierre") {
    try {
      jornadasAbiertas = await conTimeout(
        getJornadasSinRendir(db, alcance.global ? null : alcance.cobradorIds, hoy, 30),
        TOPE_MS,
        "jornada.sinRendir",
      );
    } catch (e) {
      reportarError("jornada.sinRendir", e); // nunca tumba el cierre
    }
  }

  let basesCobradores: CobradorBase[] = [];
  // La base se carga en CUALQUIER acto del día de hoy: el supervisor la fija a
  // primera hora, pero también necesita corregirla mientras la jornada corre
  // (se sella recién cuando el cobrador rinde, 0129). Antes solo existía en el
  // acto "Apertura" y había que volver ahí a buscarla.
  if (esHoy) {
    const cobIds = alcance.global ? null : alcance.cobradorIds;
    let cq = adminZ.from("usuarios").select("id, nombre, zona_id").eq("rol", "cobrador").eq("activo", true);
    if (cobIds) cq = cobIds.length > 0 ? cq.in("id", cobIds) : cq.eq("id", "00000000-0000-0000-0000-000000000000");
    // Base de AYER también: es el prellenado de "Usar las de ayer" (la base
    // suele repetirse día a día — cargar 14 montos a mano cada mañana no).
    const [cobsRes, bases, basesAyer] = await conTimeout(
      Promise.all([
        cq.order("nombre", { ascending: true }),
        // Con ARRASTRE y con el ORIGEN: la cuadra de ayer amanece como base de hoy
        // (regla de Carlos, 06-08) y el supervisor ve de dónde salió cada número.
        getBasesDelDia(db, hoy, cobIds),
        getAperturasDia(db, new Date(hoy.getTime() - 86_400_000), cobIds).catch(
          () => new Map<string, number>(),
        ),
      ]),
      TOPE_MS,
      "jornada.bases",
    );
    basesCobradores = (cobsRes.data ?? []).map((u) => {
      const b = bases.get(u.id as string);
      return {
        id: u.id as string,
        nombre: u.nombre as string,
        zonaId: (u.zona_id as string | null) ?? null,
        zonaNombre: u.zona_id ? (zonaNombreMap[u.zona_id as string] ?? null) : null,
        base: b?.base ?? 0,
        baseAyer: basesAyer.get(u.id as string) ?? 0,
        origen: b?.origen ?? "sin_base",
        desdeFecha: b?.desdeFecha,
        detalleAyer: b?.detalle,
        // Ya cerró → base sellada: la fila se congela en vez de rebotar al guardar.
        yaRindio: cierre.consolidado.zonas.some((z) =>
          z.cobradores.some((c) => c.cobradorId === (u.id as string) && c.estado !== "pendiente"),
        ),
      };
    });
  }

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
  // Avance del DÍA para el pulso héroe: recaudado total (incl. cerrados) sobre la meta.
  const avanceDiaPct = esperadoTotal > 0 ? Math.min(100, Math.round((recaudacion.hoy / esperadoTotal) * 100)) : 0;
  const alertasAltas = centro.conteo.alta;
  // Clientes listos para renovar (avance ≥ 75%) — oportunidad de colocar. Barato:
  // sale del `activos` YA cargado (pagado/total), sin consultas extra.
  const renovables = activos.filter((a) => {
    const total = Number(a.cuota_diaria) * Number(a.total_dias);
    return total > 0 && Number(a.pagado) / total >= 0.75;
  }).length;
  // Gastos de ruta esperando aprobación: el cobrador está parado esperando, así que
  // se surface en el hub del día. El supervisor también los VE (acotados a su zona);
  // los aprueba el admin. Y las CORRECCIONES de cobro (solicitudes de anulación,
  // incluidas las que ahora piden los cobradores, 08-05): acá el supervisor SÍ es
  // el aprobador (doble registro) → tarjeta protagonista, no solo el badge del menú.
  const [gastosPend, correccionesPend] = await conTimeout(
    Promise.all([
      contarSolicitudesGastoPendientes(db, alcance.global ? null : alcance.cobradorIds),
      getSolicitudesAnulacionPendientes(db, alcance)
        .then((s) => s.length)
        .catch((e) => {
          // Si esta query falla, la tarjeta "esperan tu aval" desaparece en
          // silencio y una corrección de plata queda colgada sin que nadie lo
          // sepa. Se degrada igual (la jornada carga), pero con rastro.
          reportarError("jornada.correccionesPendientes", e);
          return 0;
        }),
    ]),
    TOPE_MS,
    "jornada.pendientes",
  );

  // ── Estado del cierre (para el peak-end): ¿todas las zonas que puedo sellar ya
  //    están cerradas? + resumen del día para el Acto 3. ──
  const cerradasPendientes = cierre.consolidado.zonas.filter(
    (z) => cerrables.includes(z.zonaId ?? CLAVE_SIN_ZONA) && !z.confirmado,
  ).length;
  const todasCerradas = cierre.disponible && cerrables.length > 0 && cerradasPendientes === 0;
  const resumenDia = {
    recaudado: recaudacion.hoy,
    esperado: esperadoTotal,
    avancePct: avanceDiaPct,
    renovables,
    sinRendir: sinRendirN,
    faltante: cons.totalFaltante,
    alertasAltas,
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Encabezado personalizado */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">
            {saludo}, {primerNombre} 👋
          </h1>
          <span className="text-[13px] font-medium text-gris capitalize">
            {zonaNombre ? `Zona ${zonaNombre} · ` : ""}
            {fechaLarga} · tu jornada en 3 momentos
          </span>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {/* Avisos push: acá, donde el supervisor entra cada mañana. Antes vivía
              SOLO en la pantalla de Cierre y nadie lo encontraba (por eso había
              0 suscripciones y el canal de alertas estaba mudo). */}
          <ActivarAvisos
            vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
            avisarSiFaltaConfig={usuario.rol === "admin"}
          />
          {usuario.rol === "admin" && (
            <Link href="/admin" className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[12.5px] font-bold text-gris">
              Ver tablero completo →
            </Link>
          )}
        </div>
      </div>

      {/* ARRANQUE DÍA 1 (08-05): contraseña propia + instalar la app — también
          para el supervisor/admin, mismo criterio que el cobrador. */}
      <OnboardingDia1 claveCambiada={usuario.clave_cambiada_en != null} />

      {/* Bienvenida cálida (solo la 1ª vez, se puede cerrar). */}
      <BienvenidaCard
        id="supervisor"
        saludo={`¡A darle al día, ${primerNombre}! 👋`}
        titulo="Tu día en 3 momentos."
        cuerpo="Apertura (a quién reclamarle hoy), En vivo (cómo va cada cobrador) y Cierre (el cuadre de caja). Seguí los pasos y no se te escapa nada."
        cta={{ href: "/admin/tutorial", texto: "Ver cómo se usa" }}
      />

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
        esperadoDia={esperadoTotal}
        avancePct={avanceDiaPct}
      />

      {/* Gastos de ruta esperando: el cobrador está parado esperando la aprobación. */}
      {gastosPend > 0 && (
        <Link
          href="/admin/gastos"
          className="flex items-center justify-between gap-2 rounded-[14px] border border-[#F0D9A8] panel-ambar px-4 py-3 hover:brightness-[0.98]"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-[18px]">⛽</span>
            <div className="flex flex-col">
              <span className="text-[13px] font-extrabold text-tinta">
                {usuario.rol === "admin"
                  ? `${gastosPend} gasto${gastosPend === 1 ? "" : "s"} de ruta esperando tu aprobación`
                  : `${gastosPend} gasto${gastosPend === 1 ? "" : "s"} de ruta de tu equipo`}
              </span>
              {/* El supervisor VE y sigue de cerca; el admin es quien APRUEBA (0057). */}
              <span className="text-[11.5px] font-medium text-gris">
                {usuario.rol === "admin"
                  ? "El cobrador está parado esperando — aprobalo o rechazalo."
                  : "El admin los aprueba; vos los seguís de cerca."}
              </span>
            </div>
          </div>
          <span className="flex-shrink-0 text-[12px] font-bold text-ambar-osc">
            {usuario.rol === "admin" ? "Aprobar →" : "Ver →"}
          </span>
        </Link>
      )}

      {/* CORRECCIONES de cobro esperando AVAL (dinero): un cobrador o supervisor
          pidió anular un pago mal cargado. Acá el supervisor SÍ es aprobador
          (doble registro: la confirma alguien distinto de quien la pidió). */}
      {correccionesPend > 0 && (
        <Link
          href="/admin/anulaciones"
          className="flex items-center justify-between gap-2 rounded-[14px] border border-[#F3C0B8] bg-[#FDF1F0] px-4 py-3 hover:brightness-[0.98]"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-[18px]">🚫</span>
            <div className="flex flex-col">
              <span className="text-[13px] font-extrabold text-tinta">
                {correccionesPend === 1
                  ? "1 corrección de cobro espera tu aval"
                  : `${correccionesPend} correcciones de cobro esperan tu aval`}
              </span>
              <span className="text-[11.5px] font-medium text-gris">
                Alguien reportó un pago mal cargado. Vos sos la segunda firma: revisá el
                motivo y confirmá o rechazá. El pago nunca se borra, queda anulado con traza.
              </span>
            </div>
          </div>
          <span className="flex-shrink-0 rounded-full bg-[#D64545] px-3 py-1.5 text-[12px] font-bold text-white">
            Avalar →
          </span>
        </Link>
      )}

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
                : sinRendirN + cerradasPendientes; // cierre: sin-rendir + zonas sin sellar
          return (
            <Link
              key={a.id}
              href={`/admin/jornada?acto=${a.id}`}
              className={`flex flex-col gap-1 rounded-[16px] border p-3 transition-all ${
                activo
                  ? "acto-activo border-azul shadow-md"
                  : "border-borde bg-tarjeta hover:bg-suave hover:shadow-sm"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-bold uppercase tracking-wide ${activo ? "text-azul" : "text-tenue"}`}>
                  Acto {a.n}
                </span>
                {/* Chips con TOKENS (bg-*-suave + text-*-osc): los hex crudos no
                    flipeaban en modo oscuro y quedaban pastel-sobre-tinta. */}
                {a.id === "cierre" && todasCerradas ? (
                  sinRendirN > 0 ? (
                    <span className="rounded-full bg-ambar-suave px-1.5 py-0.5 text-[10px] font-bold text-ambar-osc">✓ · {sinRendirN} sin rendir</span>
                  ) : (
                    <span className="rounded-full bg-verde-suave px-1.5 py-0.5 text-[10px] font-bold text-verde-osc">✓ Cerrado</span>
                  )
                ) : chip > 0 ? (
                  <span className="rounded-full bg-rojo-suave px-1.5 py-0.5 text-[10px] font-bold text-rojo-osc tabular-nums">
                    {chip}
                  </span>
                ) : null}
              </div>
              <span className={`flex items-center gap-1.5 text-[14px] font-extrabold ${activo ? "text-tinta" : "text-cuerpo"}`}>
                <Icono name={a.icon} className="h-[15px] w-[15px]" />
                {a.label}
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
      {/* Base de caja: en Apertura (su momento natural) y también En vivo, para
          corregirla sin volver atrás. En Cierre ya no: ahí la base de cada
          cobrador que rindió quedó sellada con su rendición. */}
      {(acto === "apertura" || acto === "vivo") && esHoy && (
        <BaseCajaManager cobradores={basesCobradores} supervisoresPorZona={supervisoresPorZona} />
      )}
      {acto === "vivo" && (
        <EnVivo
          cobradoRuta={cobradoRuta}
          esperadoTotal={esperadoTotal}
          avancePct={avancePct}
          recaudadoHoy={recaudacion.hoy}
          ranking={control.ranking}
          alertas={centro.alertas}
          zonaNombre={zonaNombreMap}
          supervisoresPorZona={supervisoresPorZona}
        />
      )}
      {acto === "cierre" && (
        <>
          {/* ⚠️ LO PRIMERO DEL CIERRE: las jornadas que quedaron abiertas de dias
              anteriores. La app solo sabia cerrar HOY, asi que si al cobrador se le
              paso la noche esa jornada era incerrable para siempre y el supervisor
              no tenia donde anotar que recibio la plata: 40 jornadas, $2.702.391, la
              mas vieja del 10 de julio. Va ARRIBA del cierre de hoy porque es plata
              mas vieja, y lo viejo es lo que se olvida. */}
          <JornadasSinRendir jornadas={jornadasAbiertas} />
          <Cierre cierre={cierre} cerrables={cerrables} resumenDia={resumenDia} todasCerradas={todasCerradas} />
        </>
      )}

      {/* Bitácora del día: lo que YA hiciste (descarga de memoria + cierre de loop). */}
      <BitacoraDia entradas={bitacora} />
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
      {/* HÉROE del acto: el plan del día EN UN VISTAZO + UNA acción primaria (en vez
          de tres atajos que competían con el launchpad). Lidera el número que decide
          el arranque: cuánto hay por cobrar hoy y cuánta mora crítica priorizar. */}
      <div className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
        <div className="flex flex-col gap-0.5">
          {/* Mismo tamaño que el `Encabezado` de los actos 2 y 3: tres títulos de
              acto con la misma jerarquía (pasada estética 08-14). */}
          <h2 className="text-[18px] font-extrabold tracking-[-0.01em] text-tinta">Arrancá el día</h2>
          <p className="text-[13px] font-medium text-gris">Decidí a quién cobrar hoy antes de que salga el equipo.</p>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gris">Por cobrar hoy</span>
            <span className="text-[28px] leading-none font-black tabular-nums text-azul">{UYU(porCobrarHoy)}</span>
            <span className="mt-0.5 text-[11.5px] font-medium text-tenue">{morosos} en mora · {UYU(moraMonto)} vencido</span>
          </div>
          {moraCriticos > 0 && (
            <div className="flex flex-col items-end rounded-[12px] panel-rojo px-3 py-2">
              <span className="text-[22px] leading-none font-black tabular-nums text-rojo-osc">{moraCriticos}</span>
              <span className="text-[10.5px] font-bold text-rojo-osc">riesgo crítico · visitar hoy</span>
            </div>
          )}
        </div>
        <Link
          href="/admin/mora"
          className="flex items-center justify-center gap-1.5 btn-primario px-4 py-2.5 text-[13px] font-bold text-white active:scale-[0.99]"
        >
          Ver mora y avisar a cobradores →
        </Link>
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
        <LineaCalma texto={rendicionesDisponible ? "La caja está limpia: sin faltantes ni float en la calle." : "Sin señales de caja abiertas."} />
      )}

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
  zonaNombre,
  supervisoresPorZona,
}: {
  cobradoRuta: number;
  esperadoTotal: number;
  avancePct: number;
  recaudadoHoy: number;
  ranking: RankingCobrador[];
  alertas: Alerta[];
  zonaNombre: Record<string, string>;
  supervisoresPorZona: Record<string, string[]>;
}) {
  const faltaMeta = Math.max(0, esperadoTotal - cobradoRuta);
  // Cobradores que necesitan atención: van por debajo de la mitad de su ruta o
  // tienen anomalías. Ordenados peor-primero. Cada uno con un aviso a un toque.
  const atencion = ranking
    .filter((c) => c.esperado > 0 && (c.progreso < 0.5 || c.anomalias > 0))
    .sort((a, b) => a.progreso - b.progreso);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <Encabezado
          titulo="La zona, ahora"
          bajada="Mirá cómo avanza la ruta mientras los cobradores están en la calle. Lo que dispara señal, arriba."
        />
        <AutoRefresco segundos={40} />
      </div>

      {/* Meta del día: avance vs esperado + cuánto falta. */}
      <section className="rounded-[16px] bg-[linear-gradient(155deg,#173063_0%,#0F1B3D_60%)] p-4 text-white shadow-[0_10px_24px_rgba(15,27,61,0.28)]">
        <div className="mb-2 flex items-end justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Cobrado en ruta hoy</span>
            <span className="text-[28px] font-black leading-tight tabular-nums">{UYU(cobradoRuta)}</span>
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

      {/* Cobradores hoy: agrupados por zona → supervisor (antes 52 barras planas). */}
      <Panel titulo="Cobradores hoy" href="/admin/cobranza" cta="Ver mapa de cobros →" tono="neutro">
        {ranking.length > 0 ? (
          <RankingPorZona ranking={ranking} zonaNombre={zonaNombre} supervisoresPorZona={supervisoresPorZona} />
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
function Cierre({
  cierre, cerrables, resumenDia, todasCerradas,
}: {
  cierre: ResumenCierreZonas;
  cerrables: string[];
  resumenDia: { recaudado: number; esperado: number; avancePct: number; renovables: number; sinRendir: number; faltante: number; alertasAltas: number };
  todasCerradas: boolean;
}) {
  const c = cierre.consolidado;
  const diferencia = c.totalSobrante - c.totalFaltante;
  return (
    <div className="flex flex-col gap-4">
      <Encabezado
        titulo="Cerrá el día"
        bajada="Recibí el efectivo de cada cobrador, revisá que cuadre y cerrá la jornada."
      />

      {/* PEAK-END: al sellar la última zona, cierre emocional del día. */}
      {todasCerradas && (
        <div className="relative overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#1FA971_0%,#157A50_100%)] px-5 py-5 text-white shadow-[0_14px_34px_rgba(21,122,80,0.32)]">
          <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-white/10" />
          <span aria-hidden className="pointer-events-none absolute -bottom-10 right-10 h-24 w-24 rounded-full bg-white/10" />
          <span className="text-[30px]" aria-hidden>🎉</span>
          <h3 className="mt-1 text-[20px] font-black leading-tight">¡Día cerrado! Buen laburo.</h3>
          <p className="mt-0.5 text-[13px] font-medium text-white/85">
            {c.totalFaltante > 0
              ? `Cerraste todas las zonas. Quedó un faltante de ${UYU(c.totalFaltante)} para revisar mañana.`
              : c.pendientes > 0
                ? `Cerraste todas las zonas. Quedan ${c.pendientes} sin rendir (${UYU(c.porRendir)} en la calle) para mañana.`
                : "Todas las zonas cuadradas y selladas. La caja quedó prolija. A descansar. 💚"}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] font-semibold text-white/80">
            <span>Recaudado {UYU(resumenDia.recaudado)}</span>
            <span>{resumenDia.avancePct}% de la meta</span>
            <span>{c.rendidos} {c.rendidos === 1 ? "rendición" : "rendiciones"}</span>
          </div>
        </div>
      )}

      {/* Resumen del ARCO del día (más potente que solo el cuadre). */}
      {!todasCerradas && (
        <div className="flex flex-col gap-2 rounded-[16px] border border-borde bg-tarjeta p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-extrabold text-tinta">Resumen del día</span>
            <span className="text-[12px] font-bold text-gris tabular-nums">{resumenDia.avancePct}% de la meta</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-linea">
            <div className="h-full rounded-full bg-[linear-gradient(90deg,#34E0A1,#1FA971)]" style={{ width: `${resumenDia.avancePct}%` }} />
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-[12px] font-medium text-gris">
            <span>Recaudado <b className="tabular-nums text-tinta">{UYU(resumenDia.recaudado)}</b> de {UYU(resumenDia.esperado)}</span>
            <span className="flex flex-wrap gap-x-3">
              <Link href="/admin/renovaciones" className="font-semibold text-azul hover:underline">{resumenDia.renovables} listos para renovar</Link>
              <Link href="/admin/mora?nivel=alto" className="font-semibold text-azul hover:underline">{resumenDia.alertasAltas} en riesgo alto</Link>
            </span>
          </div>
        </div>
      )}

      {!cierre.disponible ? (
        <LineaCalma texto="El cierre de jornada necesita la migración de rendición (0013)." />
      ) : (
        <>
          {/* Cuadre de un vistazo: recaudado − gastos = esperado → entregado → diferencia. */}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <TotalCierre etiqueta="Recaudado" valor={UYU(c.totalRecaudado)} color="var(--color-verde-osc)" />
            <TotalCierre etiqueta="Entregado" valor={UYU(c.totalEntregado)} color="var(--color-azul)" />
            <TotalCierre
              etiqueta={c.totalFaltante > 0 ? "Faltante" : "Diferencia"}
              valor={c.totalFaltante > 0 ? UYU(c.totalFaltante) : UYU(diferencia)}
              color={c.totalFaltante > 0 ? "var(--color-rojo-osc)" : diferencia > 0 ? "var(--color-ambar-osc)" : "var(--color-verde-osc)"}
            />
            <TotalCierre etiqueta="Por rendir" valor={UYU(c.porRendir)} color={c.porRendir > 0 ? "var(--color-ambar-osc)" : "var(--color-tenue)"} />
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

/* ── Concentrado de la zona (pulso, siempre visible) ─────────────────────
   Jerárquico: "Recaudado hoy" LIDERA (número grande + barra de avance, que el
   ojo estima preattentivamente); los otros 3 quedan secundarios. */
function ResumenZona({
  capitalEnCalle,
  morosos,
  montoMora,
  moraPct,
  recaudadoHoy,
  clientes,
  creditos,
  esperadoDia,
  avancePct,
}: {
  capitalEnCalle: number;
  morosos: number;
  montoMora: number;
  moraPct: number;
  recaudadoHoy: number;
  clientes: number;
  creditos: number;
  esperadoDia: number;
  avancePct: number;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      {/* HÉROE: lo que más importa del día, en grande, con barra de avance. */}
      <div className="rounded-[16px] border border-borde bg-tarjeta p-4">
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gris">Recaudado hoy</span>
            <span className="text-[30px] leading-none font-black tabular-nums text-verde-osc">{UYU(recaudadoHoy)}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[14px] font-extrabold tabular-nums text-tinta">{avancePct}%</span>
            {esperadoDia > 0 && (
              <span className="text-[11px] font-medium text-tenue">de la meta {UYU(esperadoDia)}</span>
            )}
          </div>
        </div>
        <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-linea">
          <div className="h-full rounded-full bg-verde" style={{ width: `${avancePct}%` }} />
        </div>
      </div>
      {/* Secundarios: contexto, sin competir con el héroe. */}
      <div className="grid grid-cols-3 gap-2.5">
        <PulsoTile etiqueta="Capital en calle" valor={UYU(capitalEnCalle)} sub={`${creditos} créditos`} color="var(--color-tinta)" />
        <PulsoTile
          etiqueta="En mora"
          valor={String(morosos)}
          sub={`${UYU(montoMora)} · ${Math.round(moraPct * 100)}%`}
          color={morosos > 0 ? "var(--color-rojo-osc)" : "var(--color-tenue)"}
        />
        <PulsoTile etiqueta="Clientes" valor={String(clientes)} sub="con crédito" color="var(--color-azul)" />
      </div>
    </section>
  );
}

/* ── Bitácora del día: memoria externa de las acciones del gestor hoy ────── */
function BitacoraDia({ entradas }: { entradas: RegistroAuditoria[] }) {
  if (entradas.length === 0) return null;
  return (
    <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-bold uppercase tracking-wide text-gris">Lo que hiciste hoy</span>
        <span className="text-[11px] font-semibold text-tenue tabular-nums">
          {entradas.length} {entradas.length === 1 ? "acción" : "acciones"}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-linea">
        {entradas.slice(0, 8).map((e) => (
          <li key={e.id} className="flex items-start gap-2.5 py-2">
            <span className="w-11 flex-shrink-0 text-[11px] font-semibold text-tenue tabular-nums">{horaDe(e.creadoEn)}</span>
            <div className="flex min-w-0 flex-col">
              <span className="text-[12.5px] font-semibold text-tinta">{e.accion}</span>
              {e.detalle && <span className="truncate text-[11.5px] font-medium text-gris">{e.detalle}</span>}
            </div>
          </li>
        ))}
      </ul>
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
  // COLAPSADO por defecto (divulgación progresiva): las herramientas ya viven en
  // la barra inferior/lateral; acá dejan de competir con el contenido del acto.
  return (
    <details className="group rounded-[14px] border border-borde bg-tarjeta">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5">
        <span className="text-[12px] font-bold uppercase tracking-wide text-gris">Herramientas del día</span>
        <span className="text-[11px] font-semibold text-tenue">
          <span className="group-open:hidden">{items.length} · abrir ▾</span>
          <span className="hidden group-open:inline">cerrar ▴</span>
        </span>
      </summary>
      <div className="grid grid-cols-4 gap-2 px-3 pb-3 md:grid-cols-8">
        {items.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="flex flex-col items-center gap-1.5 rounded-[14px] border border-borde bg-suave py-3 transition-transform hover:bg-tarjeta active:scale-95"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-azul-suave text-azul">
              <Icono name={ICONO_NAV[t.href] ?? "menu"} className="h-[18px] w-[18px]" />
            </span>
            <span className="text-[11px] font-bold text-cuerpo">{t.label}</span>
          </Link>
        ))}
      </div>
    </details>
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
  // Colores por token (var) para que en modo oscuro se aclaren y no queden ilegibles.
  const fg = !activo
    ? "var(--color-tenue)"
    : tono === "ambar"
      ? "var(--color-ambar-osc)"
      : tono === "azul"
        ? "var(--color-azul)"
        : "var(--color-rojo-osc)";
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] border border-borde bg-tarjeta px-3.5 py-3">
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
    <div className="flex flex-col gap-0.5 rounded-[12px] border border-borde bg-tarjeta p-3 text-center">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-gris">{etiqueta}</span>
      <span className="text-[17px] font-extrabold tabular-nums" style={{ color }}>
        {valor}
      </span>
    </div>
  );
}

function LineaCalma({ texto }: { texto: string }) {
  // Tokens (no hex): en modo oscuro el fondo/borde/verde flipean y no queda una
  // caja menta brillante sobre tarjeta oscura.
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] border border-borde bg-suave px-4 py-3">
      <span className="text-[16px]">🛡️</span>
      <span className="text-[12.5px] font-medium text-verde-osc">{texto}</span>
    </div>
  );
}

function Siguiente({ href, texto }: { href: string; texto: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-borde bg-suave px-4 py-2.5 text-[12.5px] font-bold text-gris hover:bg-tarjeta"
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
    "flex h-9 w-9 items-center justify-center rounded-[12px] border border-borde bg-tarjeta text-cuerpo hover:bg-suave";
  return (
    <section className="flex flex-wrap items-center gap-2">
      <Link href={`/admin/jornada?fecha=${prev}`} className={flecha} aria-label="Día anterior">
        <Icono name="chevron" className="h-4 w-4 rotate-180" />
      </Link>
      <form method="get" action="/admin/jornada" className="flex items-center gap-2">
        <input
          type="date"
          name="fecha"
          defaultValue={fechaYmd}
          max={hoyYmd}
          className="h-9 rounded-[12px] border border-borde bg-tarjeta px-3 text-[16px] font-semibold text-tinta outline-none focus:border-azul"
        />
        <button type="submit" className="h-9 btn-primario px-3.5 text-[13px] font-bold text-white">
          Ver
        </button>
      </form>
      {puedeAvanzar ? (
        <Link href={`/admin/jornada?fecha=${next}`} className={flecha} aria-label="Día siguiente">
          <Icono name="chevron" className="h-4 w-4" />
        </Link>
      ) : (
        <span className={`${flecha} cursor-not-allowed opacity-40`} aria-hidden>
          <Icono name="chevron" className="h-4 w-4" />
        </span>
      )}
      {!esHoy && (
        <Link
          href="/admin/jornada"
          className="acto-activo flex h-9 items-center justify-center rounded-[12px] border border-azul px-3.5 text-[13px] font-bold text-azul"
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
        <PulsoTile etiqueta="Recaudado" valor={UYU(dia.totalRecaudado)} sub={`${dia.totalCobros} cobros`} color="var(--color-verde-osc)" />
        <PulsoTile etiqueta="Cobradores" valor={String(dia.cobradoresActivos)} sub="con actividad ese día" color="var(--color-azul)" />
        <PulsoTile
          etiqueta="Entregado"
          valor={dia.disponibleRendiciones ? UYU(entregado) : "—"}
          sub={dia.disponibleRendiciones ? `${rindieron} rindieron` : "sin rendición"}
          color="var(--color-tinta)"
        />
        <PulsoTile
          etiqueta="Faltantes"
          valor={String(faltantes)}
          sub={faltantes > 0 ? "en el cierre" : "sin faltantes"}
          color={faltantes > 0 ? "var(--color-rojo-osc)" : "var(--color-tenue)"}
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
