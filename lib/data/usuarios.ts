// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — USUARIOS del sistema (admin / supervisor / cobrador).
//  Resuelve el usuario del sistema a partir del login de Supabase (auth).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Usuario } from "@/types/db";

/** Convierte una fila cruda en un Usuario tipado. */
function mapUsuario(r: Record<string, unknown>): Usuario {
  return {
    id: r.id as string,
    nombre: r.nombre as string,
    telefono: (r.telefono as string | null) ?? null,
    rol: r.rol as Usuario["rol"],
    activo: r.activo as boolean,
    auth_user_id: (r.auth_user_id as string | null) ?? null,
    zona_id: (r.zona_id as string | null) ?? null,
    es_dev: (r.es_dev as boolean | undefined) ?? false,
    creado_en: r.creado_en as string,
    actualizado_en: r.actualizado_en as string,
  };
}

/**
 * Devuelve el usuario del sistema vinculado a un login de Supabase (auth.uid).
 * Útil para resolver el rol del usuario autenticado.
 */
export async function getUsuarioPorAuthId(
  db: SupabaseClient,
  authUserId: string,
): Promise<Usuario | null> {
  const { data, error } = await db
    .from("usuarios")
    .select("*")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapUsuario(data) : null;
}

/**
 * Vendedores (cobradores + supervisores) ACTIVOS para poblar los <select> de
 * filtro por vendedor (Recaudos, Capital, Informe de cartera). Ordenados por
 * nombre. Corre como gestor (RLS ve todos).
 */
export async function getVendedores(
  db: SupabaseClient,
): Promise<{ id: string; nombre: string }[]> {
  const { data, error } = await db
    .from("usuarios")
    .select("id, nombre")
    .eq("activo", true)
    .in("rol", ["cobrador", "supervisor"])
    .order("nombre", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((u) => ({ id: u.id as string, nombre: u.nombre as string }));
}
