// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ZONAS (Fase A/E).
//  Zonas de cobro, cobrador→zona (una sola) y supervisor↔zonas (varias).
//  Degrada a vacío si la migración 0030 aún no corrió (tablaFaltante).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Rol, Zona } from "@/types/db";
import { tablaFaltante, columnaFaltante } from "./errores";

function mapZona(r: Record<string, unknown>): Zona {
  return {
    id: r.id as string,
    nombre: r.nombre as string,
    color: (r.color as string | null) ?? null,
    descripcion: (r.descripcion as string | null) ?? null,
    activo: (r.activo as boolean) ?? true,
    creado_por: (r.creado_por as string | null) ?? null,
    creado_en: r.creado_en as string,
    actualizado_en: r.actualizado_en as string,
  };
}

/** Zonas activas, ordenadas por nombre. */
export async function getZonas(db: SupabaseClient): Promise<Zona[]> {
  const { data, error } = await db
    .from("zonas")
    .select("*")
    .eq("activo", true)
    .order("nombre");
  if (error) {
    if (tablaFaltante(error)) return [];
    throw error;
  }
  return (data ?? []).map(mapZona);
}

/** IDs de las zonas que supervisa un supervisor. */
export async function getZonasDeSupervisor(
  db: SupabaseClient,
  supervisorId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from("supervisor_zonas")
    .select("zona_id")
    .eq("supervisor_id", supervisorId);
  if (error) {
    if (tablaFaltante(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => (r as { zona_id: string }).zona_id);
}

/** Mapa zona_id → lista de supervisor_id que la cubren (para la UI del admin). */
export async function getSupervisoresPorZona(
  db: SupabaseClient,
): Promise<Record<string, string[]>> {
  const { data, error } = await db
    .from("supervisor_zonas")
    .select("zona_id, supervisor_id");
  if (error) {
    if (tablaFaltante(error)) return {};
    throw error;
  }
  const mapa: Record<string, string[]> = {};
  for (const r of (data ?? []) as { zona_id: string; supervisor_id: string }[]) {
    (mapa[r.zona_id] ??= []).push(r.supervisor_id);
  }
  return mapa;
}

export interface IntegranteZona {
  id: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  zona_id: string | null;
}

/** Todo el equipo con su zona (cobradores) para armar la pantalla de gestión. */
export async function getEquipoConZona(db: SupabaseClient): Promise<IntegranteZona[]> {
  const { data, error } = await db
    .from("usuarios")
    .select("id, nombre, rol, activo, zona_id")
    .order("rol")
    .order("nombre");
  if (error) {
    // Si zona_id aún no existe, reintentar sin esa columna (degradación).
    if (columnaFaltante(error)) {
      const alt = await db
        .from("usuarios")
        .select("id, nombre, rol, activo")
        .order("rol")
        .order("nombre");
      if (alt.error) throw alt.error;
      return (alt.data ?? []).map((u) => ({
        ...(u as Omit<IntegranteZona, "zona_id">),
        zona_id: null,
      }));
    }
    throw error;
  }
  return (data ?? []) as IntegranteZona[];
}

/** Cuenta de cobradores por zona (para las tarjetas de zona). */
export async function getConteoCobradoresPorZona(
  db: SupabaseClient,
): Promise<Record<string, number>> {
  const { data, error } = await db
    .from("usuarios")
    .select("zona_id")
    .eq("rol", "cobrador")
    .eq("activo", true)
    .not("zona_id", "is", null);
  if (error) {
    if (tablaFaltante(error) || columnaFaltante(error)) return {};
    throw error;
  }
  const conteo: Record<string, number> = {};
  for (const r of (data ?? []) as { zona_id: string }[]) {
    conteo[r.zona_id] = (conteo[r.zona_id] ?? 0) + 1;
  }
  return conteo;
}

// ── Escrituras (las guardas de rol viven en las Server Actions) ──────────

export async function crearZona(
  db: SupabaseClient,
  input: { nombre: string; color?: string | null; descripcion?: string | null },
  creadoPor: string,
): Promise<Zona> {
  const { data, error } = await db
    .from("zonas")
    .insert({
      nombre: input.nombre,
      color: input.color ?? null,
      descripcion: input.descripcion ?? null,
      creado_por: creadoPor,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapZona(data);
}

export async function editarZona(
  db: SupabaseClient,
  id: string,
  patch: { nombre?: string; color?: string | null; descripcion?: string | null },
): Promise<void> {
  const { error } = await db.from("zonas").update(patch).eq("id", id);
  if (error) throw error;
}

/** Baja lógica de una zona (no se borra; se desactiva). */
export async function desactivarZona(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("zonas").update({ activo: false }).eq("id", id);
  if (error) throw error;
}

/** Asigna (o quita, con null) la zona de un cobrador. */
export async function setZonaCobrador(
  db: SupabaseClient,
  cobradorId: string,
  zonaId: string | null,
): Promise<void> {
  const { error } = await db.from("usuarios").update({ zona_id: zonaId }).eq("id", cobradorId);
  if (error) throw error;
}

export async function asignarSupervisorZona(
  db: SupabaseClient,
  supervisorId: string,
  zonaId: string,
  asignadoPor: string,
): Promise<void> {
  const { error } = await db
    .from("supervisor_zonas")
    .upsert(
      { supervisor_id: supervisorId, zona_id: zonaId, asignado_por: asignadoPor },
      { onConflict: "supervisor_id,zona_id" },
    );
  if (error) throw error;
}

export async function quitarSupervisorZona(
  db: SupabaseClient,
  supervisorId: string,
  zonaId: string,
): Promise<void> {
  const { error } = await db
    .from("supervisor_zonas")
    .delete()
    .eq("supervisor_id", supervisorId)
    .eq("zona_id", zonaId);
  if (error) throw error;
}
