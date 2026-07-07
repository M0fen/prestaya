"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — ANULACIÓN de pagos (decisión 2: doble registro).
//   · admin: anula DIRECTO.
//   · supervisor: SOLICITA anular un pago de SU zona → una SEGUNDA persona
//     (admin u otro gestor distinto) CONFIRMA. Recién ahí se anula.
//  El doble registro se valida en el servidor con el núcleo puro permisos.ts.
//  El pago se marca anulado con service_role (por RLS anular = solo admin);
//  nunca se borra. Todo queda auditado.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual } from "@/lib/auth";
import { getZonasDeSupervisor } from "@/lib/data/zonas";
import {
  actorDesde,
  puedeAnularPagoDirecto,
  puedeSolicitarAnulacion,
  puedeConfirmarAnulacion,
} from "@/lib/permisos";
import {
  getZonaDePago,
  getPagoResumen,
  getSolicitud,
  getSolicitudPendienteDePago,
} from "@/lib/data/anulaciones";
import { registrarAuditoria } from "@/lib/data/auditoria";
import type { Usuario } from "@/types/db";

type Resultado = { ok: true } | { ok: false; error: string };

async function actorYUsuario() {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return null;
  const zonas = u.rol === "supervisor" ? await getZonasDeSupervisor(await createSupabaseServer(), u.id) : [];
  return { u, actor: actorDesde(u, zonas) };
}

/** Marca el pago anulado con service_role (RLS: anular = solo admin). */
async function flipAnulado(pagoId: string, u: Usuario, motivo: string): Promise<boolean> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from("pagos")
    .update({
      anulado: true,
      anulado_por: u.id,
      anulado_en: new Date().toISOString(),
      motivo_anulacion: motivo,
    })
    .eq("id", pagoId)
    .eq("anulado", false) // idempotente: no re-anula uno ya anulado
    .select("id");
  return !error && (data?.length ?? 0) > 0;
}

// ── (admin) Anular directo ───────────────────────────────────────────────
export async function anularPagoDirectoAction(input: {
  pagoId: string;
  motivo: string;
}): Promise<Resultado> {
  const ctx = await actorYUsuario();
  if (!ctx) return { ok: false, error: "Sesión no válida." };
  if (!puedeAnularPagoDirecto(ctx.actor))
    return { ok: false, error: "Solo el administrador anula pagos directo." };
  const motivo = (input.motivo ?? "").trim();
  if (motivo.length < 3) return { ok: false, error: "Escribí el motivo de la anulación." };

  const db = await createSupabaseServer();
  const resumen = await getPagoResumen(db, input.pagoId);
  if (!resumen) return { ok: false, error: "No se encontró el pago." };
  if (resumen.anulado) return { ok: false, error: "Ese pago ya estaba anulado." };

  const ok = await flipAnulado(input.pagoId, ctx.u, motivo);
  if (!ok) return { ok: false, error: "No se pudo anular el pago." };

  await registrarAuditoria(db, {
    actorId: ctx.u.id,
    actorNombre: ctx.u.nombre,
    accion: "Anuló un pago (directo)",
    entidad: "pago",
    entidadId: input.pagoId,
    detalle: `${resumen.clienteNombre} · ${motivo}`,
  });
  revalidatePath(`/admin/clientes/${resumen.clienteId}`);
  return { ok: true };
}

// ── (supervisor) Solicitar anulación ─────────────────────────────────────
export async function solicitarAnulacionAction(input: {
  pagoId: string;
  motivo: string;
}): Promise<Resultado> {
  const ctx = await actorYUsuario();
  if (!ctx) return { ok: false, error: "Sesión no válida." };
  const motivo = (input.motivo ?? "").trim();
  if (motivo.length < 3) return { ok: false, error: "Escribí el motivo de la solicitud." };

  const db = await createSupabaseServer();
  const zona = await getZonaDePago(db, input.pagoId);
  if (!puedeSolicitarAnulacion(ctx.actor, zona))
    return { ok: false, error: "Solo podés pedir anular pagos de tu zona." };

  const resumen = await getPagoResumen(db, input.pagoId);
  if (!resumen) return { ok: false, error: "No se encontró el pago." };
  if (resumen.anulado) return { ok: false, error: "Ese pago ya estaba anulado." };
  if (await getSolicitudPendienteDePago(db, input.pagoId))
    return { ok: false, error: "Ya hay una solicitud pendiente para ese pago." };

  const { error } = await db.from("solicitudes_anulacion").insert({
    pago_id: input.pagoId,
    motivo,
    solicitado_por: ctx.u.id,
    solicitado_por_nombre: ctx.u.nombre,
  });
  if (error) return { ok: false, error: "No se pudo registrar la solicitud. ¿Corriste la migración 0032?" };

  await registrarAuditoria(db, {
    actorId: ctx.u.id,
    actorNombre: ctx.u.nombre,
    accion: "Solicitó anular un pago",
    entidad: "pago",
    entidadId: input.pagoId,
    detalle: `${resumen.clienteNombre} · ${motivo}`,
  });
  revalidatePath(`/admin/clientes/${resumen.clienteId}`);
  revalidatePath("/admin/anulaciones");
  return { ok: true };
}

// ── (2ª persona) Confirmar la anulación pedida ───────────────────────────
export async function confirmarAnulacionAction(input: { solicitudId: string }): Promise<Resultado> {
  const ctx = await actorYUsuario();
  if (!ctx) return { ok: false, error: "Sesión no válida." };

  const db = await createSupabaseServer();
  const sol = await getSolicitud(db, input.solicitudId);
  if (!sol) return { ok: false, error: "No se encontró la solicitud." };
  if (sol.estado !== "pendiente") return { ok: false, error: "Esa solicitud ya fue resuelta." };

  // Doble registro: la confirma OTRA persona gestora, no la que la pidió.
  if (!puedeConfirmarAnulacion(ctx.actor, sol.solicitadoPor ?? ""))
    return { ok: false, error: "La anulación la confirma otra persona, no quien la pidió." };

  const resumen = await getPagoResumen(db, sol.pagoId);
  if (!resumen) return { ok: false, error: "No se encontró el pago." };
  if (resumen.anulado) {
    // Ya estaba anulado: cerrar la solicitud igual.
    await db.from("solicitudes_anulacion").update({
      estado: "confirmada",
      resuelto_por: ctx.u.id,
      resuelto_por_nombre: ctx.u.nombre,
      resuelto_en: new Date().toISOString(),
    }).eq("id", sol.id);
    return { ok: false, error: "Ese pago ya estaba anulado." };
  }

  const ok = await flipAnulado(sol.pagoId, ctx.u, `${sol.motivo} (pidió ${sol.solicitadoPorNombre ?? "—"})`);
  if (!ok) return { ok: false, error: "No se pudo anular el pago." };

  await db.from("solicitudes_anulacion").update({
    estado: "confirmada",
    resuelto_por: ctx.u.id,
    resuelto_por_nombre: ctx.u.nombre,
    resuelto_en: new Date().toISOString(),
  }).eq("id", sol.id);

  await registrarAuditoria(db, {
    actorId: ctx.u.id,
    actorNombre: ctx.u.nombre,
    accion: "Confirmó una anulación (doble registro)",
    entidad: "pago",
    entidadId: sol.pagoId,
    detalle: `${resumen.clienteNombre} · pidió ${sol.solicitadoPorNombre ?? "—"}`,
  });
  revalidatePath(`/admin/clientes/${resumen.clienteId}`);
  revalidatePath("/admin/anulaciones");
  return { ok: true };
}

// ── (gestor) Rechazar / cancelar la solicitud ────────────────────────────
export async function rechazarAnulacionAction(input: {
  solicitudId: string;
  motivo?: string;
}): Promise<Resultado> {
  const ctx = await actorYUsuario();
  if (!ctx || (ctx.actor.rol !== "admin" && ctx.actor.rol !== "supervisor"))
    return { ok: false, error: "Solo un gestor puede rechazar." };

  const db = await createSupabaseServer();
  const sol = await getSolicitud(db, input.solicitudId);
  if (!sol) return { ok: false, error: "No se encontró la solicitud." };
  if (sol.estado !== "pendiente") return { ok: false, error: "Esa solicitud ya fue resuelta." };

  await db.from("solicitudes_anulacion").update({
    estado: "rechazada",
    resuelto_por: ctx.u.id,
    resuelto_por_nombre: ctx.u.nombre,
    resuelto_en: new Date().toISOString(),
    motivo_rechazo: (input.motivo ?? "").trim() || null,
  }).eq("id", sol.id);

  await registrarAuditoria(db, {
    actorId: ctx.u.id,
    actorNombre: ctx.u.nombre,
    accion: "Rechazó una solicitud de anulación",
    entidad: "pago",
    entidadId: sol.pagoId,
  });
  revalidatePath("/admin/anulaciones");
  return { ok: true };
}
