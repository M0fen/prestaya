// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RIFA (0045). Una rifa promocional que el admin le muestra a
//  los clientes (o solo a los mejores). Banner con mensaje + foto del premio.
//  La foto vive en el bucket PÚBLICO 'rifas' (URL pública directa). Degrada a
//  null si la tabla no existe (0045 sin correr).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { tablaFaltante, columnaFaltante } from "./errores";
import type { Calificacion } from "@/types/db";
import type { ClienteSegmentable, DefinicionSegmento } from "@/lib/segmentos";
import { clienteEnSegmento } from "@/lib/segmentos";
import { traerTodo } from "./paginado";
import { enLotes } from "./alcance";

export const BUCKET_RIFAS = "rifas";
const MAX_BYTES = 4_000_000;
const TIPOS_OK = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Calificaciones que cuentan como "mejores clientes" para la rifa dirigida. */
const MEJORES: ReadonlySet<Calificacion> = new Set<Calificacion>(["excelente", "bueno"]);

export interface Rifa {
  id: string;
  titulo: string;
  mensaje: string;
  premioTexto: string | null;
  botonTexto: string;
  fotoPath: string | null;
  /** URL pública de la foto del premio (si tiene). */
  fotoUrl: string | null;
  soloMejores: boolean;
  /** Audiencia rica (0089). Si está, MANDA sobre soloMejores. null = usa soloMejores. */
  segmentoDef: DefinicionSegmento | null;
  activo: boolean;
  // ── Ciclo de sorteo (0098) ──
  estado: "abierta" | "cerrada";
  ganadorClienteId: string | null;
  ganadorNumero: number | null;
  sorteoEn: string | null;
  folio: number | null;
}

function mapRifa(r: Record<string, unknown>): Rifa {
  const fotoPath = (r.foto_path as string | null) ?? null;
  return {
    id: r.id as string,
    titulo: (r.titulo as string) ?? "Gran rifa",
    mensaje: (r.mensaje as string) ?? "",
    premioTexto: (r.premio_texto as string | null) ?? null,
    botonTexto: (r.boton_texto as string) ?? "Ver premio",
    fotoPath,
    fotoUrl: fotoPath ? urlPublicaRifa(fotoPath) : null,
    soloMejores: (r.solo_mejores as boolean) ?? true,
    segmentoDef: (r.segmento_def as DefinicionSegmento | null) ?? null,
    activo: (r.activo as boolean) ?? false,
    // Defensivo: si 0098 aún no corrió, la rifa se comporta como "abierta sin sorteo".
    estado: (r.estado as Rifa["estado"]) ?? "abierta",
    ganadorClienteId: (r.ganador_cliente_id as string | null) ?? null,
    ganadorNumero: r.ganador_numero == null ? null : Number(r.ganador_numero),
    sorteoEn: (r.sorteo_en as string | null) ?? null,
    folio: r.folio == null ? null : Number(r.folio),
  };
}

/** URL pública (permanente) de una foto del bucket 'rifas'. */
export function urlPublicaRifa(path: string): string {
  return createSupabaseAdmin().storage.from(BUCKET_RIFAS).getPublicUrl(path).data.publicUrl;
}

/** La rifa (única fila de configuración). Para el admin. null si falta 0045. */
export async function getRifa(db: SupabaseClient): Promise<Rifa | null> {
  try {
    const { data, error } = await db
      .from("rifas")
      .select("*")
      .order("creado_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRifa(data) : null;
  } catch (e) {
    if (tablaFaltante(e)) return null;
    throw e;
  }
}

/**
 * La rifa a MOSTRARLE a un cliente: null si no hay rifa activa o si su AUDIENCIA no
 * lo incluye. Si la rifa tiene `segmentoDef` (audiencia rica 0089) MANDA sobre el
 * viejo `soloMejores`; si no, cae a la regla previa (todos, o solo excelente/bueno).
 */
export async function getRifaParaCliente(
  db: SupabaseClient,
  cliente: ClienteSegmentable,
): Promise<Rifa | null> {
  const rifa = await getRifa(db);
  if (!rifa || !rifa.activo) return null;
  if (rifa.segmentoDef) return clienteEnSegmento(cliente, rifa.segmentoDef) ? rifa : null;
  if (rifa.soloMejores && !(cliente.calificacion && MEJORES.has(cliente.calificacion))) return null;
  return rifa;
}

// ── Escrituras (admin) ─────────────────────────────────────────────────────

export async function guardarRifaDb(
  db: SupabaseClient,
  input: {
    id?: string | null;
    titulo: string;
    mensaje: string;
    premioTexto: string | null;
    botonTexto: string;
    soloMejores: boolean;
    segmentoDef: DefinicionSegmento | null;
    activo: boolean;
  },
): Promise<string> {
  const fila = {
    titulo: input.titulo,
    mensaje: input.mensaje,
    premio_texto: input.premioTexto,
    boton_texto: input.botonTexto,
    solo_mejores: input.soloMejores,
    segmento_def: input.segmentoDef,
    activo: input.activo,
    actualizado_en: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await db.from("rifas").update(fila).eq("id", input.id);
    if (error) throw error;
    return input.id;
  }
  const { data, error } = await db.from("rifas").insert(fila).select("id").single();
  if (error) throw error;
  return data.id as string;
}

// ── Sorteo real (0098): participación + participantes + cierre ─────────────
export interface ParticipanteRifa {
  clienteId: string;
  clienteNombre: string;
  numero: number;
}

/** El cliente participa en la rifa: ticket correlativo ATÓMICO e idempotente
 *  (RPC 0098). Devuelve su número, o null si 0098 aún no corrió (sin sorteo). */
export async function participarRifaSeguro(
  db: SupabaseClient,
  rifaId: string,
  clienteId: string,
): Promise<number | null> {
  const rpc = await db.rpc("participar_rifa_seguro", { p_rifa: rifaId, p_cliente: clienteId });
  if (!rpc.error) return Number(rpc.data);
  const code = (rpc.error as { code?: string }).code;
  if (code === "42883" || code === "PGRST202") return null; // 0098 sin correr
  throw rpc.error;
}

/** El número de ticket del cliente en la rifa (o null si no participa / sin 0098). */
export async function getParticipacionRifaCliente(
  db: SupabaseClient,
  rifaId: string,
  clienteId: string,
): Promise<number | null> {
  try {
    const { data, error } = await db
      .from("rifa_participaciones")
      .select("numero")
      .eq("rifa_id", rifaId)
      .eq("cliente_id", clienteId)
      .maybeSingle();
    if (error) throw error;
    return data ? Number((data as { numero: number }).numero) : null;
  } catch (e) {
    if (tablaFaltante(e)) return null;
    throw e;
  }
}

/** Participantes de una rifa con nombre (para el admin). Paginado + lotes. */
export async function getParticipacionesRifa(db: SupabaseClient, rifaId: string): Promise<ParticipanteRifa[]> {
  try {
    const filas = await traerTodo<{ cliente_id: string; numero: number }>((d, h) =>
      db.from("rifa_participaciones").select("cliente_id, numero").eq("rifa_id", rifaId)
        .order("id", { ascending: true }).range(d, h),
    );
    const ids = [...new Set(filas.map((r) => r.cliente_id))];
    const nombres = new Map<string, string>();
    for (const lote of enLotes(ids)) {
      const { data: cs } = await db.from("clientes").select("id, nombre").in("id", lote);
      for (const c of cs ?? []) nombres.set((c as { id: string }).id, (c as { nombre: string }).nombre);
    }
    return filas
      .map((r) => ({ clienteId: r.cliente_id, clienteNombre: nombres.get(r.cliente_id) ?? "—", numero: Number(r.numero) }))
      .sort((a, b) => a.numero - b.numero);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Cierra la rifa con el ganador + folio del comprobante (RPC 0098, atómico e
 *  idempotente). Devuelve el folio, o null si 0098 aún no corrió. */
export async function cerrarRifaDb(
  db: SupabaseClient,
  rifaId: string,
  ganadorClienteId: string,
  ganadorNumero: number,
): Promise<number | null> {
  const rpc = await db.rpc("cerrar_rifa_seguro", {
    p_rifa: rifaId, p_ganador: ganadorClienteId, p_numero: ganadorNumero,
  });
  if (!rpc.error) return rpc.data == null ? null : Number(rpc.data);
  const code = (rpc.error as { code?: string }).code;
  if (code === "42883" || code === "PGRST202") return null;
  throw rpc.error;
}

export type ResultadoFotoRifa = { ok: true; path: string } | { ok: false; error: string };

/** Sube la foto del premio (service_role) y guarda la ruta en la rifa. */
export async function subirFotoRifa(rifaId: string, dataUrl: string): Promise<ResultadoFotoRifa> {
  const m = /^data:(image\/[a-zA-Z]+);base64,(.+)$/.exec(dataUrl ?? "");
  if (!m || !TIPOS_OK.has(m[1].toLowerCase())) return { ok: false, error: "La foto no es válida." };
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > MAX_BYTES) return { ok: false, error: "La foto es demasiado grande." };
  const admin = createSupabaseAdmin();
  const ext = m[1].split("/")[1].toLowerCase();
  const path = `${rifaId}/${Date.now()}.${ext}`;
  const up = await admin.storage.from(BUCKET_RIFAS).upload(path, buffer, {
    contentType: m[1].toLowerCase(),
    upsert: true,
  });
  if (up.error) return { ok: false, error: "No se pudo subir la foto (¿corriste la 0045?)." };
  const upd = await admin.from("rifas").update({ foto_path: path }).eq("id", rifaId);
  if (upd.error) return { ok: false, error: "No se pudo asociar la foto a la rifa." };
  return { ok: true, path };
}
