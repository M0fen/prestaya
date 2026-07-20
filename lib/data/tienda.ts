// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — TIENDA de productos a crédito (migración 0076).
//  El cliente ve un catálogo (galería por categorías) + banner del destacado y
//  toca "Me interesa" → LEAD para el admin (NO genera crédito). El admin gestiona
//  productos, categorías, medios (fotos/carrusel + video) y puede fijar precio/
//  interés/cuotas POR CLIENTE (override).
//  Money: precio/interés son numeric; el precio se maneja como ENTERO UYU en TS.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "./errores";

export type EstadoSolicitud = "nueva" | "contactado" | "cerrada" | "descartada";
export type FrecuenciaProducto = "diario" | "semanal" | "quincenal" | "mensual";

export interface CategoriaProducto {
  id: string;
  nombre: string;
  orden: number;
  activo: boolean;
}

export interface Producto {
  id: string;
  nombre: string;
  descripcion: string | null;
  categoriaId: string | null;
  categoriaNombre: string | null;
  precio: number;
  interesPct: number;
  cuotas: number;
  frecuencia: FrecuenciaProducto;
  /** URLs (la 1ª = portada; el resto arma el carrusel). */
  fotos: string[];
  videoUrl: string | null;
  activo: boolean;
  destacado: boolean;
  orden: number;
}

/** Producto con el PRECIO RESUELTO para un cliente (override o base). */
export interface ProductoParaCliente extends Producto {
  /** true si el precio/interés/cuotas vienen de un override de este cliente. */
  precioPersonalizado: boolean;
}

export interface PrecioCliente {
  id: string;
  productoId: string;
  clienteId: string;
  clienteNombre?: string;
  precio: number;
  interesPct: number;
  cuotas: number;
  nota: string | null;
}

export interface SolicitudProducto {
  id: string;
  productoId: string | null;
  clienteId: string;
  clienteNombre?: string;
  productoNombre: string;
  estado: EstadoSolicitud;
  nota: string | null;
  creadoEn: string;
}

const N = (v: unknown) => Math.round(Number(v) || 0);
const NUM = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String).filter(Boolean) : []);

function mapProducto(r: Record<string, unknown>): Producto {
  const cat = r.categorias_producto as { nombre?: string } | null;
  return {
    id: r.id as string,
    nombre: r.nombre as string,
    descripcion: (r.descripcion as string | null) ?? null,
    categoriaId: (r.categoria_id as string | null) ?? null,
    categoriaNombre: cat?.nombre ?? null,
    precio: N(r.precio),
    interesPct: NUM(r.interes_pct),
    cuotas: N(r.cuotas),
    frecuencia: ((r.frecuencia as string) || "diario") as FrecuenciaProducto,
    fotos: arr(r.fotos),
    videoUrl: (r.video_url as string | null) ?? null,
    activo: Boolean(r.activo),
    destacado: Boolean(r.destacado),
    orden: N(r.orden),
  };
}

const COLS = "id, nombre, descripcion, categoria_id, precio, interes_pct, cuotas, frecuencia, fotos, video_url, activo, destacado, orden, categorias_producto(nombre)";

// ── Categorías ─────────────────────────────────────────────────────────────
export async function getCategorias(db: SupabaseClient, soloActivas = true): Promise<CategoriaProducto[]> {
  try {
    let q = db.from("categorias_producto").select("id, nombre, orden, activo");
    if (soloActivas) q = q.eq("activo", true);
    const { data, error } = await q.order("orden", { ascending: true }).order("nombre", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((c) => ({
      id: c.id as string, nombre: c.nombre as string, orden: N(c.orden), activo: Boolean(c.activo),
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

// ── Productos (admin: todos) ────────────────────────────────────────────────
export async function getProductosAdmin(db: SupabaseClient): Promise<Producto[]> {
  try {
    const { data, error } = await db.from("productos").select(COLS)
      .order("orden", { ascending: true }).order("nombre", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapProducto);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export async function getProductoAdmin(db: SupabaseClient, id: string): Promise<Producto | null> {
  const { data, error } = await db.from("productos").select(COLS).eq("id", id).maybeSingle();
  if (error) { if (tablaFaltante(error)) return null; throw error; }
  return data ? mapProducto(data) : null;
}

// ── Catálogo para el CLIENTE (con precio resuelto por override) ──────────────
/**
 * Productos ACTIVOS para la vista del cliente, con el precio/interés/cuotas
 * RESUELTOS: si hay override para este cliente se usa ese, si no el base.
 * Corre con service_role (la vista del cliente valida el token antes).
 */
export async function getProductosParaCliente(
  db: SupabaseClient,
  clienteId: string,
): Promise<ProductoParaCliente[]> {
  try {
    const { data, error } = await db.from("productos").select(COLS).eq("activo", true)
      .order("orden", { ascending: true }).order("nombre", { ascending: true });
    if (error) throw error;
    const productos = (data ?? []).map(mapProducto);
    if (productos.length === 0) return [];

    // Overrides de ESTE cliente (pocos): un solo query.
    const overrides = new Map<string, { precio: number; interesPct: number; cuotas: number }>();
    const { data: ov } = await db.from("producto_precio_cliente")
      .select("producto_id, precio, interes_pct, cuotas").eq("cliente_id", clienteId);
    for (const o of ov ?? []) {
      overrides.set(o.producto_id as string, { precio: N(o.precio), interesPct: NUM(o.interes_pct), cuotas: N(o.cuotas) });
    }
    return productos.map((p) => {
      const o = overrides.get(p.id);
      return o
        ? { ...p, precio: o.precio, interesPct: o.interesPct, cuotas: o.cuotas, precioPersonalizado: true }
        : { ...p, precioPersonalizado: false };
    });
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

// ── Precios por cliente (admin) ─────────────────────────────────────────────
export async function getPreciosDeProducto(db: SupabaseClient, productoId: string): Promise<PrecioCliente[]> {
  const { data, error } = await db.from("producto_precio_cliente")
    .select("id, producto_id, cliente_id, precio, interes_pct, cuotas, nota, clientes(nombre)")
    .eq("producto_id", productoId).order("creado_en", { ascending: false });
  if (error) { if (tablaFaltante(error)) return []; throw error; }
  return (data ?? []).map((r) => ({
    id: r.id as string, productoId: r.producto_id as string, clienteId: r.cliente_id as string,
    clienteNombre: (r.clientes as { nombre?: string } | null)?.nombre ?? "Cliente",
    precio: N(r.precio), interesPct: NUM(r.interes_pct), cuotas: N(r.cuotas), nota: (r.nota as string | null) ?? null,
  }));
}

// ── Solicitudes / leads (admin) ─────────────────────────────────────────────
export async function getSolicitudes(db: SupabaseClient, estado?: EstadoSolicitud): Promise<SolicitudProducto[]> {
  try {
    let q = db.from("solicitudes_producto")
      .select("id, producto_id, cliente_id, producto_nombre, estado, nota, creado_en, clientes(nombre)");
    if (estado) q = q.eq("estado", estado);
    const { data, error } = await q.order("creado_en", { ascending: false }).limit(500);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id as string, productoId: (r.producto_id as string | null) ?? null, clienteId: r.cliente_id as string,
      clienteNombre: (r.clientes as { nombre?: string } | null)?.nombre ?? "Cliente",
      productoNombre: r.producto_nombre as string, estado: r.estado as EstadoSolicitud,
      nota: (r.nota as string | null) ?? null, creadoEn: r.creado_en as string,
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export async function contarSolicitudesNuevas(db: SupabaseClient): Promise<number> {
  try {
    const { count, error } = await db.from("solicitudes_producto")
      .select("*", { count: "exact", head: true }).eq("estado", "nueva");
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    if (tablaFaltante(e)) return 0;
    throw e;
  }
}

// ── Escrituras (llamadas desde las Server Actions) ──────────────────────────
export interface ProductoInput {
  nombre: string;
  descripcion: string | null;
  categoriaId: string | null;
  precio: number;
  interesPct: number;
  cuotas: number;
  frecuencia: FrecuenciaProducto;
  fotos: string[];
  videoUrl: string | null;
  activo: boolean;
  destacado: boolean;
  orden: number;
}

function rowProducto(p: ProductoInput) {
  return {
    nombre: p.nombre, descripcion: p.descripcion, categoria_id: p.categoriaId,
    precio: N(p.precio), interes_pct: NUM(p.interesPct), cuotas: N(p.cuotas), frecuencia: p.frecuencia,
    fotos: p.fotos, video_url: p.videoUrl, activo: p.activo, destacado: p.destacado, orden: N(p.orden),
  };
}

export async function crearProductoDb(db: SupabaseClient, p: ProductoInput, creadoPor: string): Promise<void> {
  const { error } = await db.from("productos").insert({ ...rowProducto(p), creado_por: creadoPor });
  if (error) throw error;
}
export async function actualizarProductoDb(db: SupabaseClient, id: string, p: ProductoInput): Promise<void> {
  const { error } = await db.from("productos").update({ ...rowProducto(p), actualizado_en: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}
export async function setProductoActivoDb(db: SupabaseClient, id: string, activo: boolean): Promise<void> {
  const { error } = await db.from("productos").update({ activo }).eq("id", id);
  if (error) throw error;
}
export async function borrarProductoDb(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("productos").delete().eq("id", id);
  if (error) throw error;
}

export async function crearCategoriaDb(db: SupabaseClient, nombre: string, orden: number): Promise<void> {
  const { error } = await db.from("categorias_producto").insert({ nombre, orden: N(orden) });
  if (error) throw error;
}
export async function actualizarCategoriaDb(db: SupabaseClient, id: string, nombre: string, orden: number, activo: boolean): Promise<void> {
  const { error } = await db.from("categorias_producto").update({ nombre, orden: N(orden), activo }).eq("id", id);
  if (error) throw error;
}
export async function borrarCategoriaDb(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("categorias_producto").delete().eq("id", id);
  if (error) throw error;
}

/** Upsert del precio POR cliente (unique producto+cliente). */
export async function setPrecioClienteDb(
  db: SupabaseClient,
  p: { productoId: string; clienteId: string; precio: number; interesPct: number; cuotas: number; nota: string | null; creadoPor: string },
): Promise<void> {
  const { error } = await db.from("producto_precio_cliente").upsert({
    producto_id: p.productoId, cliente_id: p.clienteId, precio: N(p.precio), interes_pct: NUM(p.interesPct),
    cuotas: N(p.cuotas), nota: p.nota, creado_por: p.creadoPor,
  }, { onConflict: "producto_id,cliente_id" });
  if (error) throw error;
}
export async function borrarPrecioClienteDb(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("producto_precio_cliente").delete().eq("id", id);
  if (error) throw error;
}

/** Lead del cliente ("Me interesa"). Snapshot del nombre del producto. */
export async function crearSolicitudDb(
  db: SupabaseClient,
  s: { productoId: string; clienteId: string; productoNombre: string },
): Promise<void> {
  const { error } = await db.from("solicitudes_producto").insert({
    producto_id: s.productoId, cliente_id: s.clienteId, producto_nombre: s.productoNombre, estado: "nueva",
  });
  if (error) throw error;
}
export async function contarSolicitudesRecientesCliente(db: SupabaseClient, clienteId: string, desde: Date): Promise<number> {
  const { count, error } = await db.from("solicitudes_producto")
    .select("*", { count: "exact", head: true }).eq("cliente_id", clienteId).gte("creado_en", desde.toISOString());
  if (error) throw error;
  return count ?? 0;
}
export async function resolverSolicitudDb(db: SupabaseClient, id: string, estado: EstadoSolicitud, resueltoPor: string, nota: string | null): Promise<void> {
  const { error } = await db.from("solicitudes_producto")
    .update({ estado, resuelto_por: resueltoPor, resuelto_en: new Date().toISOString(), ...(nota != null ? { nota } : {}) })
    .eq("id", id);
  if (error) throw error;
}
