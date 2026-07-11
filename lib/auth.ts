// ─────────────────────────────────────────────────────────────────────────
//  Sesión y roles del panel admin.
//  Resuelve el usuario del SISTEMA (tabla usuarios) a partir del login de
//  Supabase Auth (auth.uid → usuarios.auth_user_id). Las consultas del panel
//  corren como ese usuario (cliente SSR anónimo) y respetan el RLS por rol.
// ─────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioPorAuthId } from "@/lib/data/usuarios";
import { getZonasDeSupervisor } from "@/lib/data/zonas";
import { actorDesde, type Actor } from "@/lib/permisos";
import type { Rol, Usuario } from "@/types/db";

/** Usuario interno logueado, o null si no hay sesión / no es del sistema. */
export async function getUsuarioActual(): Promise<Usuario | null> {
  const db = await createSupabaseServer();
  // getUser() puede LANZAR (o devolver error) si el token está vencido/roto y el
  // refresh falla con 400 "Bad Request". Eso NO es un crash: es "no hay sesión"
  // → devolvemos null y las guardas mandan al login. Antes tumbaba la página.
  try {
    const {
      data: { user },
      error,
    } = await db.auth.getUser();
    if (error || !user) return null;
    return await getUsuarioPorAuthId(db, user.id);
  } catch {
    return null;
  }
}

/** Exige un usuario interno ACTIVO; si no, manda al login. Devuelve el usuario. */
export async function requireUsuario(): Promise<Usuario> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) redirect("/admin/login");
  return u;
}

/** Exige rol de gestor (admin o supervisor). Si no, vuelve al panel. */
export async function requireGestor(): Promise<Usuario> {
  const u = await requireUsuario();
  if (!esGestor(u.rol)) redirect("/admin");
  return u;
}

/** Exige rol ADMIN (el dueño). Para acciones sensibles que el supervisor no
 *  puede hacer (política de mora, comisiones, y a futuro anular pagos). */
export async function requireAdmin(): Promise<Usuario> {
  const u = await requireUsuario();
  if (!esAdmin(u.rol)) redirect("/admin");
  return u;
}

/** ¿Es desarrollador? (admin con la marca es_dev → herramientas extra). */
export const esDev = (u: Pick<Usuario, "es_dev">): boolean => !!u.es_dev;

/** Exige desarrollador; si no, vuelve al panel. Para la pantalla /admin/dev. */
export async function requireDev(): Promise<Usuario> {
  const u = await requireUsuario();
  if (!esDev(u)) redirect("/admin");
  return u;
}

/**
 * Actor de permisos por ZONA del usuario actual (rol + zonas). Trae las zonas
 * que supervisa (solo relevante para el supervisor). Devuelve null sin sesión.
 * Es el puente entre la sesión y el núcleo puro `lib/permisos.ts`.
 */
export async function getActorActual(): Promise<Actor | null> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return null;
  return actorDeUsuario(u);
}

/**
 * Actor a partir de un usuario YA resuelto (evita re-consultar la sesión con
 * getUser()). Úsalo cuando la página ya tiene el usuario de requireGestor():
 * la sesión se lee UNA vez, no 2-3. Solo agrega las zonas del supervisor.
 */
export async function actorDeUsuario(u: Usuario): Promise<Actor> {
  const zonas = u.rol === "supervisor" ? await getZonasDeSupervisor(await createSupabaseServer(), u.id) : [];
  return actorDesde(u, zonas);
}

export const esGestor = (rol: Rol): boolean =>
  rol === "admin" || rol === "supervisor";

export const esAdmin = (rol: Rol): boolean => rol === "admin";

export const esCobrador = (rol: Rol): boolean => rol === "cobrador";

/** Ruta de inicio según el rol: gestores al panel, cobradores a su app. */
export const rutaHome = (rol: Rol): string =>
  esGestor(rol) ? "/admin" : "/cobrador";

/** Etiqueta legible del rol para la UI. */
export const etiquetaRol: Record<Rol, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  cobrador: "Cobrador",
};
