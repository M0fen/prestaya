// ─────────────────────────────────────────────────────────────────────────
//  Sesión y roles del panel admin.
//  Resuelve el usuario del SISTEMA (tabla usuarios) a partir del login de
//  Supabase Auth (auth.uid → usuarios.auth_user_id). Las consultas del panel
//  corren como ese usuario (cliente SSR anónimo) y respetan el RLS por rol.
// ─────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioPorAuthId } from "@/lib/data/usuarios";
import type { Rol, Usuario } from "@/types/db";

/** Usuario interno logueado, o null si no hay sesión / no es del sistema. */
export async function getUsuarioActual(): Promise<Usuario | null> {
  const db = await createSupabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  return getUsuarioPorAuthId(db, user.id);
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
