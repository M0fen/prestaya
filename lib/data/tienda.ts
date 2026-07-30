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
import { reportarError } from "@/lib/observabilidad";

export type EstadoSolicitud = "nueva" | "contactado" | "cerrada" | "descartada" | "convertida";
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
  /** Sin stock (0099): sigue visible en la vitrina con cartel "Agotado" pero no se
   *  puede pedir (no genera lead) hasta que el admin lo reponga. */
  agotado: boolean;
  /** Unidades disponibles (0100). null = no se controla (siempre disponible). 0 =
   *  sin stock. >0 = quedan N (la vitrina muestra escasez si son pocas). */
  stock: number | null;
  orden: number;
  /** Visibilidad por audiencia (0089): null = visible para todos. Si está, solo lo
   *  ven los clientes que matchean (clienteEnSegmento). */
  segmentoDef: DefinicionSegmento | null;
  /** Quién DESPACHA (0112): null = propio (lo lleva el cobrador); 'curbe' = lo
   *  despacha Curbe → al vender genera un pedido en la cola de despacho. */
  proveedor: string | null;
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
  /** Teléfono del cliente (para contactarlo / WhatsApp desde el lead). */
  clienteTelefono?: string | null;
  productoNombre: string;
  estado: EstadoSolicitud;
  nota: string | null;
  creadoEn: string;
  /** Quién resolvió el lead (contactó/cerró) y cuándo. */
  resueltoPorNombre?: string | null;
  resueltoEn?: string | null;
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
    agotado: Boolean(r.agotado), // defensivo: sin 0099 viene undefined → false
    stock: r.stock == null ? null : Number(r.stock), // defensivo: sin 0100 → null
    orden: N(r.orden),
    segmentoDef: (r.segmento_def as DefinicionSegmento | null) ?? null,
    proveedor: (r.proveedor as string | null) ?? null, // defensivo: sin 0112 → null (propio)
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
/**
 * Productos para la TIENDA PÚBLICA (/tienda, visible para cualquiera): activos, a
 * precio BASE (sin cliente → sin overrides individuales/segmento), y SOLO los que
 * NO tienen restricción de audiencia (segmentoDef null) — un producto targeteado a
 * un segmento no se muestra en la vidriera pública.
 */
export async function getProductosPublicos(db: SupabaseClient): Promise<ProductoParaCliente[]> {
  try {
    const { data, error } = await db
      .from("productos")
      .select(COLS)
      .eq("activo", true)
      .order("orden", { ascending: true })
      .order("nombre", { ascending: true });
    if (error) throw error;
    // Precio BASE (sin override → precioPersonalizado false). Solo productos públicos.
    return (data ?? [])
      .map(mapProducto)
      .filter((p) => !p.segmentoDef)
      .map((p) => ({ ...p, precioPersonalizado: false }));
  } catch {
    return [];
  }
}

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
      .select("id, producto_id, cliente_id, producto_nombre, estado, nota, creado_en, resuelto_por, resuelto_en, clientes(nombre, telefono)");
    if (estado) q = q.eq("estado", estado);
    const { data, error } = await q.order("creado_en", { ascending: false }).limit(500);
    if (error) throw error;
    const filas = (data ?? []).map((r) => ({
      id: r.id as string, productoId: (r.producto_id as string | null) ?? null, clienteId: r.cliente_id as string,
      clienteNombre: (r.clientes as { nombre?: string } | null)?.nombre ?? "Cliente",
      clienteTelefono: (r.clientes as { telefono?: string | null } | null)?.telefono ?? null,
      productoNombre: r.producto_nombre as string, estado: r.estado as EstadoSolicitud,
      nota: (r.nota as string | null) ?? null, creadoEn: r.creado_en as string,
      resueltoPor: (r.resuelto_por as string | null) ?? null,
      resueltoEn: (r.resuelto_en as string | null) ?? null,
    }));
    // Nombre de quién resolvió (para la traza del lead).
    const ids = [...new Set(filas.map((f) => f.resueltoPor).filter(Boolean) as string[])];
    const nombres = new Map<string, string>();
    if (ids.length > 0) {
      const { data: us } = await db.from("usuarios").select("id, nombre").in("id", ids);
      for (const u of us ?? []) nombres.set(u.id as string, u.nombre as string);
    }
    return filas.map((f) => ({
      id: f.id, productoId: f.productoId, clienteId: f.clienteId, clienteNombre: f.clienteNombre,
      clienteTelefono: f.clienteTelefono, productoNombre: f.productoNombre, estado: f.estado,
      nota: f.nota, creadoEn: f.creadoEn,
      resueltoPorNombre: f.resueltoPor ? nombres.get(f.resueltoPor) ?? null : null,
      resueltoEn: f.resueltoEn,
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** ¿El cliente ya tiene un lead ABIERTO (nueva/contactado) de este producto? Para
 *  NO duplicar leads cuando toca "Me interesa" varias veces (idempotencia). */
export async function existeSolicitudAbierta(db: SupabaseClient, clienteId: string, productoId: string): Promise<boolean> {
  try {
    const { count, error } = await db.from("solicitudes_producto")
      .select("*", { count: "exact", head: true })
      .eq("cliente_id", clienteId).eq("producto_id", productoId)
      .in("estado", ["nueva", "contactado"]);
    if (error) throw error;
    return (count ?? 0) > 0;
  } catch (e) {
    if (tablaFaltante(e)) return false;
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
  agotado: boolean;
  stock: number | null;
  orden: number;
  /** Visibilidad por audiencia (0089). null = visible para todos. */
  segmentoDef: DefinicionSegmento | null;
  /** Quién despacha (0112): null = propio; 'curbe' = lo despacha Curbe. */
  proveedor: string | null;
}

function rowProducto(p: ProductoInput) {
  return {
    nombre: p.nombre, marca: p.marca, descripcion: p.descripcion, categoria_id: p.categoriaId,
    precio: N(p.precio), precio_anterior: p.precioAnterior > 0 ? N(p.precioAnterior) : null,
    interes_pct: NUM(p.interesPct), cuotas: N(p.cuotas), frecuencia: p.frecuencia,
    fotos: p.fotos, video_url: p.videoUrl, activo: p.activo, destacado: p.destacado, agotado: p.agotado,
    stock: p.stock, orden: N(p.orden),
    segmento_def: p.segmentoDef,
    proveedor: p.proveedor, // 0112: null = propio; 'curbe' = despacha Curbe
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

// ── Venta de tienda: convertir un LEAD en un CRÉDITO real (P3b, migración 0101) ──

/** Un lead leído por id, con lo justo para convertirlo en venta. */
export interface LeadDetalle {
  id: string;
  productoId: string | null;
  clienteId: string;
  productoNombre: string;
  estado: EstadoSolicitud;
  /** Crédito ya generado si el lead se convirtió (0101). null si no. */
  prestamoId: string | null;
}

export async function getSolicitudProductoPorId(db: SupabaseClient, id: string): Promise<LeadDetalle | null> {
  try {
    // select("*") es resiliente: si `prestamo_id` (0101) aún no existe, no rompe.
    const { data, error } = await db.from("solicitudes_producto").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id as string,
      productoId: (data.producto_id as string | null) ?? null,
      clienteId: data.cliente_id as string,
      productoNombre: (data.producto_nombre as string | null) ?? "Producto",
      estado: data.estado as EstadoSolicitud,
      prestamoId: (data.prestamo_id as string | null | undefined) ?? null,
    };
  } catch (e) {
    if (tablaFaltante(e)) return null;
    throw e;
  }
}

/**
 * Términos de precio de un producto RESUELTOS para un cliente (mismo criterio que
 * la vitrina: individual > zona > calificación > base). En la conversión de un lead
 * el precio se recalcula SIEMPRE en el servidor con esta función — nunca se confía
 * en el número del navegador.
 */
export async function getTerminosVentaParaCliente(
  db: SupabaseClient, producto: Producto, cliente: ClientePrecio,
): Promise<Terminos & { origen: OrigenPrecio }> {
  const { data: ov } = await db.from("producto_precio_cliente")
    .select("precio, interes_pct, cuotas").eq("cliente_id", cliente.id).eq("producto_id", producto.id).maybeSingle();
  const individual = ov ? { precio: N(ov.precio), interesPct: NUM(ov.interes_pct), cuotas: N(ov.cuotas) } : null;
  const s = (await overridesSegmento(db, cliente.calificacion, cliente.id)).get(producto.id);
  return resolverPrecioCliente(
    { precio: producto.precio, interesPct: producto.interesPct, cuotas: producto.cuotas },
    { individual, zona: s?.zona, calificacion: s?.calificacion },
  );
}

export type ResultadoVenta =
  | { ok: true; prestamoId: string }
  | { ok: false; error: string; faltaMigracion?: boolean };

/**
 * Crea el crédito de venta vía el RPC ATÓMICO `crear_credito_venta_seguro` (0101):
 * inserta el crédito + marca el lead 'convertida' en UNA transacción, serializado
 * por advisory lock del lead. Idempotente: si el lead ya se convirtió (P0410 con
 * prestamo_id) o el op_id ya existe (23505 = commit-perdido), devuelve el crédito
 * existente en vez de crear un segundo. monto/cuota llegan ya calculados y validados
 * por el server (nunca float). Degrada con mensaje claro si 0101 no corrió.
 */
export async function crearVentaSegura(
  db: SupabaseClient,
  input: {
    solicitudId: string; clienteId: string; cobradorId: string | null;
    monto: number; cuota: number; totalDias: number; frecuencia: FrecuenciaProducto;
    fechaInicio: string; productoId: string | null; productoNombre: string;
    opId: string; creadoPor: string;
  },
): Promise<ResultadoVenta> {
  const rpc = await db.rpc("crear_credito_venta_seguro", {
    p_solicitud_id: input.solicitudId,
    p_cliente_id: input.clienteId,
    p_cobrador_id: input.cobradorId,
    p_monto: input.monto,
    p_cuota: input.cuota,
    p_total_dias: input.totalDias,
    p_frecuencia: input.frecuencia,
    p_fecha_inicio: input.fechaInicio,
    p_producto_id: input.productoId,
    p_producto_nombre: input.productoNombre,
    p_op_id: input.opId,
    p_creado_por: input.creadoPor,
  });
  if (!rpc.error && rpc.data) {
    return { ok: true, prestamoId: (rpc.data as { id: string }).id };
  }
  const code = (rpc.error as { code?: string } | null)?.code;
  // Migración 0101 sin correr → degradación elegante (mensaje claro, no rompe).
  if (code === "42883" || code === "PGRST202") {
    return { ok: false, error: "Falta correr la migración 0101 (venta de tienda).", faltaMigracion: true };
  }
  // El lead ya no está abierto (P0410): probablemente ya se convirtió → buscá su crédito.
  if (code === "P0410") {
    const { data } = await db.from("solicitudes_producto").select("prestamo_id").eq("id", input.solicitudId).maybeSingle();
    const pid = (data?.prestamo_id as string | null) ?? null;
    if (pid) return { ok: true, prestamoId: pid };
    return { ok: false, error: "Ese pedido ya no está abierto (quizá ya se convirtió)." };
  }
  // Gate de stock del RPC (0106): otra venta concurrente agotó el stock.
  if (code === "P0409") return { ok: false, error: "El producto se quedó sin stock (otra venta lo agotó)." };
  // Defensa CAP del RPC (0106).
  if (code === "P0403") return { ok: false, error: "La venta supera el tope de crédito ($100.000)." };
  // op_id duplicado (commit-perdido): la venta YA se creó → devolver ese crédito.
  if (code === "23505") {
    const { data } = await db.from("prestamos").select("id").eq("op_id", input.opId).limit(1);
    if (data && data.length > 0) return { ok: true, prestamoId: data[0].id as string };
  }
  reportarError("crearVentaSegura", rpc.error, { solicitudId: input.solicitudId, clienteId: input.clienteId });
  return { ok: false, error: "No se pudo crear la venta. Probá de nuevo." };
}
