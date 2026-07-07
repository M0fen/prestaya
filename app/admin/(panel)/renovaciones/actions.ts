"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — ALTA REAL del crédito de renovación (solo gestor).
//  Escribe dinero: finaliza el crédito saldado y crea el nuevo, arrastrando la
//  tasa (la cuota la calcula el servidor, ver lib/data/renovaciones.ts).
//  Corre con la sesión del gestor → el RLS exige app_es_gestor().
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor, esAdmin } from "@/lib/auth";
import { crearRenovacion, type ResultadoAlta } from "@/lib/data/renovaciones";
import {
  crearSolicitudDb,
  getSolicitudPorId,
  resolverSolicitudDb,
} from "@/lib/data/solicitudesRenovacion";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { UYU } from "@/lib/format";
import type { FrecuenciaPrestamo } from "@/types/db";

type ResultadoSimple = { ok: true } | { ok: false; error: string };

export async function renovarCredito(input: {
  clienteId: string;
  prestamoAnteriorId: string;
  monto: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
}): Promise<ResultadoAlta> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || !esGestor(usuario.rol)) {
    return { ok: false, error: "No tenés permisos para dar de alta créditos." };
  }

  const db = await createSupabaseServer();
  const res = await crearRenovacion(db, {
    clienteId: input.clienteId,
    prestamoAnteriorId: input.prestamoAnteriorId,
    monto: Math.round(Number(input.monto)),
    totalDias: Math.round(Number(input.totalDias)),
    frecuencia: input.frecuencia,
    creadoPor: usuario.id,
  });

  if (res.ok) {
    await registrarAuditoria(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      accion: "Renovó crédito",
      entidad: "cliente",
      entidadId: input.clienteId,
      detalle: `Nuevo crédito ${UYU(Math.round(Number(input.monto)))} × ${Math.round(Number(input.totalDias))} (${input.frecuencia})`,
    });
    // El nuevo crédito cambia cartera, mora y renovaciones.
    revalidatePath("/admin/renovaciones");
    revalidatePath("/admin/mora");
    revalidatePath("/admin");
  }
  return res;
}

// ── Flujo de APROBACIÓN (supervisor solicita → admin resuelve) ─────────────

/** El gestor (típicamente supervisor) SOLICITA una renovación (queda pendiente). */
export async function solicitarRenovacion(input: {
  clienteId: string;
  prestamoAnteriorId: string;
  monto: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
}): Promise<ResultadoSimple> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  const monto = Math.round(Number(input.monto));
  const totalDias = Math.round(Number(input.totalDias));
  if (!(monto > 0) || !(totalDias > 0)) return { ok: false, error: "Revisá el monto y las cuotas." };
  try {
    const db = await createSupabaseServer();
    await crearSolicitudDb(db, {
      clienteId: input.clienteId,
      prestamoAnteriorId: input.prestamoAnteriorId,
      monto,
      totalDias,
      frecuencia: input.frecuencia,
      solicitadoPor: u.id,
      solicitadoPorNombre: u.nombre,
    });
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Solicitó renovación",
      entidad: "cliente",
      entidadId: input.clienteId,
      detalle: `${UYU(monto)} × ${totalDias} (${input.frecuencia})`,
    });
    revalidatePath("/admin/renovaciones");
    return { ok: true };
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "23505")
      return { ok: false, error: "Ya hay una solicitud pendiente para este crédito." };
    return { ok: false, error: "No se pudo enviar. ¿Corriste la migración 0029?" };
  }
}

/** El ADMIN aprueba: crea el crédito de renovación y cierra la solicitud. */
export async function aprobarSolicitud(id: string): Promise<ResultadoAlta> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol))
    return { ok: false, error: "Solo el administrador aprueba renovaciones." };
  try {
    const db = await createSupabaseServer();
    const s = await getSolicitudPorId(db, id);
    if (!s || s.estado !== "pendiente") return { ok: false, error: "La solicitud ya no está pendiente." };
    const res = await crearRenovacion(db, {
      clienteId: s.clienteId,
      prestamoAnteriorId: s.prestamoAnteriorId,
      monto: s.monto,
      totalDias: s.totalDias,
      frecuencia: s.frecuencia,
      creadoPor: u.id,
    });
    if (!res.ok) return res;
    await resolverSolicitudDb(db, id, { estado: "aprobada", resueltoPor: u.id, prestamoNuevoId: res.prestamoId });
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Aprobó renovación",
      entidad: "cliente",
      entidadId: s.clienteId,
      detalle: `${UYU(s.monto)} × ${s.totalDias} (${s.frecuencia})`,
    });
    revalidatePath("/admin/renovaciones");
    revalidatePath("/admin/mora");
    revalidatePath("/admin");
    return res;
  } catch {
    return { ok: false, error: "No se pudo aprobar. Probá de nuevo." };
  }
}

/** El ADMIN rechaza una solicitud (con motivo opcional). */
export async function rechazarSolicitud(id: string, motivo: string): Promise<ResultadoSimple> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol))
    return { ok: false, error: "Solo el administrador resuelve renovaciones." };
  try {
    const db = await createSupabaseServer();
    await resolverSolicitudDb(db, id, {
      estado: "rechazada",
      resueltoPor: u.id,
      motivoRechazo: (motivo ?? "").trim().slice(0, 300) || null,
    });
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Rechazó renovación",
      entidad: "solicitud",
      entidadId: id,
      detalle: (motivo ?? "").slice(0, 120),
    });
    revalidatePath("/admin/renovaciones");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo rechazar." };
  }
}
