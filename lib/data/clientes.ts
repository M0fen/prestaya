// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CLIENTES.
//  Funciones tipadas para leer clientes. No mezclar con UI.
//  Reciben el cliente Supabase por parámetro (inyección): así la misma
//  función sirve con el cliente admin (vista por token) o anónimo (RLS).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cliente } from "@/types/db";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { alcanceDelActor, enLotes } from "./alcance";

/** Sanea un término de búsqueda libre antes de un `.or(ilike…)`: neutraliza la
 *  sintaxis de filtro de PostgREST (coma/paréntesis/comillas/asterisco → espacio)
 *  y escapa los comodines de LIKE (%, _) para que sea literal. Evita que un input
 *  inyecte ramas OR en la consulta. Defensa en profundidad (además del alcance+RLS). */
export function sanitizarTerminoBusqueda(t: string): string {
  return t
    .replace(/[,()"*]/g, " ")
    .replace(/[%_]/g, (m) => `\\${m}`)
    .replace(/\s+/g, " ") // colapsa espacios (p. ej. "García, Juan" → "García Juan")
    .trim();
}

/** Convierte una fila cruda de Supabase en un Cliente tipado. */
export function mapCliente(r: Record<string, unknown>): Cliente {
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
    // Paridad Disapp (0041); defensivo si aún no corrió la migración.
    reportado: (r.reportado as boolean | undefined) ?? false,
    genero: (r.genero as Cliente["genero"] | undefined) ?? null,
    ciudad: (r.ciudad as string | null | undefined) ?? null,
    direccion_secundaria: (r.direccion_secundaria as string | null | undefined) ?? null,
    foto_path: (r.foto_path as string | null | undefined) ?? null,
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
  // Solo la usa el panel (renovaciones, gestor). Va por service_role: un
  // `select * from clientes` bajo el RLS de zona escanea 13k filas evaluando la
  // política por-fila → statement timeout. El supervisor recibe `.in(id, ...)`
  // para ver SOLO su zona (acotado y rápido); el admin ve todos.
  void db;
  const admin = createSupabaseAdmin();
  const alcance = await alcanceDelActor();
  if (alcance.global) {
    const { data, error } = await admin
      .from("clientes")
      .select("*")
      .eq("activo", true)
      .order("nombre", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapCliente);
  }
  if (alcance.clienteIds.length === 0) return [];
  // Supervisor: `.in(id, ...)` EN LOTES (URL de PostgREST) y se une en JS.
  const filas: Record<string, unknown>[] = [];
  for (const lote of enLotes(alcance.clienteIds)) {
    const { data, error } = await admin.from("clientes").select("*").eq("activo", true).in("id", lote);
    if (error) throw error;
    filas.push(...(data ?? []));
  }
  filas.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
  return filas.map(mapCliente);
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
    const t = sanitizarTerminoBusqueda(termino);
    if (t) query = query.or(`nombre.ilike.%${t}%,documento.ilike.%${t}%`);
  }
  const { data, error } = await query.order("nombre", { ascending: true }).limit(limite);
  if (error) throw error;
  return (data ?? []).map(mapCliente);
}

/** Fila enriquecida para la LISTA del panel admin (columnas estilo Disapp). */
export interface ClienteFilaAdmin {
  id: string;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  direccion: string | null;
  calificacion: Cliente["calificacion"];
  activo: boolean;
  refDisapp: string | null;
  reportado: boolean;
  vendedor: string | null;
  creditosActivos: number;
}

/**
 * Lista de clientes para el panel admin, enriquecida SIN N+1: se paginan/limitan
 * los clientes y luego se resuelven, en un solo `in(...)` por lote, el cobrador
 * asignado y la cantidad de créditos activos. `archivados` muestra los inactivos.
 */
export async function getClientesListaAdmin(
  db: SupabaseClient,
  opts: { q?: string | null; archivados?: boolean; limite?: number } = {},
): Promise<ClienteFilaAdmin[]> {
  const limite = opts.limite ?? 60;
  // service_role para la lista: bajo el RLS de zona, un select sobre 13k clientes
  // evalúa la política por-fila → statement timeout (supervisor). Para acotar a
  // SU zona, un supervisor recibe además `.in(id, clienteIds)` (acotado y rápido);
  // el admin ve todos.
  const admin = createSupabaseAdmin();
  const alcance = await alcanceDelActor();
  const termino = (opts.q ?? "").trim();
  // Fábrica de la consulta base (columnas + búsqueda), reusable por lote/zona.
  const construir = () => {
    let q = admin
      .from("clientes")
      .select("id, nombre, documento, telefono, direccion, calificacion, activo, disapp_id, reportado")
      .eq("activo", !opts.archivados);
    if (termino.length > 0) {
      const t = sanitizarTerminoBusqueda(termino);
      if (t) q = q.or(`nombre.ilike.%${t}%,documento.ilike.%${t}%`);
    }
    return q;
  };
  let filas: Record<string, unknown>[];
  if (alcance.global) {
    const { data, error } = await construir().order("nombre", { ascending: true }).limit(limite);
    if (error) throw error;
    filas = (data ?? []) as Record<string, unknown>[];
  } else {
    // Supervisor: solo su zona. `.in(id, ...)` EN LOTES; se une, ordena y corta.
    if (alcance.clienteIds.length === 0) return [];
    const acc: Record<string, unknown>[] = [];
    for (const lote of enLotes(alcance.clienteIds)) {
      const { data, error } = await construir().in("id", lote).order("nombre", { ascending: true }).limit(limite);
      if (error) throw error;
      acc.push(...((data ?? []) as Record<string, unknown>[]));
    }
    acc.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
    filas = acc.slice(0, limite);
  }
  const ids = filas.map((f) => f.id as string);

  const vendedorDe = new Map<string, string>();
  const creditosDe = new Map<string, number>();
  if (ids.length > 0) {
    // Cobrador asignado (activo) por cliente + nombres, en batch.
    const { data: asig } = await db
      .from("asignaciones")
      .select("cliente_id, cobrador_id")
      .eq("activo", true)
      .in("cliente_id", ids);
    const clienteCob = new Map<string, string>();
    const cobIds = new Set<string>();
    for (const a of asig ?? []) {
      clienteCob.set(a.cliente_id as string, a.cobrador_id as string);
      cobIds.add(a.cobrador_id as string);
    }
    if (cobIds.size > 0) {
      const { data: us } = await db.from("usuarios").select("id, nombre").in("id", [...cobIds]);
      const nombre = new Map<string, string>();
      for (const u of us ?? []) nombre.set(u.id as string, u.nombre as string);
      for (const [cli, cob] of clienteCob) vendedorDe.set(cli, nombre.get(cob) ?? "—");
    }
    // Créditos ACTIVOS por cliente (conteo), en batch.
    const { data: pres } = await db
      .from("prestamos")
      .select("cliente_id")
      .eq("estado", "activo")
      .in("cliente_id", ids);
    for (const p of pres ?? []) {
      const cid = p.cliente_id as string;
      creditosDe.set(cid, (creditosDe.get(cid) ?? 0) + 1);
    }
  }

  return filas.map((f) => ({
    id: f.id as string,
    nombre: f.nombre as string,
    documento: (f.documento as string | null) ?? null,
    telefono: (f.telefono as string | null) ?? null,
    direccion: (f.direccion as string | null) ?? null,
    calificacion: f.calificacion as Cliente["calificacion"],
    activo: f.activo as boolean,
    refDisapp: (f.disapp_id as string | null | undefined) ?? null,
    reportado: (f.reportado as boolean | undefined) ?? false,
    vendedor: vendedorDe.get(f.id as string) ?? null,
    creditosActivos: creditosDe.get(f.id as string) ?? 0,
  }));
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

/**
 * Rota el token de acceso de un cliente (Fase 6). El link anterior deja de
 * funcionar al instante: getClientePorToken con el token viejo devolverá null.
 */
export async function setTokenCliente(
  db: SupabaseClient,
  clienteId: string,
  token: string,
): Promise<void> {
  const { error } = await db.from("clientes").update({ token_acceso: token }).eq("id", clienteId);
  if (error) throw error;
}
