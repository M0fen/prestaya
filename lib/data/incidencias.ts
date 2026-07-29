// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — INCIDENCIAS (reporte de bugs in-app, 0107). El usuario reporta
//  un problema vivido en la app; el admin lo triage. Degrada elegante si falta 0107.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "./errores";

export type CategoriaIncidencia = "bug" | "confuso" | "lento" | "dato_mal" | "sugerencia" | "otro";
export type EstadoIncidencia = "abierto" | "en_progreso" | "resuelto";

export interface Incidencia {
  id: string;
  usuarioId: string | null;
  usuarioNombre: string | null;
  rol: string | null;
  ruta: string | null;
  userAgent: string | null;
  descripcion: string;
  categoria: CategoriaIncidencia;
  estado: EstadoIncidencia;
  contexto: Record<string, unknown> | null;
  creadoEn: string;
  resueltoPorNombre: string | null;
  resueltoEn: string | null;
  notaResolucion: string | null;
}

function mapIncidencia(r: Record<string, unknown>): Incidencia {
  return {
    id: r.id as string,
    usuarioId: (r.usuario_id as string | null) ?? null,
    usuarioNombre: (r.usuario_nombre as string | null) ?? null,
    rol: (r.rol as string | null) ?? null,
    ruta: (r.ruta as string | null) ?? null,
    userAgent: (r.user_agent as string | null) ?? null,
    descripcion: (r.descripcion as string) ?? "",
    categoria: (r.categoria as CategoriaIncidencia) ?? "otro",
    estado: (r.estado as EstadoIncidencia) ?? "abierto",
    contexto: (r.contexto as Record<string, unknown> | null) ?? null,
    creadoEn: r.creado_en as string,
    resueltoPorNombre: null, // se resuelve aparte (nombre del usuario)
    resueltoEn: (r.resuelto_en as string | null) ?? null,
    notaResolucion: (r.nota_resolucion as string | null) ?? null,
  };
}

export async function crearIncidenciaDb(
  db: SupabaseClient,
  input: {
    usuarioId: string; usuarioNombre: string; rol: string;
    ruta: string | null; userAgent: string | null;
    descripcion: string; categoria: CategoriaIncidencia; contexto?: Record<string, unknown> | null;
  },
): Promise<void> {
  const { error } = await db.from("incidencias").insert({
    usuario_id: input.usuarioId,
    usuario_nombre: input.usuarioNombre,
    rol: input.rol,
    ruta: input.ruta,
    user_agent: input.userAgent,
    descripcion: input.descripcion,
    categoria: input.categoria,
    contexto: input.contexto ?? null,
  });
  if (error) throw error;
}

/** Lista de incidencias para el admin (más nuevas primero). Degrada a [] sin 0107. */
export async function getIncidencias(db: SupabaseClient, estado?: EstadoIncidencia): Promise<Incidencia[]> {
  try {
    let q = db.from("incidencias").select("*");
    if (estado) q = q.eq("estado", estado);
    const { data, error } = await q.order("creado_en", { ascending: false }).limit(300);
    if (error) throw error;
    const filas = (data ?? []).map(mapIncidencia);
    // Nombre de quién resolvió (para la traza).
    const rows = data ?? [];
    const ids = [...new Set(rows.map((r) => r.resuelto_por as string | null).filter(Boolean) as string[])];
    if (ids.length > 0) {
      const { data: us } = await db.from("usuarios").select("id, nombre").in("id", ids);
      const nombre = new Map((us ?? []).map((u) => [u.id as string, u.nombre as string]));
      return filas.map((f, i) => ({
        ...f,
        resueltoPorNombre: rows[i].resuelto_por ? nombre.get(rows[i].resuelto_por as string) ?? null : null,
      }));
    }
    return filas;
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export async function contarIncidenciasAbiertas(db: SupabaseClient): Promise<number> {
  try {
    const { count, error } = await db
      .from("incidencias")
      .select("*", { count: "exact", head: true })
      .in("estado", ["abierto", "en_progreso"]);
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    if (tablaFaltante(e)) return 0;
    throw e;
  }
}

export async function resolverIncidenciaDb(
  db: SupabaseClient,
  id: string,
  estado: EstadoIncidencia,
  resueltoPor: string,
  nota: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { estado };
  if (estado === "resuelto") {
    patch.resuelto_por = resueltoPor;
    patch.resuelto_en = new Date().toISOString();
    if (nota != null) patch.nota_resolucion = nota;
  }
  const { error } = await db.from("incidencias").update(patch).eq("id", id);
  if (error) throw error;
}
