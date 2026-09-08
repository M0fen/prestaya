// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — PENDIENTES DEL PILOTO (0157). La agenda de lo que hay que
//  decidir o arreglar, con dueño, plata, estado e historial. Solo dev: se lee
//  y escribe por service_role detrás de requireDev(); la tabla no tiene
//  políticas para nadie más. Nada se borra: cambia de estado con nota y rastro.
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { tablaFaltante } from "./errores";

export type DuenoPendiente = "carlos" | "mauricio" | "carolina" | "equipo";
export type CategoriaPendiente = "plata" | "datos" | "adopcion" | "tecnico" | "negocio";
export type PrioridadPendiente = "alta" | "media" | "baja";
export type EstadoPendiente = "abierto" | "en_progreso" | "resuelto" | "aceptado";

export const DUENOS: DuenoPendiente[] = ["carlos", "mauricio", "carolina", "equipo"];
export const CATEGORIAS: CategoriaPendiente[] = ["plata", "datos", "adopcion", "tecnico", "negocio"];
export const PRIORIDADES: PrioridadPendiente[] = ["alta", "media", "baja"];
export const ESTADOS: EstadoPendiente[] = ["abierto", "en_progreso", "resuelto", "aceptado"];

export interface CambioPendiente {
  en: string;
  por: string;
  de: EstadoPendiente | null;
  a: EstadoPendiente;
  nota: string | null;
}

export interface Pendiente {
  id: string;
  clave: string | null;
  titulo: string;
  detalle: string | null;
  dueno: DuenoPendiente;
  categoria: CategoriaPendiente;
  prioridad: PrioridadPendiente;
  monto: number | null;
  estado: EstadoPendiente;
  origen: string | null;
  desde: string; // YYYY-MM-DD
  creadoEn: string;
  actualizadoEn: string;
  resueltoEn: string | null;
  notaResolucion: string | null;
  historial: CambioPendiente[];
}

const esEstado = (v: unknown): v is EstadoPendiente => ESTADOS.includes(v as EstadoPendiente);
const esDueno = (v: unknown): v is DuenoPendiente => DUENOS.includes(v as DuenoPendiente);
const esCategoria = (v: unknown): v is CategoriaPendiente => CATEGORIAS.includes(v as CategoriaPendiente);
const esPrioridad = (v: unknown): v is PrioridadPendiente => PRIORIDADES.includes(v as PrioridadPendiente);

function mapear(r: Record<string, unknown>): Pendiente {
  return {
    id: r.id as string,
    clave: (r.clave as string | null) ?? null,
    titulo: r.titulo as string,
    detalle: (r.detalle as string | null) ?? null,
    dueno: esDueno(r.dueno) ? r.dueno : "carlos",
    categoria: esCategoria(r.categoria) ? r.categoria : "datos",
    prioridad: esPrioridad(r.prioridad) ? r.prioridad : "media",
    monto: r.monto == null ? null : Number(r.monto),
    estado: esEstado(r.estado) ? r.estado : "abierto",
    origen: (r.origen as string | null) ?? null,
    desde: String(r.desde),
    creadoEn: r.creado_en as string,
    actualizadoEn: r.actualizado_en as string,
    resueltoEn: (r.resuelto_en as string | null) ?? null,
    notaResolucion: (r.nota_resolucion as string | null) ?? null,
    historial: Array.isArray(r.historial) ? (r.historial as CambioPendiente[]) : [],
  };
}

/** Todos los pendientes (abiertos primero, por prioridad y plata). Degrada a []
 *  si la 0157 no corrió. */
export async function getPendientes(): Promise<Pendiente[]> {
  const admin = createSupabaseAdmin();
  try {
    const { data, error } = await admin.from("piloto_pendientes").select("*").order("creado_en", { ascending: true });
    if (error) throw error;
    const orden: Record<EstadoPendiente, number> = { abierto: 0, en_progreso: 1, aceptado: 2, resuelto: 3 };
    const prio: Record<PrioridadPendiente, number> = { alta: 0, media: 1, baja: 2 };
    return ((data ?? []) as Record<string, unknown>[]).map(mapear).sort((a, b) => {
      const d = orden[a.estado] - orden[b.estado];
      if (d !== 0) return d;
      const p = prio[a.prioridad] - prio[b.prioridad];
      if (p !== 0) return p;
      return (b.monto ?? 0) - (a.monto ?? 0);
    });
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export interface NuevoPendiente {
  titulo: string;
  detalle: string | null;
  dueno: DuenoPendiente;
  categoria: CategoriaPendiente;
  prioridad: PrioridadPendiente;
  monto: number | null;
  origen: string | null;
}

export async function crearPendiente(p: NuevoPendiente, actor: { id: string; nombre: string }): Promise<void> {
  const admin = createSupabaseAdmin();
  const cambio: CambioPendiente = { en: new Date().toISOString(), por: actor.nombre, de: null, a: "abierto", nota: "creado desde el panel" };
  const { error } = await admin.from("piloto_pendientes").insert({
    titulo: p.titulo.trim().slice(0, 200),
    detalle: p.detalle?.trim().slice(0, 4000) || null,
    dueno: p.dueno,
    categoria: p.categoria,
    prioridad: p.prioridad,
    monto: p.monto,
    origen: p.origen?.trim().slice(0, 120) || null,
    creado_por: actor.id,
    historial: [cambio],
  });
  if (error) throw error;
}

/** Mueve un pendiente de estado, con nota, dejando el rastro en `historial`. */
export async function cambiarEstadoPendiente(
  id: string,
  estado: EstadoPendiente,
  nota: string | null,
  actor: { id: string; nombre: string },
): Promise<void> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.from("piloto_pendientes").select("estado, historial").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("El pendiente no existe.");
  const actual = mapear({ ...data, id, titulo: "", desde: "", creado_en: "", actualizado_en: "" });
  const cambio: CambioPendiente = { en: new Date().toISOString(), por: actor.nombre, de: actual.estado, a: estado, nota: nota?.trim() || null };
  const cerrado = estado === "resuelto" || estado === "aceptado";
  const { error: e2 } = await admin
    .from("piloto_pendientes")
    .update({
      estado,
      actualizado_en: new Date().toISOString(),
      resuelto_en: cerrado ? new Date().toISOString() : null,
      nota_resolucion: cerrado ? (nota?.trim() || null) : null,
      historial: [...actual.historial, cambio],
    })
    .eq("id", id);
  if (e2) throw e2;
}

export async function editarPendiente(
  id: string,
  campos: Partial<Pick<NuevoPendiente, "titulo" | "detalle" | "dueno" | "categoria" | "prioridad" | "monto">>,
): Promise<void> {
  const admin = createSupabaseAdmin();
  const patch: Record<string, unknown> = { actualizado_en: new Date().toISOString() };
  if (campos.titulo !== undefined) patch.titulo = campos.titulo.trim().slice(0, 200);
  if (campos.detalle !== undefined) patch.detalle = campos.detalle?.trim().slice(0, 4000) || null;
  if (campos.dueno !== undefined) patch.dueno = campos.dueno;
  if (campos.categoria !== undefined) patch.categoria = campos.categoria;
  if (campos.prioridad !== undefined) patch.prioridad = campos.prioridad;
  if (campos.monto !== undefined) patch.monto = campos.monto;
  const { error } = await admin.from("piloto_pendientes").update(patch).eq("id", id);
  if (error) throw error;
}
