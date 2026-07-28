"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — ALTA de usuarios (SOLO admin). Crea el login (Supabase Auth)
//  y el usuario del sistema, vinculados. El rol "desarrollador" se guarda como
//  admin + es_dev (poder total + herramientas de diagnóstico). Auditado.
//  Si falla el insert, se hace rollback del login para no dejar huérfanos.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { reportarError } from "@/lib/observabilidad";

const schema = z.object({
  nombre: z.string().trim().min(2).max(80),
  email: z.email(),
  password: z.string().min(8).max(72),
  rol: z.enum(["admin", "supervisor", "cobrador", "desarrollador"]),
  zonaId: z.uuid().nullish(),
  comisionPct: z.number().min(0).max(100).nullish(),
});

export async function crearUsuarioAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await getUsuarioActual();
  if (!actor || !actor.activo || !esAdmin(actor.rol))
    return { ok: false, error: "Solo el administrador puede crear usuarios." };

  const v = schema.safeParse(input);
  if (!v.success)
    return { ok: false, error: "Revisá los datos: email válido y contraseña de 8+ caracteres." };
  const d = v.data;

  const rolReal = d.rol === "desarrollador" ? "admin" : d.rol;
  const marcaDev = d.rol === "desarrollador";
  const zona = rolReal === "cobrador" ? d.zonaId ?? null : null;
  const comision = rolReal === "cobrador" ? Math.round(d.comisionPct ?? 0) : 0;

  const admin = createSupabaseAdmin();
  // 1) Crear el login. email_confirm: true → puede entrar sin confirmar mail.
  const { data: created, error: e1 } = await admin.auth.admin.createUser({
    email: d.email.trim().toLowerCase(),
    password: d.password,
    email_confirm: true,
  });
  if (e1 || !created?.user) {
    const dup = /already|registered|exists/i.test(e1?.message ?? "");
    return { ok: false, error: dup ? "Ese email ya tiene una cuenta." : "No se pudo crear el login." };
  }

  // 2) Insertar el usuario del sistema, vinculado al login.
  //    es_dev solo se envía si corresponde (así funciona aun sin la 0034).
  const fila: Record<string, unknown> = {
    nombre: d.nombre,
    rol: rolReal,
    activo: true,
    auth_user_id: created.user.id,
    zona_id: zona,
    comision_pct: comision,
  };
  if (marcaDev) fila.es_dev = true;

  const { error: e2 } = await admin.from("usuarios").insert(fila);
  if (e2) {
    // Rollback: borrar el login recién creado para no dejar un auth huérfano.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    if (/es_dev/.test(e2.message))
      return { ok: false, error: "No se pudo crear el desarrollador. Avisá a soporte." };
    return { ok: false, error: "No se pudo guardar el usuario." };
  }

  const db = await createSupabaseServer();
  await registrarAuditoria(db, {
    actorId: actor.id,
    actorNombre: actor.nombre,
    accion: "Creó un usuario",
    entidad: "usuario",
    entidadId: created.user.id,
    detalle: `${d.nombre} · ${marcaDev ? "desarrollador" : rolReal}`,
  });
  revalidatePath("/admin/equipo");
  return { ok: true };
}

/**
 * ACTIVAR / DAR DE BAJA a un usuario (SOLO admin). Offboarding: `activo=false`
 * corta TODO acceso a la app (requireUsuario y getUsuarioActual rechazan a los
 * inactivos) y ADEMÁS se banea el login en Supabase Auth (invalida sus sesiones y
 * le impide volver a entrar con su clave). Reversible: reactivar quita el baneo.
 * Guardas: no podés darte de baja a vos mismo (evita el auto-lockout).
 */
export async function setUsuarioActivo(
  input: { usuarioId: string; activo: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await getUsuarioActual();
  if (!actor || !actor.activo || !esAdmin(actor.rol))
    return { ok: false, error: "Solo el administrador puede activar o dar de baja usuarios." };
  if (input.usuarioId === actor.id)
    return { ok: false, error: "No podés cambiar tu propio estado (evita quedar sin acceso)." };

  try {
    const admin = createSupabaseAdmin();
    // Traer el usuario (nombre + su login de auth) antes de tocar nada.
    const { data: u, error: eSel } = await admin
      .from("usuarios")
      .select("id, nombre, rol, auth_user_id")
      .eq("id", input.usuarioId)
      .maybeSingle();
    if (eSel || !u) return { ok: false, error: "No se encontró el usuario." };

    // 1) Estado en la app (fuente de verdad del acceso: lo checan requireUsuario /
    //    getUsuarioActual). Es lo que efectivamente bloquea/permite todo.
    const { error: eUpd } = await admin.from("usuarios").update({ activo: input.activo }).eq("id", input.usuarioId);
    if (eUpd) return { ok: false, error: "No se pudo cambiar el estado del usuario." };

    // 2) Login en Supabase Auth: banear al dar de baja (invalida sesiones + impide
    //    reingreso), quitar el baneo al reactivar. Best-effort: si falla, el paso 1 ya
    //    bloquea la app; se deja rastro para revisarlo, no se revierte el estado.
    const authId = (u as { auth_user_id: string | null }).auth_user_id;
    if (authId) {
      const { error: eBan } = await admin.auth.admin.updateUserById(authId, {
        ban_duration: input.activo ? "none" : "876000h", // ~100 años = baja efectiva
      });
      if (eBan) reportarError("setUsuarioActivo.ban", eBan, { usuarioId: input.usuarioId, activo: input.activo });
    }

    const db = await createSupabaseServer();
    await registrarAuditoria(db, {
      actorId: actor.id,
      actorNombre: actor.nombre,
      accion: input.activo ? "Reactivó a un usuario" : "Dio de baja a un usuario",
      entidad: "usuario",
      entidadId: input.usuarioId,
      detalle: `${(u as { nombre: string }).nombre} · ${(u as { rol: string }).rol}`,
    });
    revalidatePath("/admin/equipo");
    return { ok: true };
  } catch (e) {
    reportarError("setUsuarioActivo", e, { usuarioId: input.usuarioId });
    return { ok: false, error: "No se pudo cambiar el estado. Probá de nuevo." };
  }
}
