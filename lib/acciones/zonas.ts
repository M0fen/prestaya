"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — gestión de ZONAS (SOLO admin, ver decisión "reasignar/
//  fronteras = admin"). Crear zonas, mover cobradores, asignar supervisores.
//  Todo auditado. Las guardas de rol están acá además de en la RLS (0030/0031).
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import {
  crearZona,
  editarZona,
  desactivarZona,
  setZonaCobrador,
  asignarSupervisorZona,
  quitarSupervisorZona,
} from "@/lib/data/zonas";
import { registrarAuditoria } from "@/lib/data/auditoria";

type Resultado = { ok: true } | { ok: false; error: string };

const SIN_MIGRACION = "No se pudo guardar. ¿Corriste la migración 0030?";

async function guardAdmin() {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return null;
  return u;
}

export async function crearZonaAction(input: {
  nombre: string;
  color?: string | null;
  descripcion?: string | null;
}): Promise<Resultado> {
  const u = await guardAdmin();
  if (!u) return { ok: false, error: "Solo el administrador puede crear zonas." };
  const nombre = (input.nombre ?? "").trim();
  if (nombre.length < 2) return { ok: false, error: "Poné un nombre de zona válido." };
  try {
    const db = await createSupabaseServer();
    const zona = await crearZona(db, { ...input, nombre }, u.id);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Creó una zona",
      entidad: "zona",
      entidadId: zona.id,
      detalle: nombre,
    });
    revalidatePath("/admin/zonas");
    return { ok: true };
  } catch (e) {
    // 23505 = violación de índice único (ya existe una zona activa con ese nombre).
    if ((e as { code?: string })?.code === "23505")
      return { ok: false, error: "Ya existe una zona activa con ese nombre." };
    return { ok: false, error: SIN_MIGRACION };
  }
}

export async function editarZonaAction(input: {
  id: string;
  nombre?: string;
  color?: string | null;
  descripcion?: string | null;
}): Promise<Resultado> {
  const u = await guardAdmin();
  if (!u) return { ok: false, error: "Solo el administrador puede editar zonas." };
  try {
    const db = await createSupabaseServer();
    const patch: { nombre?: string; color?: string | null; descripcion?: string | null } = {};
    // Cap defensivo de longitud (consistente con crearZonaAction): nada ilimitado a la base.
    if (input.nombre != null) patch.nombre = input.nombre.trim().slice(0, 60);
    if (input.color !== undefined) patch.color = input.color?.slice(0, 20) ?? null;
    if (input.descripcion !== undefined) patch.descripcion = input.descripcion?.slice(0, 300) ?? null;
    await editarZona(db, input.id, patch);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Editó una zona",
      entidad: "zona",
      entidadId: input.id,
    });
    revalidatePath("/admin/zonas");
    return { ok: true };
  } catch {
    return { ok: false, error: SIN_MIGRACION };
  }
}

export async function desactivarZonaAction(id: string): Promise<Resultado> {
  const u = await guardAdmin();
  if (!u) return { ok: false, error: "Solo el administrador puede desactivar zonas." };
  try {
    const db = await createSupabaseServer();
    await desactivarZona(db, id);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Desactivó una zona",
      entidad: "zona",
      entidadId: id,
    });
    revalidatePath("/admin/zonas");
    return { ok: true };
  } catch {
    return { ok: false, error: SIN_MIGRACION };
  }
}

export async function setZonaCobradorAction(input: {
  cobradorId: string;
  zonaId: string | null;
}): Promise<Resultado> {
  const u = await guardAdmin();
  if (!u) return { ok: false, error: "Solo el administrador mueve cobradores de zona." };
  try {
    const db = await createSupabaseServer();
    await setZonaCobrador(db, input.cobradorId, input.zonaId);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: input.zonaId ? "Asignó un cobrador a una zona" : "Quitó a un cobrador de su zona",
      entidad: "usuario",
      entidadId: input.cobradorId,
      detalle: input.zonaId ?? "sin zona",
    });
    revalidatePath("/admin/zonas");
    return { ok: true };
  } catch {
    return { ok: false, error: SIN_MIGRACION };
  }
}

export async function setSupervisorZonaAction(input: {
  supervisorId: string;
  zonaId: string;
  cubre: boolean;
}): Promise<Resultado> {
  const u = await guardAdmin();
  if (!u) return { ok: false, error: "Solo el administrador asigna supervisores a zonas." };
  try {
    const db = await createSupabaseServer();
    if (input.cubre) await asignarSupervisorZona(db, input.supervisorId, input.zonaId, u.id);
    else await quitarSupervisorZona(db, input.supervisorId, input.zonaId);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: input.cubre ? "Asignó un supervisor a una zona" : "Quitó a un supervisor de una zona",
      entidad: "supervisor_zona",
      entidadId: input.supervisorId,
      detalle: input.zonaId,
    });
    revalidatePath("/admin/zonas");
    return { ok: true };
  } catch {
    return { ok: false, error: SIN_MIGRACION };
  }
}
