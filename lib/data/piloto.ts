// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — PANEL DEL PILOTO (solo dev). Junta en una sola lectura lo
//  que hasta ahora había que ir a buscar a seis pantallas y tres scripts:
//    · salud técnica   → vigilante (cron de reconciliación), respaldo, kill switch, incidencias
//    · adopción        → 14 días de recaudo nativo, cobros, cobradores cobrando, colocado, actas, bases
//    · equipo          → cada cobrador en la última semana (cobros, plata, última acta/base)
//    · plata a cuidar  → sin ruta con crédito vivo, en silencio, pendientes de aprobar, jornadas sin acta
//    · pendientes      → la agenda (0157)
//  Cada pata degrada sola (conTimeout + vacío): el panel se muestra igual con
//  una fuente caída, y lo dice.
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { conTimeout } from "@/lib/timeout";
import { traerTodo } from "@/lib/data/paginado";
import { fechaISOUY, diaUYInicioIso } from "@/lib/fecha";
import { getHistorialReconciliacion, getUltimoRespaldo, type CorridaRecon, type EstadoRespaldo } from "@/lib/data/reconciliacion";
import { escrituraCongelada } from "@/lib/data/featureFlags";
import { contarIncidenciasAbiertas, getIncidencias, type Incidencia } from "@/lib/data/incidencias";
import { getClientesSinRuta, getCobradoresEnSilencio } from "@/lib/data/operacion";
import { contarSolicitudesGastoPendientes } from "@/lib/data/solicitudesGasto";
import { getSolicitudesPendientes as getAnulacionesPendientes } from "@/lib/data/anulaciones";
import { getJornadasSinRendir } from "@/lib/data/rendicion";
import { getPendientes, type Pendiente } from "@/lib/data/pilotoPendientes";
import type { Alcance } from "@/lib/data/alcance";
import { acumular, serieDe, ultimosDias, type PuntoDia } from "@/lib/piloto/series";

const T_MS = 8000;
const DIAS = 14;

async function segura<T>(p: PromiseLike<T>, vacio: T, etiqueta: string, caidas: string[]): Promise<T> {
  try {
    return await conTimeout(Promise.resolve(p), T_MS, etiqueta);
  } catch {
    caidas.push(etiqueta);
    return vacio;
  }
}

export interface SaludPiloto {
  cron: { ultima: CorridaRecon | null; horas: number | null; caido: boolean };
  respaldo: EstadoRespaldo | null;
  congelado: boolean;
  incidenciasAbiertas: number;
}

export interface SeriesPiloto {
  dias: string[];
  recaudo: PuntoDia[];
  cobros: PuntoDia[];
  cobradores: PuntoDia[];
  colocado: PuntoDia[];
  actas: PuntoDia[];
  bases: PuntoDia[];
}

export interface CobradorSemana {
  id: string;
  nombre: string;
  zona: string | null;
  cobros7: number;
  recaudo7: number;
  diasActivos7: number;
  ultimoCobro: string | null; // ISO
  ultimaActa: string | null; // YYYY-MM-DD
  ultimaBase: string | null; // YYYY-MM-DD
}

export interface PlataPiloto {
  sinRuta: { n: number; monto: number; nombres: string[] };
  silencio: { n: number; monto: number; lista: { nombre: string; dias: number; monto: number }[] };
  nuncaCobraron: { n: number; monto: number };
  gastosPendientes: number;
  anulacionesPendientes: number;
  jornadasSinActa14: number;
}

export interface PanelPiloto {
  generadoEn: string;
  hoy: string;
  salud: SaludPiloto;
  series: SeriesPiloto;
  equipo: CobradorSemana[];
  plata: PlataPiloto;
  incidencias: Incidencia[];
  pendientes: Pendiente[];
  /** Fuentes que no respondieron (se muestran como aviso, no se esconden). */
  caidas: string[];
}

type PagoFila = { id: string; registrado_por: string | null; registrado_en: string; monto: number };
type CredFila = { id: string; creado_en: string; monto_prestado: number };
type ActaFila = { cobrador_id: string; fecha: string };
type Staff = { id: string; nombre: string; apodo: string | null; zona_id: string | null };

export async function getPanelPiloto(alcance: Alcance, ahora: Date = new Date()): Promise<PanelPiloto> {
  const admin = createSupabaseAdmin();
  const caidas: string[] = [];
  const hoy = fechaISOUY(ahora);
  const dias = ultimosDias(hoy, DIAS);
  const desdeYmd = dias[0];
  const desdeIso = diaUYInicioIso(desdeYmd);
  const dias7 = new Set(ultimosDias(hoy, 7));

  const [historial, respaldo, congelado, incAbiertas, incidencias, pagos, creditos, actas, bases, staff, zonas, sinRuta, silencio, gastos, anulaciones, jornadas, pendientes] =
    await Promise.all([
      segura(getHistorialReconciliacion(admin, 14), [] as CorridaRecon[], "reconciliación", caidas),
      segura(getUltimoRespaldo(admin), null as EstadoRespaldo | null, "respaldo", caidas),
      segura(escrituraCongelada(), false, "kill switch", caidas),
      segura(contarIncidenciasAbiertas(admin), 0, "incidencias", caidas),
      segura(getIncidencias(admin, "abierto"), [] as Incidencia[], "incidencias abiertas", caidas),
      segura(
        traerTodo<PagoFila>((d, h) =>
          admin
            .from("pagos")
            .select("id, registrado_por, registrado_en, monto")
            .eq("anulado", false)
            .is("origen", null)
            .gte("registrado_en", desdeIso)
            .order("id", { ascending: true })
            .range(d, h),
        ),
        [] as PagoFila[],
        "pagos nativos",
        caidas,
      ),
      segura(
        // Solo `creado_por`: el empalme le estampa `disapp_credit_id` al crédito
        // nativo cuando lo adopta, así que filtrar por eso borraba hacia atrás lo
        // que la app había colocado (medido el 08-09: 61 créditos / $840.500 reales
        // contra 3 / $42.000 mostrados). Paginado por `id`: `.limit(5000)` no manda,
        // PostgREST corta en 1000 en silencio.
        traerTodo<CredFila>((d, h) =>
          admin
            .from("prestamos")
            .select("id, creado_en, monto_prestado")
            .not("creado_por", "is", null)
            .neq("estado", "cancelado")
            .gte("creado_en", desdeIso)
            .order("id", { ascending: true })
            .range(d, h),
        ),
        [] as CredFila[],
        "créditos nativos",
        caidas,
      ),
      // `unique (cobrador_id, fecha)` les pone techo (52 × 14 = 728), pero se
      // paginan igual: un `.limit()` que se acerque a 1000 se corta sin avisar.
      segura(
        traerTodo<ActaFila>((d, h) =>
          admin.from("rendiciones").select("cobrador_id, fecha").gte("fecha", desdeYmd)
            .order("id", { ascending: true }).range(d, h),
        ),
        [] as ActaFila[],
        "actas",
        caidas,
      ),
      segura(
        traerTodo<ActaFila>((d, h) =>
          admin.from("aperturas_caja").select("cobrador_id, fecha").gte("fecha", desdeYmd)
            .order("id", { ascending: true }).range(d, h),
        ),
        [] as ActaFila[],
        "bases",
        caidas,
      ),
      segura(
        admin
          .from("usuarios")
          .select("id, nombre, apodo, zona_id")
          .eq("activo", true)
          .eq("rol", "cobrador")
          .order("nombre", { ascending: true })
          .then((r) => (r.data ?? []) as Staff[]),
        [] as Staff[],
        "cobradores",
        caidas,
      ),
      segura(
        admin.from("zonas").select("id, nombre").then((r) => (r.data ?? []) as { id: string; nombre: string }[]),
        [] as { id: string; nombre: string }[],
        "zonas",
        caidas,
      ),
      segura(getClientesSinRuta(200), null, "sin ruta", caidas),
      segura(getCobradoresEnSilencio(admin, alcance), [], "silencio", caidas),
      segura(contarSolicitudesGastoPendientes(admin, null), 0, "gastos pendientes", caidas),
      segura(getAnulacionesPendientes(admin, alcance), [], "anulaciones pendientes", caidas),
      segura(getJornadasSinRendir(admin, null, ahora, DIAS), [], "jornadas sin acta", caidas),
      segura(getPendientes(), [] as Pendiente[], "pendientes", caidas),
    ]);

  // ── Series por día (UY) ────────────────────────────────────────────────
  const recaudo = new Map<string, number>();
  const cobros = new Map<string, number>();
  const cobradoresDia = new Map<string, Set<string>>();
  const colocado = new Map<string, number>();
  const actasDia = new Map<string, number>();
  const basesDia = new Map<string, number>();
  for (const p of pagos) {
    const dia = fechaISOUY(new Date(p.registrado_en));
    acumular(recaudo, dia, Number(p.monto));
    acumular(cobros, dia, 1);
    if (p.registrado_por) {
      const s = cobradoresDia.get(dia) ?? new Set<string>();
      s.add(p.registrado_por);
      cobradoresDia.set(dia, s);
    }
  }
  for (const c of creditos) acumular(colocado, fechaISOUY(new Date(c.creado_en)), Number(c.monto_prestado));
  for (const a of actas) acumular(actasDia, String(a.fecha), 1);
  for (const b of bases) acumular(basesDia, String(b.fecha), 1);
  const cobradoresN = new Map<string, number>();
  for (const [dia, s] of cobradoresDia) cobradoresN.set(dia, s.size);

  // ── Equipo: cada cobrador en la última semana ──────────────────────────
  const zonaDe = new Map(zonas.map((z) => [z.id, z.nombre]));
  type Acc = { cobros: number; recaudo: number; dias: Set<string>; ultimo: string | null };
  const porCob = new Map<string, Acc>();
  for (const p of pagos) {
    if (!p.registrado_por) continue;
    const dia = fechaISOUY(new Date(p.registrado_en));
    if (!dias7.has(dia)) continue;
    const a = porCob.get(p.registrado_por) ?? { cobros: 0, recaudo: 0, dias: new Set<string>(), ultimo: null };
    a.cobros += 1;
    a.recaudo += Number(p.monto);
    a.dias.add(dia);
    if (!a.ultimo || p.registrado_en > a.ultimo) a.ultimo = p.registrado_en;
    porCob.set(p.registrado_por, a);
  }
  const ultimaActa = new Map<string, string>();
  for (const a of actas) {
    const f = String(a.fecha);
    if ((ultimaActa.get(a.cobrador_id) ?? "") < f) ultimaActa.set(a.cobrador_id, f);
  }
  const ultimaBase = new Map<string, string>();
  for (const b of bases) {
    const f = String(b.fecha);
    if ((ultimaBase.get(b.cobrador_id) ?? "") < f) ultimaBase.set(b.cobrador_id, f);
  }
  const equipo: CobradorSemana[] = staff
    .map((s) => {
      const a = porCob.get(s.id);
      return {
        id: s.id,
        nombre: s.apodo || s.nombre,
        zona: s.zona_id ? (zonaDe.get(s.zona_id) ?? null) : null,
        cobros7: a?.cobros ?? 0,
        recaudo7: a?.recaudo ?? 0,
        diasActivos7: a?.dias.size ?? 0,
        ultimoCobro: a?.ultimo ?? null,
        ultimaActa: ultimaActa.get(s.id) ?? null,
        ultimaBase: ultimaBase.get(s.id) ?? null,
      };
    })
    .sort((x, y) => y.recaudo7 - x.recaudo7 || x.nombre.localeCompare(y.nombre));

  // ── Plata a cuidar ─────────────────────────────────────────────────────
  const conSilencio = silencio.filter((c) => c.diasSinCobrar !== null && (c.diasSinCobrar ?? 0) >= 3);
  const nunca = silencio.filter((c) => c.diasSinCobrar === null);
  const ultimaCron = historial.find((h) => h.origen === "cron") ?? null;
  const horasCron = ultimaCron ? (ahora.getTime() - new Date(ultimaCron.corridaEn).getTime()) / 3_600_000 : null;

  return {
    generadoEn: ahora.toISOString(),
    hoy,
    salud: {
      cron: { ultima: ultimaCron, horas: horasCron, caido: horasCron === null || horasCron > 26 },
      respaldo,
      congelado,
      incidenciasAbiertas: incAbiertas,
    },
    series: {
      dias,
      recaudo: serieDe(dias, recaudo),
      cobros: serieDe(dias, cobros),
      cobradores: serieDe(dias, cobradoresN),
      colocado: serieDe(dias, colocado),
      actas: serieDe(dias, actasDia),
      bases: serieDe(dias, basesDia),
    },
    equipo,
    plata: {
      sinRuta: {
        n: sinRuta?.conPlataViva.length ?? 0,
        monto: sinRuta?.conPlataViva.reduce((s, c) => s + c.capitalVivo, 0) ?? 0,
        nombres: (sinRuta?.conPlataViva ?? []).slice(0, 6).map((c) => c.nombre),
      },
      silencio: {
        n: conSilencio.length,
        monto: conSilencio.reduce((s, c) => s + c.capitalVivo, 0),
        lista: conSilencio
          .slice()
          .sort((a, b) => b.capitalVivo - a.capitalVivo)
          .slice(0, 8)
          .map((c) => ({ nombre: c.nombre, dias: c.diasSinCobrar ?? 0, monto: c.capitalVivo })),
      },
      nuncaCobraron: { n: nunca.length, monto: nunca.reduce((s, c) => s + c.capitalVivo, 0) },
      gastosPendientes: gastos,
      anulacionesPendientes: anulaciones.length,
      jornadasSinActa14: jornadas.length,
    },
    incidencias: incidencias.slice(0, 8),
    pendientes,
    caidas,
  };
}
