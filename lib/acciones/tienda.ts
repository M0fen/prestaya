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
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { hrefSeguro } from "@/lib/seguridad";
import { esUuid } from "@/lib/idempotencia";
import { normalizarSegmento, esSegmentoTodos, type DefinicionSegmento } from "@/lib/segmentos";
import {
  crearProductoDb, actualizarProductoDb, setProductoActivoDb, borrarProductoDb,
  crearCategoriaDb, actualizarCategoriaDb, borrarCategoriaDb,
  setPrecioClienteDb, borrarPrecioClienteDb, resolverSolicitudDb, getPreciosDeProducto,
  setPrecioSegmentoDb, borrarPrecioSegmentoDb, getSegmentosDeProducto,
  type ProductoInput, type FrecuenciaProducto, type EstadoSolicitud, type PrecioCliente,
  type PrecioSegmento, type TipoSegmento,
} from "@/lib/data/tienda";
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
  orden: number;
  /** Visibilidad por audiencia (0089). null/vacío = visible para todos. */
  segmentoDef?: DefinicionSegmento | null;
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
    orden: Math.max(0, Math.min(9999, Math.round(Number(raw.orden) || 0))),
    segmentoDef: esSegmentoTodos(defRaw) ? null : defRaw,
  };
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
