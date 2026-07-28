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
