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
    // Defensivo: si la migración 0005 aún no corrió, `origen` viene undefined.
    origen: (r.origen as Cliente["origen"]) ?? "oficina",
    creado_por: (r.creado_por as string | null) ?? null,
    gps_lat: r.gps_lat == null ? null : Number(r.gps_lat),
    gps_lng: r.gps_lng == null ? null : Number(r.gps_lng),
    creado_en: r.creado_en as string,
    actualizado_en: r.actualizado_en as string,
  };
}

/** Datos para censar (dar de alta) un cliente desde la app del cobrador. */
export interface NuevoClienteCenso {
  nombre: string;
  documento: string | null;
  telefono: string | null;
  direccion: string | null;
  notas: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  /** usuarios.id del cobrador/gestor que lo releva. */
  creado_por: string | null;
}

/**
 * Crea un cliente censado en calle (origen = "censo"). El token de acceso y la
 * calificación "nuevo" los pone la BD por defecto. Se invoca desde la Server
 * Action del cobrador (service_role), nunca desde el navegador.
 */
export async function crearClienteCenso(
  db: SupabaseClient,
  input: NuevoClienteCenso,
): Promise<Cliente> {
  const { data, error } = await db
    .from("clientes")
    .insert({
      nombre: input.nombre,
      documento: input.documento,
      telefono: input.telefono,
      direccion: input.direccion,
      notas: input.notas,
      gps_lat: input.gps_lat,
      gps_lng: input.gps_lng,
      origen: "censo",
      creado_por: input.creado_por,
    })
    .select()
    .single();

  if (error) throw error;
  return mapCliente(data);
}

/** Busca un cliente por documento (para evitar duplicados al censar). */
export async function getClientePorDocumento(
  db: SupabaseClient,
  documento: string,
): Promise<Cliente | null> {
  const { data, error } = await db
    .from("clientes")
    .select("*")
    .eq("documento", documento)
    .maybeSingle();

  if (error) throw error;
  return data ? mapCliente(data) : null;
}

/**
 * Clientes ACTIVOS visibles para el usuario. Con el cliente autenticado, el
 * RLS ya limita al cobrador a los suyos (asignados). Ordenados por nombre.
 */
export async function getClientesAsignados(
  db: SupabaseClient,
): Promise<Cliente[]> {
  const { data, error } = await db
    .from("clientes")
    .select("*")
    .eq("activo", true)
    .order("nombre", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapCliente);
}

/**
 * Lista clientes ACTIVOS para el panel admin, con búsqueda opcional por nombre
 * o documento. Ordenados por nombre. Corre como gestor (RLS ve todos).
 */
export async function buscarClientesAdmin(
  db: SupabaseClient,
  q: string | null,
  limite = 60,
): Promise<Cliente[]> {
  let query = db.from("clientes").select("*").eq("activo", true);
  const termino = (q ?? "").trim();
  if (termino.length > 0) {
    // Escapamos los comodines de LIKE para que la búsqueda sea literal.
    const t = termino.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.or(`nombre.ilike.%${t}%,documento.ilike.%${t}%`);
  }
  const { data, error } = await query.order("nombre", { ascending: true }).limit(limite);
  if (error) throw error;
  return (data ?? []).map(mapCliente);
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
