// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — EN VIVO (solo dev). Quién está en la app AHORA, en qué
//  pantalla, y qué HIZO hoy (no solo qué abrió): cobros, colocaciones, censos,
//  bases, deshechos, no-pagos, candados. Todo de HOY (día UY); lo viejo es
//  historia y vive en /admin/uso.
//
//  Fuentes, en paralelo y cada una a prueba de caída (una pata lenta no tumba
//  el tablero):
//    · eventos_uso  → navegación (pantalla actual, vistas de hoy)
//    · bitácora     → señales del cobrador (ver_ficha, no_pago, candado)
//    · actividad    → los HECHOS con plata (lib/data/actividad, ya humanizados)
//  Lecturas por service_role: la pantalla y el endpoint están dev-gated.
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getActividad } from "@/lib/data/actividad";
import { traerTodo } from "@/lib/data/paginado";
import { tablaFaltante } from "@/lib/data/errores";
import { conTimeout } from "@/lib/timeout";
import { fechaISOUY, inicioDiaUYIso } from "@/lib/fecha";
import {
  estadoPresencia,
  mezclarFeed,
  ordenarPersonas,
  resumenDe,
  type EnVivo,
  type ItemFeed,
  type PersonaVivo,
} from "@/lib/enVivo/clasificar";

const T_MS = 8000;
const NAVS_EN_FEED = 150;
const TOPE_FEED = 400;

/** Nunca tirar por una fuente: sin esa pata es mejor que sin tablero. Una tabla
 *  que falta (migración sin correr) y un cuelgue se tratan igual: vacío. */
async function segura<T>(p: PromiseLike<T>, vacio: T, etiqueta: string): Promise<T> {
  try {
    return await conTimeout(Promise.resolve(p), T_MS, etiqueta);
  } catch (e) {
    void tablaFaltante(e);
    return vacio;
  }
}

type Staff = { id: string; nombre: string; apodo: string | null; rol: string; zona_id: string | null };
type EvUso = { id: string; usuario_id: string | null; seccion: string | null; path: string; creado_en: string };
type EvBit = {
  id: string;
  actor_id: string | null;
  accion: string;
  monto: number | null;
  cliente_id: string | null;
  detalle: string | null;
  server_ts: string;
};

const mayor = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : a > b ? a : b);

export async function getEnVivo(ahora: Date = new Date()): Promise<EnVivo> {
  const admin = createSupabaseAdmin();
  const desdeIso = inicioDiaUYIso(ahora);
  const hoyYmd = fechaISOUY(ahora);

  const [staff, zonas, supZonas, navs, bit, hechosHoy] = await Promise.all([
    segura(
      admin
        .from("usuarios")
        .select("id, nombre, apodo, rol, zona_id")
        .eq("activo", true)
        .in("rol", ["admin", "supervisor", "cobrador"])
        .then((r) => (r.data ?? []) as Staff[]),
      [] as Staff[],
      "envivo:staff",
    ),
    segura(
      admin.from("zonas").select("id, nombre").then((r) => (r.data ?? []) as { id: string; nombre: string }[]),
      [],
      "envivo:zonas",
    ),
    segura(
      admin
        .from("supervisor_zonas")
        .select("supervisor_id, zona_id")
        .then((r) => (r.data ?? []) as { supervisor_id: string; zona_id: string }[]),
      [],
      "envivo:supzonas",
    ),
    // Navegación de HOY, entera (paginada: PostgREST corta en 1000 sin avisar).
    segura(
      traerTodo<EvUso>((d, h) =>
        admin
          .from("eventos_uso")
          .select("id, usuario_id, seccion, path, creado_en")
          .gte("creado_en", desdeIso)
          .order("id", { ascending: true })
          .range(d, h),
      ),
      [] as EvUso[],
      "envivo:navs",
    ),
    segura(
      traerTodo<EvBit>((d, h) =>
        admin
          .from("bitacora")
          .select("id, actor_id, accion, monto, cliente_id, detalle, server_ts")
          .eq("fecha_uy", hoyYmd)
          .order("id", { ascending: true })
          .range(d, h),
      ),
      [] as EvBit[],
      "envivo:bitacora",
    ),
    // Los hechos con plata, ya humanizados ("Cobró a NANCY ACOSTA", "Cargó la base de…").
    segura(getActividad(admin, desdeIso), [], "envivo:actividad"),
  ]);

  const zonaDe = new Map(zonas.map((z) => [z.id, z.nombre]));
  const zonaSup = new Map<string, string>();
  for (const s of supZonas) zonaSup.set(s.supervisor_id, zonaDe.get(s.zona_id) ?? "");
  const rolDe = new Map(staff.map((s) => [s.id, s.rol]));
  const nombreDe = new Map(staff.map((s) => [s.id, s.apodo || s.nombre]));

  // ── Navegación por persona: última pantalla, vistas de hoy ────────────
  type AccNav = { ultima: EvUso | null; n: number };
  const navPor = new Map<string, AccNav>();
  for (const ev of navs) {
    if (!ev.usuario_id) continue;
    const a = navPor.get(ev.usuario_id) ?? { ultima: null, n: 0 };
    a.n += 1;
    if (!a.ultima || ev.creado_en > a.ultima.creado_en) a.ultima = ev;
    navPor.set(ev.usuario_id, a);
  }

  // ── Bitácora: señal de vida + hechos que la actividad no cubre ────────
  const ultBit = new Map<string, string>();
  const clienteIds = new Set<string>();
  for (const b of bit) {
    if (b.actor_id) ultBit.set(b.actor_id, mayor(ultBit.get(b.actor_id) ?? null, b.server_ts) ?? b.server_ts);
    if ((b.accion === "no_pago" || b.accion.startsWith("Candado")) && b.cliente_id) clienteIds.add(b.cliente_id);
  }
  const nombreCliente = new Map<string, string>();
  if (clienteIds.size > 0) {
    const filas = await segura(
      admin
        .from("clientes")
        .select("id, nombre")
        .in("id", [...clienteIds].slice(0, 300))
        .then((r) => (r.data ?? []) as { id: string; nombre: string }[]),
      [],
      "envivo:clientes",
    );
    for (const c of filas) nombreCliente.set(c.id, c.nombre);
  }

  const feedBit: ItemFeed[] = [];
  for (const b of bit) {
    if (b.accion === "no_pago") {
      feedBit.push({
        id: `bn-${b.id}`,
        clase: "hecho",
        tipo: "no_pago",
        cuando: b.server_ts,
        actorId: b.actor_id,
        actor: (b.actor_id && nombreDe.get(b.actor_id)) || "alguien del equipo",
        rol: b.actor_id ? (rolDe.get(b.actor_id) ?? null) : null,
        titulo: `Marcó que no pagó ${(b.cliente_id && nombreCliente.get(b.cliente_id)) || "un cliente"}`,
        monto: null,
        detalle: b.detalle,
        alerta: false,
      });
    } else if (b.accion.startsWith("Candado")) {
      feedBit.push({
        id: `bc-${b.id}`,
        clase: "hecho",
        tipo: "candado",
        cuando: b.server_ts,
        actorId: b.actor_id,
        actor: (b.actor_id && nombreDe.get(b.actor_id)) || "alguien del equipo",
        rol: b.actor_id ? (rolDe.get(b.actor_id) ?? null) : null,
        titulo: `${b.accion}${b.cliente_id && nombreCliente.get(b.cliente_id) ? ` · ${nombreCliente.get(b.cliente_id)}` : ""}`,
        monto: b.monto != null ? Number(b.monto) : null,
        detalle: b.detalle,
        alerta: true,
      });
    }
  }

  // ── Hechos con plata (actividad) → feed + acumulados por persona ──────
  const feedHechos: ItemFeed[] = hechosHoy.map((e) => ({
    id: e.id,
    clase: "hecho" as const,
    tipo: e.tipo,
    cuando: e.cuando,
    actorId: e.actorId,
    actor: e.actor,
    rol: e.actorId ? (rolDe.get(e.actorId) ?? null) : null,
    titulo: e.titulo,
    monto: e.monto,
    detalle: e.detalle,
    alerta: e.alerta,
  }));
  type AccHecho = { n: number; cobros: number; cobrado: number; ultimo: ItemFeed | null };
  const hechoPor = new Map<string, AccHecho>();
  for (const h of [...feedHechos, ...feedBit]) {
    if (!h.actorId) continue;
    const a = hechoPor.get(h.actorId) ?? { n: 0, cobros: 0, cobrado: 0, ultimo: null };
    a.n += 1;
    if (h.tipo === "cobro") {
      a.cobros += 1;
      a.cobrado += h.monto ?? 0;
    }
    if (!a.ultimo || h.cuando > a.ultimo.cuando) a.ultimo = h;
    hechoPor.set(h.actorId, a);
  }

  // ── Navegación en el feed: las últimas N de hoy ───────────────────────
  const feedNav: ItemFeed[] = [...navs]
    .sort((a, b) => (a.creado_en < b.creado_en ? 1 : -1))
    .slice(0, NAVS_EN_FEED)
    .map((ev) => ({
      id: `nav-${ev.id}`,
      clase: "nav" as const,
      tipo: "nav",
      cuando: ev.creado_en,
      actorId: ev.usuario_id,
      actor: (ev.usuario_id && nombreDe.get(ev.usuario_id)) || "—",
      rol: ev.usuario_id ? (rolDe.get(ev.usuario_id) ?? null) : null,
      titulo: `Abrió ${ev.seccion ?? ev.path}`,
      monto: null,
      detalle: ev.path,
      alerta: false,
    }));

  const ahoraMs = ahora.getTime();
  const personas: PersonaVivo[] = staff.map((s) => {
    const nav = navPor.get(s.id);
    const he = hechoPor.get(s.id);
    const ultimaSenal = mayor(mayor(nav?.ultima?.creado_en ?? null, ultBit.get(s.id) ?? null), he?.ultimo?.cuando ?? null);
    return {
      id: s.id,
      nombre: s.apodo || s.nombre,
      rol: s.rol,
      zona: (s.zona_id ? zonaDe.get(s.zona_id) : zonaSup.get(s.id)) || null,
      estado: estadoPresencia(ultimaSenal, ahoraMs),
      ultimaSenalIso: ultimaSenal,
      seccionActual: nav?.ultima?.seccion ?? null,
      pathActual: nav?.ultima?.path ?? null,
      vistasHoy: nav?.n ?? 0,
      hechosHoy: he?.n ?? 0,
      cobrosHoy: he?.cobros ?? 0,
      cobradoHoy: he?.cobrado ?? 0,
      ultimoHecho: he?.ultimo ? { titulo: he.ultimo.titulo, cuando: he.ultimo.cuando, monto: he.ultimo.monto } : null,
    };
  });

  const feed = mezclarFeed([feedHechos, feedBit, feedNav], TOPE_FEED);
  const ordenadas = ordenarPersonas(personas);
  return {
    generadoEn: ahora.toISOString(),
    personas: ordenadas,
    feed,
    resumen: resumenDe(ordenadas, feed),
  };
}
