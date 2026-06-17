// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CLIENTES.
//  Funciones tipadas para leer clientes. No mezclar con UI.
//  Reciben el cliente Supabase por parámetro (inyección): así la misma
//  función sirve con el cliente admin (vista por token) o anónimo (RLS).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cliente } from "@/types/db";

/** Convierte una fila cruda de Supabase en un Cliente tipado. */
function mapCliente(r: Record<string, unknown>): Cliente {
  return {
    id: r.id as string,
    nombre: r.nombre as string,
    documento: (r.documento as string | null) ?? null,
    telefono: (r.telefono as string | null) ?? null,
    direccion: (r.direccion as string | null) ?? null,
    token_acceso: r.token_acceso as string,
    calificacion: r.calificacion as Cliente["calificacion"],
    notas: (r.notas as string | null) ?? null,
    activo: r.activo as boolean,
    creado_en: r.creado_en as string,
    actualizado_en: r.actualizado_en as string,
  };
}

/**
 * Busca un cliente ACTIVO por su token de acceso (link de solo lectura).
 * Devuelve null si el token no existe o el cliente está inactivo.
 */
export async function getClientePorToken(
  db: SupabaseClient,
  token: string,
): Promise<Cliente | null> {
  const { data, error } = await db
    .from("clientes")
    .select("*")
    .eq("token_acceso", token)
    .eq("activo", true)
    .maybeSingle();

  if (error) throw error;
  return data ? mapCliente(data) : null;
}

/** Busca un cliente por su id. */
export async function getClientePorId(
  db: SupabaseClient,
  id: string,
): Promise<Cliente | null> {
  const { data, error } = await db
    .from("clientes")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapCliente(data) : null;
}
