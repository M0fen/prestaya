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

// Secciones legibles: las del panel (de nav.ts) + las del cobrador.
const SECCIONES: { pre: string; label: string }[] = [
  ...NAV_ITEMS.map((i) => ({ pre: i.href, label: i.label })),
  { pre: "/cobrador", label: "Ruta (cobrador)" },
  { pre: "/cobrador/cliente", label: "Ficha de cliente (cobrador)" },
  { pre: "/cobrador/mis-numeros", label: "Mis números (cobrador)" },
  { pre: "/cobrador/censar", label: "Censar cliente (cobrador)" },
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

export interface UsoPersona {
  id: string;
  nombre: string;
  rol: string;
  ultimoAccesoIso: string | null; // login
  ultimaVistaIso: string | null; // última navegación
  vistas: number;
  diasActivos: number; // días distintos con navegación (en la ventana)
  acciones: number; // auditoría de gestor + bitácora del cobrador
  secciones: { seccion: string; n: number }[]; // qué abrió, desc
  faltan: string[]; // secciones clave de su rol que NO tocó
}

export interface EventoUsoVista {
  nombre: string;
  rol: string;
  seccion: string;
  creadoEn: string;
}

const diaUY = (iso: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(new Date(iso));

/** Resumen de comportamiento por persona en una ventana (desde ISO). */
export async function getAuditoriaComportamiento(desdeIso: string): Promise<UsoPersona[]> {
  const admin = createSupabaseAdmin();
  const desdeYmd = diaUY(desdeIso);

  // Staff interno activo.
  const { data: staff, error: eStaff } = await admin
    .from("usuarios")
    .select("id, nombre, rol, auth_user_id")
    .eq("activo", true)
    .in("rol", ["admin", "supervisor", "cobrador"])
    .order("rol", { ascending: true })
    .order("nombre", { ascending: true });
  if (eStaff) throw eStaff;
  const personas = (staff ?? []) as { id: string; nombre: string; rol: string; auth_user_id: string | null }[];

  // Navegación (eventos_uso) de la ventana. Degrada si 0064 no corrió.
  let eventos: { usuario_id: string | null; seccion: string | null; creado_en: string }[] = [];
  try {
    const { data, error } = await admin
      .from("eventos_uso")
      .select("usuario_id, seccion, creado_en")
      .gte("creado_en", desdeIso)
      .order("creado_en", { ascending: false })
      .limit(30000);
    if (error) throw error;
    eventos = data ?? [];
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

  // Agregar por persona.
  const porUser = new Map<string, { vistas: number; dias: Set<string>; ultima: string | null; secc: Map<string, number> }>();
  for (const ev of eventos) {
    const id = ev.usuario_id;
    if (!id) continue;
    let acc = porUser.get(id);
    if (!acc) {
      acc = { vistas: 0, dias: new Set(), ultima: null, secc: new Map() };
      porUser.set(id, acc);
    }
    acc.vistas += 1;
    acc.dias.add(diaUY(ev.creado_en));
    if (!acc.ultima || ev.creado_en > acc.ultima) acc.ultima = ev.creado_en;
    const s = ev.seccion ?? "—";
    acc.secc.set(s, (acc.secc.get(s) ?? 0) + 1);
  }

  return personas.map((p) => {
    const a = porUser.get(p.id);
    const secciones = a
      ? [...a.secc.entries()].map(([seccion, n]) => ({ seccion, n })).sort((x, y) => y.n - x.n)
      : [];
    const usadas = new Set(secciones.map((s) => s.seccion));
    const clave = SECCIONES_CLAVE[p.rol] ?? [];
    return {
      id: p.id,
      nombre: p.nombre,
      rol: p.rol,
      ultimoAccesoIso: p.auth_user_id ? login.get(p.auth_user_id) ?? null : null,
      ultimaVistaIso: a?.ultima ?? null,
      vistas: a?.vistas ?? 0,
      diasActivos: a?.dias.size ?? 0,
      acciones: acciones.get(p.id) ?? 0,
      secciones,
      faltan: clave.filter((s) => !usadas.has(s)),
    };
  });
}

/** Actividad reciente global (últimas navegaciones), para el timeline. */
export async function getActividadReciente(limite = 60): Promise<EventoUsoVista[]> {
  const admin = createSupabaseAdmin();
  try {
    const { data, error } = await admin
      .from("eventos_uso")
      .select("usuario_nombre, rol, seccion, creado_en")
      .order("creado_en", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      nombre: (r.usuario_nombre as string | null) ?? "—",
      rol: (r.rol as string | null) ?? "—",
      seccion: (r.seccion as string | null) ?? "—",
      creadoEn: r.creado_en as string,
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}
