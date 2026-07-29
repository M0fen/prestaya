"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — INCIDENCIAS (reporte de bugs in-app, 0107). Cualquier usuario
//  interno REPORTA (queda 'abierto'); solo el admin TRIAGE (en_progreso/resuelto).
//  El reporte también deja rastro en observabilidad (reportarError) para que el
//  equipo lo vea en los logs/Sentry, no solo en la bandeja.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { reportarError } from "@/lib/observabilidad";
import {
  crearIncidenciaDb, resolverIncidenciaDb,
  type CategoriaIncidencia, type EstadoIncidencia,
} from "@/lib/data/incidencias";

type Resultado = { ok: true } | { ok: false; error: string };

const CATEGORIAS: CategoriaIncidencia[] = ["bug", "confuso", "lento", "dato_mal", "sugerencia", "otro"];
const ESTADOS: EstadoIncidencia[] = ["abierto", "en_progreso", "resuelto"];

/** Un usuario interno reporta un problema. Auto-adjunta rol/ruta/user-agent. */
export async function reportarIncidencia(input: {
  descripcion: string;
  categoria?: string;
  ruta?: string | null;
  userAgent?: string | null;
  contexto?: Record<string, unknown> | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return { ok: false, error: "Sesión no válida." };
  const descripcion = (input.descripcion ?? "").trim().slice(0, 2000);
  if (descripcion.length < 3) return { ok: false, error: "Contanos qué pasó (un poquito más de detalle)." };
  const categoria = CATEGORIAS.includes(input.categoria as CategoriaIncidencia)
    ? (input.categoria as CategoriaIncidencia)
    : "otro";
  const ruta = (input.ruta ?? "").toString().slice(0, 300) || null;
  const userAgent = (input.userAgent ?? "").toString().slice(0, 400) || null;
  try {
    const db = await createSupabaseServer();
    await crearIncidenciaDb(db, {
      usuarioId: u.id, usuarioNombre: u.nombre, rol: u.rol,
      ruta, userAgent, descripcion, categoria, contexto: input.contexto ?? null,
    });
    // Deja también rastro en observabilidad (para el equipo, sin bloquear el reporte).
    reportarError("incidencia.reporte", new Error(`[${categoria}] ${descripcion.slice(0, 120)}`), {
      usuario: u.nombre, rol: u.rol, ruta: ruta ?? "",
    });
    revalidatePath("/admin/incidencias");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo enviar el reporte. Probá de nuevo." };
  }
}

/** El admin cambia el estado de una incidencia (triage). */
export async function resolverIncidencia(input: {
  id: string;
  estado: string;
  nota?: string | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!ESTADOS.includes(input.estado as EstadoIncidencia)) return { ok: false, error: "Estado inválido." };
  const nota = (input.nota ?? "").trim().slice(0, 500) || null;
  try {
    const db = await createSupabaseServer();
    await resolverIncidenciaDb(db, input.id, input.estado as EstadoIncidencia, u.id, nota);
    revalidatePath("/admin/incidencias");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo actualizar. Probá de nuevo." };
  }
}
