"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — TIENDA (solo ADMIN escribe; la tienda es del dueño).
//  Productos, categorías, precio por cliente, leads y subida de medios (fotos +
//  video). Cada cambio queda en auditoría. La lectura del cliente va aparte, por
//  token (app/c/[token]/actions.ts → registrarInteres).
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { reportarError } from "@/lib/observabilidad";
import { MODELO_ASESOR } from "@/lib/asesor/prompt";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { hrefSeguro } from "@/lib/seguridad";
import { esUuid, opIdDeterminista } from "@/lib/idempotencia";
import { normalizarSegmento, esSegmentoTodos, type DefinicionSegmento } from "@/lib/segmentos";
import {
  crearProductoDb, actualizarProductoDb, actualizarPreciosProductoDb, setProductoActivoDb, borrarProductoDb,
  crearCategoriaDb, actualizarCategoriaDb, borrarCategoriaDb,
  setPrecioClienteDb, borrarPrecioClienteDb, resolverSolicitudDb, getPreciosDeProducto,
  setPrecioSegmentoDb, borrarPrecioSegmentoDb, getSegmentosDeProducto,
  getProductoAdmin, getSolicitudProductoPorId, getTerminosVentaParaCliente, crearVentaSegura,
  type ProductoInput, type FrecuenciaProducto, type EstadoSolicitud, type PrecioCliente,
  type PrecioSegmento, type TipoSegmento,
} from "@/lib/data/tienda";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { getClientePorId } from "@/lib/data/clientes";
import { getCobradorDeCliente, reasignarCliente, desactivarAsignacion } from "@/lib/data/asignaciones";
import { crearPedidoCurbeDb } from "@/lib/data/pedidosCurbe";
import { calcularPlanVenta } from "@/lib/venta";
import { RENOVACION_CAP_TOTAL } from "@/lib/renovacion";
import { hoyUY } from "@/lib/fecha";
import { proximoDiaCobro } from "@/lib/cartones";
import { toIso } from "@/lib/format";
import type { Calificacion } from "@/types/db";

type Resultado = { ok: true } | { ok: false; error: string };
const FRECUENCIAS: FrecuenciaProducto[] = ["diario", "semanal", "quincenal", "mensual"];
const ESTADOS: EstadoSolicitud[] = ["nueva", "contactado", "cerrada", "descartada"];
const CALIFICACIONES: Calificacion[] = ["nuevo", "excelente", "bueno", "regular", "riesgo"];
const BUCKET = "tienda";

async function soloAdmin() {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return null;
  return u;
}

/** Solo http(s) (se usan en <img>/<video src>). Filtra cada URL de la galería. */
const urlSegura = (s: string): string | null => (/^https?:\/\/\S+$/i.test((s ?? "").trim()) ? s.trim() : null);

export interface RawProducto {
  id?: string | null;
  nombre: string;
  marca?: string | null;
  descripcion?: string | null;
  categoriaId?: string | null;
  precio: number;
  precioAnterior?: number | null;
  interesPct: number;
  cuotas: number;
  frecuencia: string;
  fotos: string[];
  videoUrl?: string | null;
  activo: boolean;
  destacado: boolean;
  agotado?: boolean;
  /** Unidades (0100). null/undefined = sin control de stock. */
  stock?: number | null;
  orden: number;
  /** Visibilidad por audiencia (0089). null/vacío = visible para todos. */
  segmentoDef?: DefinicionSegmento | null;
  /** Quién despacha (0112): null/'propio' = propio; 'curbe' = lo despacha Curbe. */
  proveedor?: string | null;
  /** Costo para Presta Ya (0114). null/vacío = sin definir. */
  costo?: number | null;
}

function sanearProducto(raw: RawProducto): ProductoInput | null {
  const nombre = (raw.nombre ?? "").trim().slice(0, 100);
  if (!nombre) return null;
  const fotos = (Array.isArray(raw.fotos) ? raw.fotos : []).map(urlSegura).filter((u): u is string => !!u).slice(0, 10);
  const defRaw = normalizarSegmento(raw.segmentoDef ?? {});
  return {
    nombre,
    marca: (raw.marca ?? "").trim().slice(0, 60) || null,
    descripcion: (raw.descripcion ?? "").trim().slice(0, 1000) || null,
    categoriaId: raw.categoriaId && esUuid(raw.categoriaId) ? raw.categoriaId : null,
    precio: Math.max(0, Math.round(Number(raw.precio) || 0)),
    precioAnterior: Math.max(0, Math.round(Number(raw.precioAnterior) || 0)),
    interesPct: Math.max(0, Math.min(999, Math.round((Number(raw.interesPct) || 0) * 100) / 100)),
    cuotas: Math.max(0, Math.min(100000, Math.round(Number(raw.cuotas) || 0))),
    frecuencia: FRECUENCIAS.includes(raw.frecuencia as FrecuenciaProducto) ? (raw.frecuencia as FrecuenciaProducto) : "diario",
    fotos,
    videoUrl: raw.videoUrl ? urlSegura(raw.videoUrl) : null,
    activo: Boolean(raw.activo),
    destacado: Boolean(raw.destacado),
    agotado: Boolean(raw.agotado),
    // stock null/undefined = sin control; si viene, se acota a entero ≥ 0.
    stock: raw.stock == null ? null : Math.max(0, Math.min(1_000_000, Math.round(Number(raw.stock) || 0))),
    orden: Math.max(0, Math.min(9999, Math.round(Number(raw.orden) || 0))),
    segmentoDef: esSegmentoTodos(defRaw) ? null : defRaw,
    // Proveedor: solo 'curbe' habilita la cola de despacho; cualquier otra cosa = propio.
    proveedor: raw.proveedor === "curbe" ? "curbe" : null,
    // Costo: null/vacío = sin definir; si viene, entero ≥ 0 (sin float para dinero).
    costo: raw.costo == null ? null : Math.max(0, Math.round(Number(raw.costo) || 0)),
  };
}

/**
 * Genera una DESCRIPCIÓN de producto con IA (DeepSeek) a partir del nombre/marca/
 * categoría. Copy vendedor para e-commerce a crédito. Degrada con mensaje claro si
 * falta la API key o la IA no responde (nunca rompe el editor).
 */
export async function generarDescripcionIA(input: {
  nombre: string;
  marca?: string | null;
  categoria?: string | null;
}): Promise<{ ok: true; descripcion: string } | { ok: false; error: string }> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  const nombre = (input.nombre ?? "").trim().slice(0, 100);
  if (!nombre) return { ok: false, error: "Poné primero el nombre del producto." };
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return { ok: false, error: "La generación con IA no está configurada (falta la clave). Escribila a mano por ahora." };

  const contexto = [
    `Producto: ${nombre}`,
    input.marca ? `Marca: ${(input.marca || "").trim().slice(0, 60)}` : "",
    input.categoria ? `Categoría: ${(input.categoria || "").trim().slice(0, 60)}` : "",
  ].filter(Boolean).join("\n");
  const system =
    'Sos un redactor de e-commerce uruguayo para una tienda de electrodomésticos a crédito (cobro diario, cuotas chicas). ' +
    'Escribí una descripción ATRACTIVA y vendedora del producto: 3 a 5 frases, español rioplatense (tratá de "vos"), ' +
    "TEXTO PLANO (sin markdown, viñetas ni encabezados). Destacá los BENEFICIOS y el uso cotidiano con tono cálido y " +
    "aspiracional. No inventes especificaciones técnicas puntuales que no te den; hablá de beneficios generales. " +
    "No menciones precio ni cuotas.";
  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODELO_ASESOR, temperature: 0.85, max_tokens: 320, stream: false,
        messages: [{ role: "system", content: system }, { role: "user", content: contexto }],
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ok: false, error: "La IA no respondió. Probá de nuevo en un momento." };
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const texto = json.choices?.[0]?.message?.content?.trim();
    if (!texto) return { ok: false, error: "La IA no devolvió texto. Probá de nuevo." };
    return { ok: true, descripcion: texto.slice(0, 1000) };
  } catch {
    return { ok: false, error: "No se pudo generar. Probá de nuevo." };
  }
}

export async function guardarProducto(raw: RawProducto): Promise<Resultado> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "Solo el administrador gestiona la tienda." };
  const input = sanearProducto(raw);
  if (!input) return { ok: false, error: "Poné un nombre para el producto." };
  // El video debe estar SUBIDO al bucket (URL de storage). Una URL externa se guardaba
  // pero el navegador la bloquea por CSP → video roto sin aviso. Se rechaza con mensaje claro.
  if (input.videoUrl && !input.videoUrl.includes("/storage/v1/object/public/")) {
    return { ok: false, error: "Subí el video con el botón: una URL externa no se puede mostrar por seguridad." };
  }
  try {
    const db = await createSupabaseServer();
    if (raw.id) await actualizarProductoDb(db, raw.id, input);
    else await crearProductoDb(db, input, u.id);
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre, accion: raw.id ? "Editó producto" : "Creó producto",
      entidad: "producto", entidadId: raw.id ?? undefined,
      detalle: `${input.nombre} · $${input.precio.toLocaleString("es-UY")}${input.activo ? "" : " (inactivo)"}`,
    });
    revalidatePath("/admin/tienda");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
}

/** Guarda SOLO los precios (precio/costo/interés/cuotas/frecuencia) en un producto
 *  existente, desde la Calculadora, sin pisar fotos/descripción. Solo admin. */
export async function guardarPreciosProducto(input: {
  id: string; precio: number; costo: number | null; interesPct: number; cuotas: number; frecuencia: string;
}): Promise<Resultado> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "Solo el administrador gestiona la tienda." };
  if (!esUuid(input.id)) return { ok: false, error: "Producto inválido." };
  const precio = Math.max(0, Math.round(Number(input.precio) || 0));
  const cuotas = Math.max(1, Math.round(Number(input.cuotas) || 1));
  const interesPct = Math.max(0, Number(input.interesPct) || 0);
  const costo = input.costo == null ? null : Math.max(0, Math.round(Number(input.costo) || 0));
  const frecuencia: FrecuenciaProducto = FRECUENCIAS.includes(input.frecuencia as FrecuenciaProducto) ? (input.frecuencia as FrecuenciaProducto) : "diario";
  if (precio <= 0) return { ok: false, error: "El precio debe ser mayor a 0." };
  if (cuotas > 1000) return { ok: false, error: "Revisá la cantidad de cuotas (1 a 1000)." };
  try {
    const db = await createSupabaseServer();
    await actualizarPreciosProductoDb(db, input.id, { precio, costo, interesPct, cuotas, frecuencia });
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre, accion: "Actualizó precios de un producto (calculadora)",
      entidad: "producto", entidadId: input.id,
      detalle: `$${precio.toLocaleString("es-UY")} · ${cuotas} cuotas · ${interesPct}% · ${frecuencia}`,
    });
    revalidatePath("/admin/tienda");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
}

export async function alternarProducto(id: string, activo: boolean): Promise<Resultado> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(id)) return { ok: false, error: "Producto inválido." };
  try {
    const db = await createSupabaseServer();
    await setProductoActivoDb(db, id, activo);
    revalidatePath("/admin/tienda");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo actualizar." };
  }
}

/** Borra del bucket 'tienda' los objetos de una lista de URLs públicas (best-effort:
 *  no lanza; una URL externa —no del bucket— se ignora). Evita objetos huérfanos. */
async function borrarMediosTienda(urls: (string | null | undefined)[]): Promise<void> {
  const marker = `/object/public/${BUCKET}/`;
  const paths = urls
    .map((u) => { const i = (u ?? "").indexOf(marker); return i >= 0 ? (u as string).slice(i + marker.length) : null; })
    .filter((p): p is string => !!p);
  if (paths.length === 0) return;
  try {
    await createSupabaseAdmin().storage.from(BUCKET).remove(paths);
  } catch (e) {
    reportarError("tienda.borrarMedios", e); // best-effort: no debe frenar el borrado
  }
}

export async function eliminarProducto(id: string): Promise<Resultado> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(id)) return { ok: false, error: "Producto inválido." };
  try {
    const db = await createSupabaseServer();
    // Limpiar los medios del Storage ANTES de borrar la fila (evita huérfanos). Pero
    // SOLO los que ningún OTRO producto usa: una copia (duplicar) comparte fotos, y
    // borrarlas rompería la otra. Un video con URL externa no es del bucket → se ignora.
    const admin = createSupabaseAdmin();
    const { data: medios } = await admin.from("productos").select("fotos, video_url").eq("id", id).maybeSingle();
    if (medios) {
      const mios = [...(((medios.fotos as string[] | null) ?? [])), medios.video_url as string | null]
        .filter((u): u is string => !!u);
      const { data: otros } = await admin.from("productos").select("fotos, video_url").neq("id", id);
      const enUso = new Set<string>();
      for (const o of otros ?? []) {
        for (const f of ((o.fotos as string[] | null) ?? [])) enUso.add(f);
        if (o.video_url) enUso.add(o.video_url as string);
      }
      await borrarMediosTienda(mios.filter((u) => !enUso.has(u)));
    }
    await borrarProductoDb(db, id);
    await registrarAuditoria(db, { actorId: u.id, actorNombre: u.nombre, accion: "Borró producto", entidad: "producto", entidadId: id });
    revalidatePath("/admin/tienda");
    return { ok: true };
  } catch (e) {
    reportarError("eliminarProducto", e, { id });
    return { ok: false, error: "No se pudo borrar." };
  }
}

// ── Categorías ─────────────────────────────────────────────────────────────
export async function guardarCategoria(raw: { id?: string | null; nombre: string; orden: number; activo: boolean }): Promise<Resultado> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  const nombre = (raw.nombre ?? "").trim().slice(0, 60);
  if (!nombre) return { ok: false, error: "Poné un nombre para la categoría." };
  try {
    const db = await createSupabaseServer();
    if (raw.id) await actualizarCategoriaDb(db, raw.id, nombre, raw.orden, Boolean(raw.activo));
    else await crearCategoriaDb(db, nombre, raw.orden);
    revalidatePath("/admin/tienda");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar la categoría." };
  }
}

export async function eliminarCategoria(id: string): Promise<Resultado> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(id)) return { ok: false, error: "Categoría inválida." };
  try {
    const db = await createSupabaseServer();
    await borrarCategoriaDb(db, id); // productos.categoria_id → null (on delete set null)
    revalidatePath("/admin/tienda");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo borrar la categoría." };
  }
}

// ── Precio por cliente (override) ───────────────────────────────────────────
export async function fijarPrecioCliente(raw: {
  productoId: string; clienteId: string; precio: number; interesPct: number; cuotas: number; nota?: string | null;
}): Promise<Resultado> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(raw.productoId) || !esUuid(raw.clienteId)) return { ok: false, error: "Datos inválidos." };
  const precio = Math.max(0, Math.round(Number(raw.precio) || 0));
  if (!(precio > 0)) return { ok: false, error: "El precio debe ser mayor a 0." };
  try {
    const db = await createSupabaseServer();
    await setPrecioClienteDb(db, {
      productoId: raw.productoId, clienteId: raw.clienteId, precio,
      interesPct: Math.max(0, Math.min(999, Math.round((Number(raw.interesPct) || 0) * 100) / 100)),
      cuotas: Math.max(0, Math.round(Number(raw.cuotas) || 0)),
      nota: (raw.nota ?? "").trim().slice(0, 200) || null, creadoPor: u.id,
    });
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre, accion: "Fijó precio de producto por cliente",
      entidad: "producto", entidadId: raw.productoId, detalle: `$${precio.toLocaleString("es-UY")}`,
    });
    revalidatePath("/admin/tienda");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo fijar el precio." };
  }
}

/** Lista los precios especiales por cliente de un producto (para el editor). */
export async function preciosDeProducto(
  productoId: string,
): Promise<{ ok: true; precios: PrecioCliente[] } | { ok: false; error: string }> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(productoId)) return { ok: false, error: "Producto inválido." };
  try {
    const db = await createSupabaseServer();
    return { ok: true, precios: await getPreciosDeProducto(db, productoId) };
  } catch {
    return { ok: false, error: "No se pudieron leer los precios." };
  }
}

export async function quitarPrecioCliente(id: string): Promise<Resultado> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(id)) return { ok: false, error: "Registro inválido." };
  try {
    const db = await createSupabaseServer();
    await borrarPrecioClienteDb(db, id);
    revalidatePath("/admin/tienda");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo quitar el precio." };
  }
}

// ── Precio por SEGMENTO (calificación / zona) ───────────────────────────────
const TIPOS_SEG: TipoSegmento[] = ["calificacion", "zona"];

export async function fijarPrecioSegmento(raw: {
  productoId: string; tipo: string; valor: string; precio: number; interesPct: number; cuotas: number; nota?: string | null;
}): Promise<Resultado> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(raw.productoId)) return { ok: false, error: "Producto inválido." };
  if (!TIPOS_SEG.includes(raw.tipo as TipoSegmento)) return { ok: false, error: "Tipo de segmento inválido." };
  const tipo = raw.tipo as TipoSegmento;
  // El `valor` debe ser coherente con el tipo: una calificación válida, o un uuid de zona.
  const valor = (raw.valor ?? "").trim();
  if (tipo === "calificacion" && !CALIFICACIONES.includes(valor as Calificacion))
    return { ok: false, error: "Calificación inválida." };
  if (tipo === "zona" && !esUuid(valor)) return { ok: false, error: "Zona inválida." };
  const precio = Math.max(0, Math.round(Number(raw.precio) || 0));
  if (!(precio > 0)) return { ok: false, error: "El precio debe ser mayor a 0." };
  try {
    const db = await createSupabaseServer();
    await setPrecioSegmentoDb(db, {
      productoId: raw.productoId, tipo, valor, precio,
      interesPct: Math.max(0, Math.min(999, Math.round((Number(raw.interesPct) || 0) * 100) / 100)),
      cuotas: Math.max(0, Math.round(Number(raw.cuotas) || 0)),
      nota: (raw.nota ?? "").trim().slice(0, 200) || null, creadoPor: u.id,
    });
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre, accion: "Fijó precio de producto por segmento",
      entidad: "producto", entidadId: raw.productoId, detalle: `${tipo}:${valor} · $${precio.toLocaleString("es-UY")}`,
    });
    revalidatePath("/admin/tienda");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo fijar el precio. Probá de nuevo." };
  }
}

/** Reglas de precio por segmento de un producto (para el editor). */
export async function segmentosDeProducto(
  productoId: string,
): Promise<{ ok: true; segmentos: PrecioSegmento[] } | { ok: false; error: string }> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(productoId)) return { ok: false, error: "Producto inválido." };
  try {
    const db = await createSupabaseServer();
    return { ok: true, segmentos: await getSegmentosDeProducto(db, productoId) };
  } catch {
    return { ok: false, error: "No se pudieron leer los precios por segmento." };
  }
}

export async function quitarPrecioSegmento(id: string): Promise<Resultado> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(id)) return { ok: false, error: "Registro inválido." };
  try {
    const db = await createSupabaseServer();
    await borrarPrecioSegmentoDb(db, id);
    revalidatePath("/admin/tienda");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo quitar el precio." };
  }
}

// ── Leads / solicitudes ─────────────────────────────────────────────────────
export async function resolverSolicitud(id: string, estado: string, nota?: string | null): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || (u.rol !== "admin" && u.rol !== "supervisor")) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(id) || !ESTADOS.includes(estado as EstadoSolicitud)) return { ok: false, error: "Datos inválidos." };
  try {
    const db = await createSupabaseServer();
    await resolverSolicitudDb(db, id, estado as EstadoSolicitud, u.id, (nota ?? "").trim().slice(0, 200) || null);
    revalidatePath("/admin/tienda");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo actualizar la solicitud." };
  }
}

// ── Convertir un LEAD en una VENTA (crédito real) — P3b, money-critical ─────
export type ResultadoConversion =
  | { ok: true; prestamoId: string; clienteId: string; cuota: number; totalACobrar: number; sinCobrador: boolean; yaConvertido?: boolean }
  | { ok: false; error: string; faltaCobrador?: boolean };

/** Datos para el FORM de conversión (display): precio RESUELTO para el cliente (no
 *  el base) + si el cliente tiene cobrador (para exigir uno si falta, y no crear la
 *  venta fuera de ruta). La verdad se re-resuelve server-side al confirmar. Solo admin. */
export async function getDatosVentaLead(input: { solicitudId: string }): Promise<
  | {
      ok: true;
      precio: number; interesPct: number; cuotas: number; frecuencia: FrecuenciaProducto;
      personalizado: boolean; tieneCobrador: boolean; cobradorNombre: string | null;
      cobradores: { id: string; nombre: string }[];
      /** Lo que el cliente PIDIÓ (0149): la venta arranca de acá, no del default. */
      pedido: { folio: string | null; cantidad: number; cuotasPreferidas: number | null };
    }
  | { ok: false; error: string }
> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "Solo el administrador." };
  if (!esUuid(input.solicitudId)) return { ok: false, error: "Pedido inválido." };
  try {
    const db = await createSupabaseServer();
    const lead = await getSolicitudProductoPorId(db, input.solicitudId);
    if (!lead || !lead.productoId) return { ok: false, error: "No se encontró el pedido o su producto." };
    const [producto, cliente] = await Promise.all([
      getProductoAdmin(db, lead.productoId),
      getClientePorId(db, lead.clienteId),
    ]);
    if (!producto || !cliente) return { ok: false, error: "El producto o el cliente ya no existe." };
    // getTerminosVentaParaCliente LANZA ante un blip (regla de la barrida 15-08:
    // jamás caer al precio base en silencio) → el catch de abajo lo vuelve un
    // error CON salida en vez de una pantalla rota.
    const terminos = await getTerminosVentaParaCliente(db, producto, { id: cliente.id, calificacion: cliente.calificacion });
    const cob = await getCobradorDeCliente(db, cliente.id);
    // Solo se trae la lista de cobradores si hace falta elegir uno (cliente sin cobrador).
    let cobradores: { id: string; nombre: string }[] = [];
    if (!cob) {
      const { data } = await db.from("usuarios").select("id, nombre").eq("rol", "cobrador").eq("activo", true).order("nombre");
      cobradores = (data ?? []).map((c) => ({ id: c.id as string, nombre: c.nombre as string }));
    }
    return {
      ok: true,
      precio: terminos.precio,
      interesPct: terminos.interesPct,
      cuotas: terminos.cuotas,
      frecuencia: producto.frecuencia,
      personalizado: terminos.origen !== "base",
      tieneCobrador: !!cob,
      cobradorNombre: cob?.cobradorNombre ?? null,
      cobradores,
      pedido: { folio: lead.folio, cantidad: lead.cantidad, cuotasPreferidas: lead.cuotasPreferidas },
    };
  } catch (e) {
    reportarError("getDatosVentaLead", e, { solicitudId: input.solicitudId });
    return { ok: false, error: "No pudimos resolver el precio de este pedido. Reintentá en un momento." };
  }
}

/**
 * Convierte un pedido de tienda (lead) en un CRÉDITO real de venta. Money-critical:
 * es la primera alta de crédito "desde cero" de la app. Blindajes (espejo de la
 * renovación + idempotencia propia):
 *  · SOLO ADMIN (la tienda es del dueño; colocar capital lo decide el admin).
 *  · Kill switch (bloqueoSoloLectura) → congela la colocación en modo solo-lectura.
 *  · El precio se RE-RESUELVE server-side para ESTE cliente (individual>zona>calif>base):
 *    el número del navegador es solo display; el servidor manda.
 *  · Cuota/monto con la fórmula canónica (lib/venta, sin float). CAP total $100.000.
 *  · RPC ATÓMICO + advisory lock + op_id determinista → jamás dos créditos por
 *    doble-submit/ACK perdido; el reintento devuelve el crédito existente.
 *  · Corre con la sesión del gestor (RLS de prestamos vigente).
 */
export async function convertirLeadEnVenta(input: {
  solicitudId: string;
  /** Cuotas del plan (override del admin). Si falta, usa las del producto. */
  plazo?: number;
  frecuencia?: FrecuenciaProducto;
  /** Cobrador a asignar SI el cliente no tiene uno (sino la venta queda fuera de ruta). */
  cobradorId?: string;
}): Promise<ResultadoConversion> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "Solo el administrador puede convertir un pedido en venta." };
  // Kill switch: convertir COLOCA capital (crea un crédito) → congelar en freeze.
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;
  if (!esUuid(input.solicitudId)) return { ok: false, error: "Pedido inválido." };

  const db = await createSupabaseServer();
  const lead = await getSolicitudProductoPorId(db, input.solicitudId);
  if (!lead) return { ok: false, error: "No se encontró el pedido." };
  // Idempotente amable: si ya se convirtió, devolver el crédito existente (no otro).
  if (lead.estado === "convertida" && lead.prestamoId) {
    return { ok: true, prestamoId: lead.prestamoId, clienteId: lead.clienteId, cuota: 0, totalACobrar: 0, sinCobrador: false, yaConvertido: true };
  }
  if (lead.estado !== "nueva" && lead.estado !== "contactado") {
    return { ok: false, error: "Ese pedido está cerrado o descartado; solo se convierten pedidos abiertos." };
  }
  if (!lead.productoId) return { ok: false, error: "El producto de este pedido ya no existe." };

  const [producto, cliente] = await Promise.all([
    getProductoAdmin(db, lead.productoId),
    getClientePorId(db, lead.clienteId),
  ]);
  if (!producto) return { ok: false, error: "El producto ya no existe." };
  if (!producto.activo) return { ok: false, error: "El producto está inactivo. Activalo antes de venderlo." };
  if (producto.agotado || producto.stock === 0) return { ok: false, error: "El producto está sin stock. Reponelo antes de vender." };
  if (!cliente) return { ok: false, error: "El cliente ya no existe." };

  // Precio RESUELTO server-side para este cliente (nunca el número del navegador).
  const terminos = await getTerminosVentaParaCliente(db, producto, { id: cliente.id, calificacion: cliente.calificacion });

  const frecuencia: FrecuenciaProducto =
    input.frecuencia && FRECUENCIAS.includes(input.frecuencia) ? input.frecuencia : producto.frecuencia;
  // Si el cliente tiene un OVERRIDE que cambia las cuotas respecto al producto base,
  // se usa el plan RESUELTO (el que el cliente vio en su vitrina): no se le puede
  // cobrar un plazo distinto al que se le mostró. Solo cuando no hay override de
  // cuotas se respeta el plazo que el admin eligió a mano (o el resuelto por defecto).
  const overrideCambiaCuotas = terminos.cuotas > 0 && terminos.cuotas !== producto.cuotas;
  const plazo = overrideCambiaCuotas
    ? terminos.cuotas
    : (input.plazo != null ? Math.round(Number(input.plazo)) : terminos.cuotas);
  if (!Number.isInteger(plazo) || plazo < 1 || plazo > 1000) return { ok: false, error: "Revisá la cantidad de cuotas (entre 1 y 1000)." };

  const plan = calcularPlanVenta({ precio: terminos.precio, interesPct: terminos.interesPct, cuotas: plazo });
  if (!(plan.monto > 0) || !(plan.cuota > 0)) return { ok: false, error: "El precio o la cuota del producto son inválidos. Revisalos." };
  // CAP sobre el CAPITAL colocado (plan.monto = precio del producto, sin interés).
  // Decisión de negocio (Carlos, 07-31): el tope aplica al capital, NO a la deuda
  // total con interés — el admin valora al cliente antes de aprobar cada venta. No
  // es un bug: es intencional. Si algún día se quiere topar la deuda total, cambiar
  // acá y en el CAP defensivo de la RPC (comparar cuota*total_dias).
  if (plan.monto > RENOVACION_CAP_TOTAL) {
    return { ok: false, error: `La venta no puede superar $${RENOVACION_CAP_TOTAL.toLocaleString("es-UY")} (tope de crédito).` };
  }

  // Cobrador del cliente: la venta SOLO entra a una ruta si el cliente tiene un
  // cobrador ASIGNADO (la ruta se arma desde `asignaciones`, NO desde prestamos.cobrador_id).
  // Si no tiene, el admin DEBE elegir uno acá; sino la venta quedaría cobrable en el
  // cartón del cliente pero INVISIBLE para todo cobrador (plata colocada fuera de ruta).
  const cobExistente = await getCobradorDeCliente(db, cliente.id);
  let cobradorId = cobExistente?.cobradorId ?? null;
  // ¿Creamos la asignación recién para esta venta? Si la venta falla después, la
  // compensamos (no dejar al cliente en una ruta sin crédito). El orden —asignar
  // ANTES del RPC— es el seguro: si el RPC falla, no se colocó plata; solo queda una
  // asignación que revertimos acá.
  let asignacionCreada = false;
  if (!cobradorId) {
    const elegido = input.cobradorId;
    if (!elegido || !esUuid(elegido)) {
      return { ok: false, error: "Este cliente no tiene cobrador. Elegí quién lo va a cobrar para aprobar la venta.", faltaCobrador: true };
    }
    const { data: cobU } = await db.from("usuarios").select("rol, activo").eq("id", elegido).maybeSingle();
    if (!cobU || (cobU as { rol?: string }).rol !== "cobrador" || !(cobU as { activo?: boolean }).activo) {
      return { ok: false, error: "Elegí un cobrador válido.", faltaCobrador: true };
    }
    // El cliente no tenía cobrador → se le asigna éste (crea la asignación activa),
    // así la venta entra a su ruta. reasignarCliente respeta el índice único.
    // Va en try: desde 08-03 esa función LANZA si la ruta cambió pero no se pudo
    // mover el dueño de los créditos activos (la comisión quedaría en el cobrador
    // viejo). Sin capturarlo, el admin vería un error genérico de servidor en vez
    // del motivo — y acá todavía no se colocó plata, así que se corta limpio.
    try {
      await reasignarCliente(db, cliente.id, elegido);
    } catch (e) {
      const detalle = e instanceof Error ? e.message : "";
      return {
        ok: false,
        error: detalle.startsWith("La ruta se cambió")
          ? `${detalle} No se creó la venta; avisá a la oficina.`
          : "No se pudo asignar el cobrador. Probá de nuevo.",
        faltaCobrador: true,
      };
    }
    cobradorId = elegido;
    asignacionCreada = true;
  }

  const opId = opIdDeterminista("venta", input.solicitudId);
  // Se entrega hoy, se empieza a pagar el próximo día de cobro (igual que el
  // crédito de efectivo): la cuota 1 no puede vencer el día de la entrega.
  const fechaInicio = toIso(proximoDiaCobro(hoyUY()));

  const res = await crearVentaSegura(db, {
    solicitudId: input.solicitudId,
    clienteId: cliente.id,
    cobradorId,
    monto: plan.monto,
    cuota: plan.cuota,
    totalDias: plan.totalDias,
    frecuencia,
    fechaInicio,
    productoId: producto.id,
    productoNombre: producto.nombre,
    opId,
    creadoPor: u.id,
  });
  if (!res.ok) {
    // Compensación: si asignamos un cobrador recién para esta venta y la venta falló
    // (CAP defensivo, carrera de stock P0409, blip del RPC), bajamos la asignación
    // para no dejar al cliente en una ruta sin crédito. Best-effort (no tapa el error).
    if (asignacionCreada) await desactivarAsignacion(db, cliente.id, cobradorId).catch(() => {});
    return { ok: false, error: res.error };
  }

  await registrarAuditoria(db, {
    actorId: u.id,
    actorNombre: u.nombre,
    accion: "Convirtió pedido de tienda en venta",
    entidad: "cliente",
    entidadId: cliente.id,
    detalle: `${producto.nombre} · $${plan.monto.toLocaleString("es-UY")} en ${plan.totalDias} cuotas de $${plan.cuota.toLocaleString("es-UY")} (${frecuencia})`,
  });

  // Integración CURBE (0112): si el producto lo despacha Curbe, encolar el pedido
  // de despacho (idempotente por prestamo_id). Es LOGÍSTICA, no dinero: si algo
  // falla acá NO revierte la venta (el crédito ya está creado y es la verdad).
  if (producto.proveedor === "curbe") {
    try {
      const admin = createSupabaseAdmin();
      await crearPedidoCurbeDb(admin, {
        prestamoId: res.prestamoId,
        productoId: producto.id,
        productoNombre: producto.nombre,
        clienteNombre: cliente.nombre,
        clienteTelefono: cliente.telefono,
        clienteDireccion: cliente.direccion,
        monto: plan.totalACobrar,
      });
    } catch (e) {
      reportarError("convertirLeadEnVenta:pedidoCurbe", e, { prestamoId: res.prestamoId });
    }
  }

  revalidatePath("/admin/tienda");
  revalidatePath(`/admin/clientes/${cliente.id}`);
  revalidatePath("/admin");
  return { ok: true, prestamoId: res.prestamoId, clienteId: cliente.id, cuota: plan.cuota, totalACobrar: plan.totalACobrar, sinCobrador: !cobradorId };
}

// ── Subida de MEDIOS ────────────────────────────────────────────────────────
/** Sube una FOTO (o clip chico) al bucket 'tienda' vía la acción. Para VIDEOS
 *  grandes usar `crearUrlSubidaTienda` (el límite de las actions es 2 MB). */
export async function subirImagenTienda(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Elegí una imagen." };
  if (file.size > 3 * 1024 * 1024) return { ok: false, error: "La imagen es muy grande (máx. 3 MB)." };
  const tipos = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  if (!tipos.includes(file.type)) return { ok: false, error: "Formato no soportado (PNG/JPG/WEBP/GIF)." };
  try {
    const db = createSupabaseAdmin();
    const ext = file.type.split("/")[1].replace("jpeg", "jpg");
    const nombre = `img/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error } = await db.storage.from(BUCKET).upload(nombre, buf, { contentType: file.type, upsert: false });
    if (error) throw error;
    return { ok: true, url: db.storage.from(BUCKET).getPublicUrl(nombre).data.publicUrl };
  } catch {
    return { ok: false, error: "No se pudo subir la imagen. ¿Creaste el bucket 'tienda' (0076)?" };
  }
}

/**
 * Crea una URL FIRMADA de subida directa al bucket 'tienda' (el navegador sube el
 * archivo directo a Storage, sin pasar por la Server Action → sirve para VIDEOS
 * grandes que exceden el límite de 2 MB de las actions). Devuelve la URL firmada
 * (para el PUT) y la URL pública final (para guardar en el producto).
 */
export async function crearUrlSubidaTienda(input: {
  nombreArchivo: string; contentType: string;
}): Promise<{ ok: true; signedUrl: string; token: string; path: string; publicUrl: string } | { ok: false; error: string }> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  const ok = ["video/mp4", "video/webm", "video/quicktime", "image/png", "image/jpeg", "image/webp"];
  if (!ok.includes(input.contentType)) return { ok: false, error: "Formato no soportado." };
  const ext = (input.nombreArchivo.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  const path = `${input.contentType.startsWith("video") ? "video" : "img"}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    const db = createSupabaseAdmin();
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error("sin URL");
    return { ok: true, signedUrl: data.signedUrl, token: data.token, path, publicUrl: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
  } catch {
    return { ok: false, error: "No se pudo preparar la subida. ¿Creaste el bucket 'tienda' (0076)?" };
  }
}

/** Valida y normaliza una URL de medio pegada a mano por el admin (para <img>/<video>). */
export async function validarUrlMedio(url: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const u = await soloAdmin();
  if (!u) return { ok: false, error: "No tenés permisos." };
  const limpia = hrefSeguro((url ?? "").trim() || null);
  if (!limpia || !/^https?:\/\//i.test(limpia)) return { ok: false, error: "Poné una URL http(s) válida." };
  return { ok: true, url: limpia };
}
