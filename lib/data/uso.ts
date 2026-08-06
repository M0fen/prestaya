// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — AUDITORÍA DE COMPORTAMIENTO DEL PERSONAL (solo dev/admin).
//  Combina cuatro señales por persona para auditar la capacitación:
//    · NAVEGACIÓN  → qué secciones abre (tabla eventos_uso, 0064).
//    · ACCESO      → último login (auth.users.last_sign_in_at).
//    · ACCIONES    → cosas que REALMENTE hizo (auditoria de gestor + bitácora GPS).
//    · COBERTURA   → qué secciones clave de su rol NO tocó (brecha de capacitación).
//  Lecturas por service_role (la pantalla es dev-gated). Insert por sesión propia.
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { NAV_ITEMS } from "@/lib/admin/nav";
import { tablaFaltante } from "./errores";
import { traerTodo } from "./paginado";
import { fechaISOUY, inicioDiaUYIso } from "@/lib/fecha";

// Secciones legibles: las del panel (de nav.ts) + las del cobrador.
const SECCIONES: { pre: string; label: string }[] = [
  ...NAV_ITEMS.map((i) => ({ pre: i.href, label: i.label })),
  { pre: "/cobrador", label: "Ruta (cobrador)" },
  { pre: "/cobrador/cliente", label: "Ficha de cliente (cobrador)" },
  { pre: "/cobrador/mis-numeros", label: "Mis números (cobrador)" },
  { pre: "/cobrador/censar", label: "Censar cliente (cobrador)" },
  { pre: "/cobrador/altas", label: "Altas / entrega de cartones (cobrador)" },
  { pre: "/cobrador/notas", label: "Notas (cobrador)" },
  { pre: "/cobrador/chat", label: "Chat (cobrador)" },
  { pre: "/cobrador/tutorial", label: "Tutorial (cobrador)" },
];

/** Etiqueta de sección legible a partir del path (prefijo más largo que matchea). */
export function seccionDePath(path: string): string {
  let best = { pre: "", label: path };
  for (const s of SECCIONES) {
    if ((path === s.pre || path.startsWith(s.pre + "/")) && s.pre.length >= best.pre.length) best = s;
  }
  return best.label;
}

/** Secciones CLAVE que se espera que cada rol use (para medir cobertura/brechas). */
export const SECCIONES_CLAVE: Record<string, string[]> = {
  cobrador: ["Ruta (cobrador)", "Ficha de cliente (cobrador)", "Mis números (cobrador)", "Censar cliente (cobrador)"],
  supervisor: ["Mi jornada", "Cobranza", "Recaudos", "Mora", "Caja diaria", "Centro de alertas", "Clientes"],
  admin: ["Dashboard", "Mi jornada", "Recaudos", "Caja diaria", "Mora", "Centro de alertas", "Ventas Crédito"],
};

/** (Server Action) Registra un evento de navegación del usuario logueado. */
export async function registrarUsoDb(
  db: SupabaseClient,
  e: { usuarioId: string; nombre: string; rol: string; path: string },
): Promise<void> {
  await db.from("eventos_uso").insert({
    usuario_id: e.usuarioId,
    usuario_nombre: e.nombre,
    rol: e.rol,
    path: e.path.slice(0, 300),
    seccion: seccionDePath(e.path),
  });
}

/**
 * ARRANQUE REAL DEL PILOTO. Todo lo anterior fue preparación y pruebas: perfiles
 * que se crearon, pantallas que se recorrieron para revisarlas, cobros de ensayo.
 * Medir la adopción contra eso no dice nada — por eso la pantalla ofrece esta
 * fecha como referencia limpia. Para correrla, se cambia acá y listo.
 */
export const PILOTO_ARRANQUE_UY = "2026-08-05";

/**
 * Minutos de silencio que separan una SESIÓN de la siguiente. Sirve para contar
 * "cuántas veces abrió la app" en vez de "cuántas pantallas miró": una persona que
 * entra 3 veces en el día es una señal distinta de una que hizo 200 clics de una.
 */
const CORTE_SESION_MIN = 30;

export interface UsoPersona {
  id: string;
  nombre: string;
  rol: string;
  zona: string | null; // nombre de la zona (null = sin zona)
  ultimoAccesoIso: string | null; // login
  ultimaVistaIso: string | null; // última navegación
  /** Primera navegación DE SIEMPRE (no de la ventana): cuándo se estrenó en la app. */
  estrenoIso: string | null;
  vistas: number;
  diasActivos: number; // días distintos con navegación (en la ventana)
  /** Veces que ABRIÓ la app en la ventana (cortes de 30 min de silencio). */
  sesiones: number;
  /** Navegación de HOY (día UY), para responder "¿quién está conectado hoy?". */
  vistasHoy: number;
  /** Actividad por día UY en la ventana, del más viejo al más nuevo (mini-barras). */
  porDia: { dia: string; n: number }[];
  acciones: number; // auditoría de gestor + bitácora del cobrador
  /** Sello del onboarding día 1: cuándo reemplazó la clave provisoria (null = todavía no). */
  claveCambiadaIso: string | null;
  /** Trabajo REAL de hoy: cobros vivos registrados por la persona. */
  cobrosHoy: number;
  cobradoHoy: number;
  secciones: { seccion: string; n: number }[]; // qué abrió, desc
  faltan: string[]; // secciones clave de su rol que NO tocó
}

export interface EventoUsoVista {
  usuarioId: string | null;
  nombre: string;
  rol: string;
  seccion: string;
  path: string;
  creadoEn: string;
}


/** Resumen de comportamiento por persona en una ventana (desde ISO). */
export async function getAuditoriaComportamiento(desdeIso: string): Promise<UsoPersona[]> {
  const admin = createSupabaseAdmin();
  const desdeYmd = fechaISOUY(new Date(desdeIso));

  // Staff interno activo (con su zona y el sello del onboarding).
  const { data: staff, error: eStaff } = await admin
    .from("usuarios")
    .select("id, nombre, rol, auth_user_id, zona_id, clave_cambiada_en")
    .eq("activo", true)
    .in("rol", ["admin", "supervisor", "cobrador"])
    .order("rol", { ascending: true })
    .order("nombre", { ascending: true });
  if (eStaff) throw eStaff;
  const personas = (staff ?? []) as {
    id: string;
    nombre: string;
    rol: string;
    auth_user_id: string | null;
    zona_id: string | null;
    clave_cambiada_en: string | null;
  }[];

  // Nombre de zona (los supervisores la tienen por supervisor_zonas, no por columna).
  const zonaDe = new Map<string, string>();
  try {
    const { data } = await admin.from("zonas").select("id, nombre");
    for (const z of data ?? []) zonaDe.set(z.id as string, z.nombre as string);
  } catch {
    /* sin zonas: columna queda null */
  }
  const zonaSupervisor = new Map<string, string>();
  try {
    const { data } = await admin.from("supervisor_zonas").select("supervisor_id, zona_id");
    for (const s of data ?? [])
      zonaSupervisor.set(s.supervisor_id as string, zonaDe.get(s.zona_id as string) ?? "");
  } catch {
    /* sin tabla: supervisores sin zona visible */
  }

  // Trabajo REAL de hoy: cobros vivos por persona (origen null = nativos de la app).
  const cobrosHoy = new Map<string, { n: number; monto: number }>();
  try {
    const { data } = await admin
      .from("pagos")
      .select("registrado_por, monto")
      .is("origen", null)
      .eq("anulado", false)
      .gte("registrado_en", inicioDiaUYIso())
      .limit(10000);
    for (const p of (data ?? []) as { registrado_por: string | null; monto: number }[]) {
      if (!p.registrado_por) continue;
      const acc = cobrosHoy.get(p.registrado_por) ?? { n: 0, monto: 0 };
      acc.n += 1;
      acc.monto += Number(p.monto);
      cobrosHoy.set(p.registrado_por, acc);
    }
  } catch {
    /* sin pagos legibles: los contadores quedan en 0 */
  }

  // Navegación (eventos_uso) de la ventana. Degrada si 0064 no corrió.
  // ⚠️ PAGINADO OBLIGATORIO: `.limit(30000)` NO manda — PostgREST corta en 1000
  // filas (ver paginado.ts) y devuelve 206 sin avisar. Medido contra producción:
  // la ventana "desde el arranque" tiene 1.074 eventos y la pantalla recibía
  // 1.000, así que TODA la mañana del día 1 del piloto era invisible; en 30 días
  // se perdían 1.670 de 2.670 y había gente con 142 vistas que figuraba en
  // "nunca abrió la app". Se ordena por `id` (único y estable) como exige el
  // helper: `creado_en` tiene empates y rompe el `.range()`.
  let eventos: { usuario_id: string | null; seccion: string | null; creado_en: string }[] = [];
  try {
    eventos = await traerTodo<{ usuario_id: string | null; seccion: string | null; creado_en: string }>(
      (d, h) =>
        admin
          .from("eventos_uso")
          .select("usuario_id, seccion, creado_en")
          .gte("creado_en", desdeIso)
          .order("id", { ascending: true })
          .range(d, h),
    );
  } catch (e) {
    if (!tablaFaltante(e)) throw e;
  }

  // Último acceso (login) desde auth.
  const login = new Map<string, string | null>();
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of data?.users ?? []) login.set(u.id, u.last_sign_in_at ?? null);
  } catch {
    /* sin permisos de auth admin: sin último acceso */
  }

  // Acciones reales: auditoría (gestor) + bitácora (cobrador), por actor.
  const acciones = new Map<string, number>();
  const sumar = (id: string | null) => {
    if (id) acciones.set(id, (acciones.get(id) ?? 0) + 1);
  };
  try {
    const { data } = await admin.from("auditoria").select("actor_id").gte("creado_en", desdeIso).limit(20000);
    for (const a of data ?? []) sumar((a as { actor_id: string | null }).actor_id);
  } catch (e) {
    if (!tablaFaltante(e)) throw e;
  }
  try {
    const { data } = await admin.from("bitacora").select("actor_id").gte("fecha_uy", desdeYmd).limit(30000);
    for (const b of data ?? []) sumar((b as { actor_id: string | null }).actor_id);
  } catch (e) {
    if (!tablaFaltante(e)) throw e;
  }

  // ESTRENO: primera navegación de SIEMPRE (fuera de la ventana). Responde "¿ya
  // se estrenó en la app?" aunque la ventana elegida no lo alcance — sin esto, un
  // cobrador que entró una vez hace un mes figuraba igual que uno que nunca entró.
  // ⚠️ Mismo tope de 1000: sin paginar, este barrido ASC se quedaba con los
  // eventos MÁS VIEJOS y el piloto entero caía afuera → 8 personas que SÍ habían
  // entrado salían pintadas de rojo como "NUNCA abrió la app". Se pagina por `id`
  // y el mínimo por persona se calcula acá (el orden de `id` no es cronológico).
  const estreno = new Map<string, string>();
  try {
    const filas = await traerTodo<{ usuario_id: string | null; creado_en: string }>((d, h) =>
      admin.from("eventos_uso").select("usuario_id, creado_en").order("id", { ascending: true }).range(d, h),
    );
    for (const e of filas) {
      if (!e.usuario_id) continue;
      const previo = estreno.get(e.usuario_id);
      if (!previo || e.creado_en < previo) estreno.set(e.usuario_id, e.creado_en);
    }
  } catch (e) {
    if (!tablaFaltante(e)) throw e;
  }

  // Agregar por persona.
  const hoyYmd = fechaISOUY(new Date());
  type Acc = {
    vistas: number;
    dias: Map<string, number>;
    ultima: string | null;
    secc: Map<string, number>;
    hoy: number;
    marcas: number[]; // instantes (ms) para contar sesiones
  };
  const porUser = new Map<string, Acc>();
  for (const ev of eventos) {
    const id = ev.usuario_id;
    if (!id) continue;
    let acc = porUser.get(id);
    if (!acc) {
      acc = { vistas: 0, dias: new Map(), ultima: null, secc: new Map(), hoy: 0, marcas: [] };
      porUser.set(id, acc);
    }
    acc.vistas += 1;
    const dia = fechaISOUY(new Date(ev.creado_en));
    acc.dias.set(dia, (acc.dias.get(dia) ?? 0) + 1);
    if (dia === hoyYmd) acc.hoy += 1;
    acc.marcas.push(new Date(ev.creado_en).getTime());
    if (!acc.ultima || ev.creado_en > acc.ultima) acc.ultima = ev.creado_en;
    const s = ev.seccion ?? "—";
    acc.secc.set(s, (acc.secc.get(s) ?? 0) + 1);
  }

  /** Veces que abrió la app: cada hueco de silencio > CORTE_SESION_MIN es una sesión nueva. */
  const contarSesiones = (marcas: number[]): number => {
    if (marcas.length === 0) return 0;
    const orden = [...marcas].sort((a, b) => a - b);
    let n = 1;
    for (let i = 1; i < orden.length; i++) {
      if (orden[i] - orden[i - 1] > CORTE_SESION_MIN * 60000) n += 1;
    }
    return n;
  };

  return personas.map((p) => {
    const a = porUser.get(p.id);
    const secciones = a
      ? [...a.secc.entries()].map(([seccion, n]) => ({ seccion, n })).sort((x, y) => y.n - x.n)
      : [];
    const usadas = new Set(secciones.map((s) => s.seccion));
    const clave = SECCIONES_CLAVE[p.rol] ?? [];
    const hoy = cobrosHoy.get(p.id);
    return {
      id: p.id,
      nombre: p.nombre,
      rol: p.rol,
      zona: (p.zona_id ? zonaDe.get(p.zona_id) : zonaSupervisor.get(p.id)) || null,
      ultimoAccesoIso: p.auth_user_id ? login.get(p.auth_user_id) ?? null : null,
      ultimaVistaIso: a?.ultima ?? null,
      estrenoIso: estreno.get(p.id) ?? null,
      vistas: a?.vistas ?? 0,
      diasActivos: a?.dias.size ?? 0,
      sesiones: contarSesiones(a?.marcas ?? []),
      vistasHoy: a?.hoy ?? 0,
      porDia: [...(a?.dias.entries() ?? [])]
        .map(([dia, n]) => ({ dia, n }))
        .sort((x, y) => (x.dia < y.dia ? -1 : 1)),
      acciones: acciones.get(p.id) ?? 0,
      claveCambiadaIso: p.clave_cambiada_en,
      cobrosHoy: hoy?.n ?? 0,
      cobradoHoy: hoy?.monto ?? 0,
      secciones,
      faltan: clave.filter((s) => !usadas.has(s)),
    };
  });
}

const mapEvento = (r: Record<string, unknown>): EventoUsoVista => ({
  usuarioId: (r.usuario_id as string | null) ?? null,
  nombre: (r.usuario_nombre as string | null) ?? "—",
  rol: (r.rol as string | null) ?? "—",
  seccion: (r.seccion as string | null) ?? "—",
  path: (r.path as string | null) ?? "—",
  creadoEn: r.creado_en as string,
});

/** Actividad reciente global (últimas navegaciones), para el timeline. Filtrable por rol. */
export async function getActividadReciente(limite = 120, rol?: string): Promise<EventoUsoVista[]> {
  const admin = createSupabaseAdmin();
  try {
    let q = admin
      .from("eventos_uso")
      .select("usuario_id, usuario_nombre, rol, seccion, path, creado_en")
      .order("creado_en", { ascending: false })
      .limit(limite);
    if (rol) q = q.eq("rol", rol);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(mapEvento);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Historial COMPLETO de una persona (drill-down): cada navegación con path + hora. */
export async function getEventosDePersona(usuarioId: string, desdeIso: string, limite = 300): Promise<EventoUsoVista[]> {
  const admin = createSupabaseAdmin();
  try {
    const { data, error } = await admin
      .from("eventos_uso")
      .select("usuario_id, usuario_nombre, rol, seccion, path, creado_en")
      .eq("usuario_id", usuarioId)
      .gte("creado_en", desdeIso)
      .order("creado_en", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []).map(mapEvento);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}
