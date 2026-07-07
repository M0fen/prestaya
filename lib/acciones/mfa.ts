"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Recuperación de 2FA (Fase 5): el OTRO admin le quita el factor a un usuario
//  que perdió el teléfono. Solo admin. Usa service_role (auth.admin). Auditado.
//  Respaldo si no hay otro admin disponible: el panel de Supabase.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/data/auditoria";

export async function resetear2FA(
  usuarioId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await getUsuarioActual();
  if (!actor || !actor.activo || !esAdmin(actor.rol))
    return { ok: false, error: "Solo el administrador puede resetear el 2FA." };

  try {
    const admin = createSupabaseAdmin();
    // Buscar el login (auth) del usuario objetivo.
    const { data: fila } = await admin
      .from("usuarios")
      .select("auth_user_id, nombre")
      .eq("id", usuarioId)
      .maybeSingle();
    const authId = (fila as { auth_user_id?: string | null } | null)?.auth_user_id;
    if (!authId) return { ok: false, error: "Ese usuario no tiene login asociado." };

    // Listar y borrar sus factores MFA.
    const { data: lista, error: e1 } = await admin.auth.admin.mfa.listFactors({ userId: authId });
    if (e1) return { ok: false, error: "No se pudo leer el 2FA del usuario." };
    const factores = (lista as { factors?: { id: string }[] } | null)?.factors ?? [];
    for (const f of factores) {
      await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: authId });
    }

    const db = await createSupabaseServer();
    await registrarAuditoria(db, {
      actorId: actor.id,
      actorNombre: actor.nombre,
      accion: "Reseteó el 2FA de un usuario",
      entidad: "usuario",
      entidadId: usuarioId,
      detalle: (fila as { nombre?: string } | null)?.nombre ?? undefined,
    });
    revalidatePath("/admin/seguridad");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo resetear el 2FA." };
  }
}
