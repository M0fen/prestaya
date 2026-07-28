// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — TIENDA de productos a crédito (migración 0076).
//  El cliente ve un catálogo (galería por categorías) + banner del destacado y
//  toca "Me interesa" → LEAD para el admin (NO genera crédito). El admin gestiona
//  productos, categorías, medios (fotos/carrusel + video) y puede fijar precio/
//  interés/cuotas POR CLIENTE (override).
//  Money: precio/interés son numeric; el precio se maneja como ENTERO UYU en TS.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Calificacion } from "@/types/db";
import type { DefinicionSegmento } from "@/lib/segmentos";
import { clienteEnSegmento } from "@/lib/segmentos";
import { tablaFaltante } from "./errores";

export type EstadoSolicitud = "nueva" | "contactado" | "cerrada" | "descartada";
export type FrecuenciaProducto = "diario" | "semanal" | "quincenal" | "mensual";
/** Qué agrupa a un segmento de clientes para la cuota especial (0078). */
export type TipoSegmento = "calificacion" | "zona";

export interface CategoriaProducto {
  id: string;
  nombre: string;
  orden: number;
  activo: boolean;
}

export interface Producto {
  id: string;
  nombre: string;
  marca: string | null;
  descripcion: string | null;
  categoriaId: string | null;
  categoriaNombre: string | null;
  precio: number;
  /** Precio "antes" (tachado) para framing de oferta. 0 = sin oferta. */
  precioAnterior: number;
  interesPct: number;
  cuotas: number;
  frecuencia: FrecuenciaProducto;
  /** URLs (la 1ª = portada; el resto arma el carrusel). */
  fotos: string[];
  videoUrl: string | null;
  activo: boolean;
  destacado: boolean;
  orden: number;
  /** Visibilidad por audiencia (0089): null = visible para todos. Si está, solo lo
   *  ven los clientes que matchean (clienteEnSegmento). */
  segmentoDef: DefinicionSegmento | null;
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

/** Precio especial de un producto para todo un SEGMENTO (calificación o zona). */
export interface PrecioSegmento {
  id: string;
  productoId: string;
  tipo: TipoSegmento;
  /** Calificación literal (excelente/…) o zona_id (uuid), según `tipo`. */
  valor: string;
  precio: number;
  interesPct: number;
  cuotas: number;
  nota: string | null;
}

/** Términos de precio (lo que puede variar por override). */
type Terminos = { precio: number; interesPct: number; cuotas: number };
/** De dónde salió el precio resuelto (para saber si es "personalizado"). */
export type OrigenPrecio = "base" | "calificacion" | "zona" | "individual";

/**
 * Elige el precio de un producto para un cliente. Prioridad (MÁS ESPECÍFICO gana):
 *   individual > zona > calificación > base.
 * Puro y testeable: la resolución de plata no debe depender de la BD.
 */
export function resolverPrecioCliente(
  base: Terminos,
  overrides: { individual?: Terminos | null; zona?: Terminos | null; calificacion?: Terminos | null },
): Terminos & { origen: OrigenPrecio } {
  if (overrides.individual) return { ...overrides.individual, origen: "individual" };
  if (overrides.zona) return { ...overrides.zona, origen: "zona" };
  if (overrides.calificacion) return { ...overrides.calificacion, origen: "calificacion" };
  return { ...base, origen: "base" };
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
    marca: (r.marca as string | null) ?? null,
    descripcion: (r.descripcion as string | null) ?? null,
    categoriaId: (r.categoria_id as string | null) ?? null,
    categoriaNombre: cat?.nombre ?? null,
    precio: N(r.precio),
    precioAnterior: N(r.precio_anterior),
    interesPct: NUM(r.interes_pct),
    cuotas: N(r.cuotas),
    frecuencia: ((r.frecuencia as string) || "diario") as FrecuenciaProducto,
    fotos: arr(r.fotos),
    videoUrl: (r.video_url as string | null) ?? null,
    activo: Boolean(r.activo),
    destacado: Boolean(r.destacado),
    orden: N(r.orden),
    segmentoDef: (r.segmento_def as DefinicionSegmento | null) ?? null,
  };
}

// `*` (resiliente: si falta una columna nueva de 0077 no rompe) + el nombre de la categoría.
const COLS = "*, categorias_producto(nombre)";

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

/** ¿Hay al menos un producto activo? (barato: count head). Para decidir si mostrar
 *  el botón "Ir a la tienda" en el cartón sin traer todo el catálogo. */
export async function hayProductosActivos(db: SupabaseClient): Promise<boolean> {
  try {
    const { count, error } = await db.from("productos").select("*", { count: "exact", head: true }).eq("activo", true);
    if (error) throw error;
    return (count ?? 0) > 0;
  } catch (e) {
    if (tablaFaltante(e)) return false;
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

/** Cliente para la resolución de precios (id + su calificación). */
export interface ClientePrecio {
  id: string;
  calificacion: Calificacion;
}

/** Zona del cliente = la del cobrador de su crédito ACTIVO más nuevo (los
 *  clientes no tienen zona propia; la heredan de su cobrador). null si no tiene
 *  crédito/cobrador/zona. Resiliente: nunca rompe la vista del cliente. */
export async function getZonaIdDeCliente(db: SupabaseClient, clienteId: string): Promise<string | null> {
  try {
    const { data: pres } = await db.from("prestamos").select("cobrador_id")
      .eq("cliente_id", clienteId).eq("estado", "activo")
      .order("fecha_inicio", { ascending: false }).limit(1);
    const cobradorId = (pres ?? [])[0]?.cobrador_id as string | null | undefined;
    if (!cobradorId) return null;
    const { data: u } = await db.from("usuarios").select("zona_id").eq("id", cobradorId).maybeSingle();
    return (u?.zona_id as string | null) ?? null;
  } catch {
    return null;
  }
}

/** Overrides de SEGMENTO aplicables a un cliente (por su calificación y zona),
 *  indexados por producto. La zona del cliente (2 queries) se resuelve SOLO si el
 *  producto tiene alguna regla por zona → no la pagamos cuando no hace falta.
 *  Resiliente: si falta 0078, mapa vacío (cae a individual/base). */
async function overridesSegmento(
  db: SupabaseClient,
  calificacion: Calificacion,
  clienteId: string,
): Promise<Map<string, { zona?: Terminos; calificacion?: Terminos }>> {
  const m = new Map<string, { zona?: Terminos; calificacion?: Terminos }>();
  try {
    // Reglas por ZONA (de cualquier zona) + reglas por la CALIFICACIÓN de este
    // cliente, en un solo query. (calificacion es un enum fijo → interpolación segura).
    const { data, error } = await db.from("producto_precio_segmento")
      .select("producto_id, tipo, valor, precio, interes_pct, cuotas")
      .or(`tipo.eq.zona,and(tipo.eq.calificacion,valor.eq.${calificacion})`);
    if (error) throw error;
    const filas = data ?? [];
    // La zona del cliente solo se necesita si hay alguna regla por zona.
    const zonaId = filas.some((r) => r.tipo === "zona") ? await getZonaIdDeCliente(db, clienteId) : null;
    for (const r of filas) {
      const pid = r.producto_id as string;
      const t: Terminos = { precio: N(r.precio), interesPct: NUM(r.interes_pct), cuotas: N(r.cuotas) };
      const entry = m.get(pid) ?? {};
      if (r.tipo === "zona" && zonaId && r.valor === zonaId) entry.zona = t;
      else if (r.tipo === "calificacion" && r.valor === calificacion) entry.calificacion = t;
      m.set(pid, entry);
    }
  } catch (e) {
    if (!tablaFaltante(e)) throw e; // otro error real sí se propaga
  }
  return m;
}

// ── Catálogo para el CLIENTE (con precio resuelto por override) ──────────────
/**
 * Productos ACTIVOS para la vista del cliente, con el precio/interés/cuotas
 * RESUELTOS por prioridad: individual > zona > calificación > base.
 * Corre con service_role (la vista del cliente valida el token antes).
 */
export async function getProductosParaCliente(
  db: SupabaseClient,
  cliente: ClientePrecio,
): Promise<ProductoParaCliente[]> {
  try {
    const { data, error } = await db.from("productos").select(COLS).eq("activo", true)
      .order("orden", { ascending: true }).order("nombre", { ascending: true });
    if (error) throw error;
    let productos = (data ?? []).map(mapProducto);
    if (productos.length === 0) return [];

    // VISIBILIDAD por audiencia (0089): un producto con segmento_def solo lo ven los
    // clientes que matchean. Solo se paga la consulta de zona si algún producto está
    // segmentado (si ninguno lo está → conducta previa, todos los productos visibles).
    if (productos.some((p) => p.segmentoDef)) {
      const zonaId = await getZonaIdDeCliente(db, cliente.id);
      const clienteSeg = {
        id: cliente.id,
        calificacion: cliente.calificacion,
        zonaId,
        cobradorId: null,
        alDia: true, // la tienda no calcula el cartón; la visibilidad va por calificación/zona
      };
      productos = productos.filter((p) => !p.segmentoDef || clienteEnSegmento(clienteSeg, p.segmentoDef));
      if (productos.length === 0) return [];
    }

    // Override INDIVIDUAL de ESTE cliente (pocos): un solo query.
    const indiv = new Map<string, Terminos>();
    const { data: ov } = await db.from("producto_precio_cliente")
      .select("producto_id, precio, interes_pct, cuotas").eq("cliente_id", cliente.id);
    for (const o of ov ?? []) {
      indiv.set(o.producto_id as string, { precio: N(o.precio), interesPct: NUM(o.interes_pct), cuotas: N(o.cuotas) });
    }

    // Overrides por SEGMENTO (calificación + zona derivada del cobrador, lazy).
    const seg = await overridesSegmento(db, cliente.calificacion, cliente.id);

    return productos.map((p) => {
      const s = seg.get(p.id);
      const r = resolverPrecioCliente(
        { precio: p.precio, interesPct: p.interesPct, cuotas: p.cuotas },
        { individual: indiv.get(p.id), zona: s?.zona, calificacion: s?.calificacion },
      );
      return { ...p, precio: r.precio, interesPct: r.interesPct, cuotas: r.cuotas, precioPersonalizado: r.origen !== "base" };
    });
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/**
 * El producto DESTACADO para el banner del cartón, con el precio RESUELTO para
 * este cliente (override si hay, si no el base). El más "arriba" por orden. null
 * si no hay ninguno destacado activo. Barato: 1 fila + 1 override. Resiliente.
 */
export async function getProductoDestacadoParaCliente(
  db: SupabaseClient,
  cliente: ClientePrecio,
): Promise<ProductoParaCliente | null> {
  try {
    // Se traen los destacados (hasta 5) y se elige el primero VISIBLE para el cliente
    // (un destacado segmentado no debe mostrarse a quien no pertenece a su audiencia).
    const { data, error } = await db.from("productos").select(COLS)
      .eq("activo", true).eq("destacado", true)
      .order("orden", { ascending: true }).order("nombre", { ascending: true })
      .limit(5);
    if (error) throw error;
    let destacados = ((data ?? []) as Record<string, unknown>[]).map(mapProducto);
    if (destacados.some((p) => p.segmentoDef)) {
      const zonaId = await getZonaIdDeCliente(db, cliente.id);
      const clienteSeg = { id: cliente.id, calificacion: cliente.calificacion, zonaId, cobradorId: null, alDia: true };
      destacados = destacados.filter((p) => !p.segmentoDef || clienteEnSegmento(clienteSeg, p.segmentoDef));
    }
    const p = destacados[0];
    if (!p) return null;
    // Override INDIVIDUAL de ESTE cliente para ese producto (unique → maybeSingle).
    const { data: ov } = await db.from("producto_precio_cliente")
      .select("precio, interes_pct, cuotas").eq("cliente_id", cliente.id).eq("producto_id", p.id).maybeSingle();
    const individual = ov ? { precio: N(ov.precio), interesPct: NUM(ov.interes_pct), cuotas: N(ov.cuotas) } : null;
    // Overrides por SEGMENTO (misma prioridad que el catálogo).
    const s = (await overridesSegmento(db, cliente.calificacion, cliente.id)).get(p.id);
    const r = resolverPrecioCliente(
      { precio: p.precio, interesPct: p.interesPct, cuotas: p.cuotas },
      { individual, zona: s?.zona, calificacion: s?.calificacion },
    );
    return { ...p, precio: r.precio, interesPct: r.interesPct, cuotas: r.cuotas, precioPersonalizado: r.origen !== "base" };
  } catch (e) {
    if (tablaFaltante(e)) return null;
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

// ── Precios por SEGMENTO (admin) ────────────────────────────────────────────
function mapSegmento(r: Record<string, unknown>): PrecioSegmento {
  return {
    id: r.id as string, productoId: r.producto_id as string,
    tipo: r.tipo as TipoSegmento, valor: r.valor as string,
    precio: N(r.precio), interesPct: NUM(r.interes_pct), cuotas: N(r.cuotas),
    nota: (r.nota as string | null) ?? null,
  };
}

/** Reglas de precio por segmento de un producto (para el editor admin). */
export async function getSegmentosDeProducto(db: SupabaseClient, productoId: string): Promise<PrecioSegmento[]> {
  try {
    const { data, error } = await db.from("producto_precio_segmento")
      .select("id, producto_id, tipo, valor, precio, interes_pct, cuotas, nota")
      .eq("producto_id", productoId).order("creado_en", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapSegmento);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Upsert de una regla de segmento (unique producto+tipo+valor → la pisa). */
export async function setPrecioSegmentoDb(
  db: SupabaseClient,
  p: { productoId: string; tipo: TipoSegmento; valor: string; precio: number; interesPct: number; cuotas: number; nota: string | null; creadoPor: string },
): Promise<void> {
  const { error } = await db.from("producto_precio_segmento").upsert({
    producto_id: p.productoId, tipo: p.tipo, valor: p.valor, precio: N(p.precio),
    interes_pct: NUM(p.interesPct), cuotas: N(p.cuotas), nota: p.nota, creado_por: p.creadoPor,
  }, { onConflict: "producto_id,tipo,valor" });
  if (error) throw error;
}
export async function borrarPrecioSegmentoDb(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("producto_precio_segmento").delete().eq("id", id);
  if (error) throw error;
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
  marca: string | null;
  descripcion: string | null;
  categoriaId: string | null;
  precio: number;
  precioAnterior: number;
  interesPct: number;
  cuotas: number;
  frecuencia: FrecuenciaProducto;
  fotos: string[];
  videoUrl: string | null;
  activo: boolean;
  destacado: boolean;
  orden: number;
  /** Visibilidad por audiencia (0089). null = visible para todos. */
  segmentoDef: DefinicionSegmento | null;
}

function rowProducto(p: ProductoInput) {
  return {
    nombre: p.nombre, marca: p.marca, descripcion: p.descripcion, categoria_id: p.categoriaId,
    precio: N(p.precio), precio_anterior: p.precioAnterior > 0 ? N(p.precioAnterior) : null,
    interes_pct: NUM(p.interesPct), cuotas: N(p.cuotas), frecuencia: p.frecuencia,
    fotos: p.fotos, video_url: p.videoUrl, activo: p.activo, destacado: p.destacado, orden: N(p.orden),
    segmento_def: p.segmentoDef,
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
