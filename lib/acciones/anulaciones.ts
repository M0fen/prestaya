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
  puedeVerZona,
} from "@/lib/permisos";
import {
  getZonaDePago,
  getPagoResumen,
  getSolicitud,
  getSolicitudPendienteDePago,
} from "@/lib/data/anulaciones";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
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

// ── (quien registró) Deshacer dentro de 1 hora ──────────────────────────────
//  Ventana de AUTO-CORRECCIÓN: quien registró el pago puede deshacerlo sin
//  aprobación mientras no pase 1 h. Nunca borra el libro: lo marca anulado (con
//  traza de quién/cuándo). Pasada la hora, hay que ir por la anulación normal.
const VENTANA_DESHACER_MS = 60 * 60 * 1000; // 1 hora

export async function deshacerPagoAction(input: { pagoId: string }): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return { ok: false, error: "Sesión no válida." };
  // Kill switch: deshacer muta el libro (baja pagado_acum) → congelar en un freeze.
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;

  // Traigo los datos de control con service_role (necesito registrado_por/_en,
  // que el RLS del cobrador no siempre deja leer de pagos de otros). La AUTORIZACIÓN
  // va ABAJO (solo quien lo registró) antes de cualquier escritura.
  const admin = createSupabaseAdmin();
  const { data: pago } = await admin
    .from("pagos")
    .select("id, registrado_por, registrado_en, anulado")
    .eq("id", input.pagoId)
    .maybeSingle();
  if (!pago) return { ok: false, error: "No se encontró el pago." };
  if (pago.anulado) return { ok: false, error: "Ese pago ya estaba anulado." };

  // Autorización: SOLO quien lo registró, y SOLO dentro de la ventana de 1 h.
  if (pago.registrado_por !== u.id)
    return { ok: false, error: "Solo quien registró el pago puede deshacerlo. Pedí una anulación." };
  const registradoEn = new Date(pago.registrado_en as string).getTime();
  if (!Number.isFinite(registradoEn) || Date.now() - registradoEn > VENTANA_DESHACER_MS)
    return { ok: false, error: "Pasó más de 1 hora: ya no se puede deshacer. Pedí una anulación." };

  const ok = await flipAnulado(input.pagoId, u, "Deshecho por quien lo registró (dentro de 1 h)");
  if (!ok) return { ok: false, error: "No se pudo deshacer el pago." };

  const db = await createSupabaseServer();
  const resumen = await getPagoResumen(db, input.pagoId);
  await registrarAuditoria(db, {
    actorId: u.id,
    actorNombre: u.nombre,
    accion: "Deshizo un pago (dentro de 1 h)",
    entidad: "pago",
    entidadId: input.pagoId,
    detalle: resumen ? `${resumen.clienteNombre}` : "",
  });
  if (resumen) revalidatePath(`/admin/clientes/${resumen.clienteId}`);
  revalidatePath("/cobrador");
  return { ok: true };
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
  const bloqueo = await bloqueoSoloLectura(); // kill switch: anular muta el libro
  if (bloqueo) return bloqueo;
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
  if (error) return { ok: false, error: "No se pudo registrar la solicitud. Probá de nuevo." };

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
  // Kill switch: confirmar la anulación muta el libro (baja pagado_acum) → congelar.
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;

  const db = await createSupabaseServer();
  const sol = await getSolicitud(db, input.solicitudId);
  if (!sol) return { ok: false, error: "No se encontró la solicitud." };
  if (sol.estado !== "pendiente") return { ok: false, error: "Esa solicitud ya fue resuelta." };

  // Doble registro: la confirma OTRA persona gestora, no la que la pidió.
  if (!puedeConfirmarAnulacion(ctx.actor, sol.solicitadoPor ?? ""))
    return { ok: false, error: "La anulación la confirma otra persona, no quien la pidió." };

  // Aislamiento de zona: además de ser otra persona, quien confirma debe tener
  // autoridad sobre la zona del pago (admin o supervisor de esa zona). Evita que
  // un supervisor confirme anulaciones de dinero de otra zona.
  const zonaPago = await getZonaDePago(db, sol.pagoId);
  const confirmadorAutorizado =
    ctx.actor.rol === "admin" || (ctx.actor.rol === "supervisor" && puedeVerZona(ctx.actor, zonaPago));
  if (!confirmadorAutorizado)
    return { ok: false, error: "Solo el admin o un supervisor de esa zona puede confirmar." };

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

  // Puede rechazar: el admin, quien la pidió (cancela la suya) o un supervisor
  // de la zona del pago. No un supervisor ajeno a esa zona.
  const zonaPago = await getZonaDePago(db, sol.pagoId);
  const puedeRechazar =
    ctx.actor.rol === "admin" ||
    sol.solicitadoPor === ctx.u.id ||
    (ctx.actor.rol === "supervisor" && puedeVerZona(ctx.actor, zonaPago));
  if (!puedeRechazar)
    return { ok: false, error: "Solo el admin, quien la pidió o un supervisor de esa zona puede rechazar." };

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
