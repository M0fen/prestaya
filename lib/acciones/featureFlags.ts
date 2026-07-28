"use server";
// Toggle del KILL SWITCH "modo solo lectura" (0072). Solo el ADMIN. Congela/
// descongela las escrituras de plata al instante, SIN redeploy. Útil si la
// reconciliación detecta corrupción: se frena todo mientras se investiga.
import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { reportarError } from "@/lib/observabilidad";

export async function setModoSoloLectura(
  activo: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || u.rol !== "admin") {
    return { ok: false, error: "Solo el administrador puede cambiar el modo del sistema." };
  }
  try {
    const db = createSupabaseAdmin();
    const { error } = await db
      .from("feature_flags")
      .upsert(
        {
          clave: "modo_solo_lectura",
          activo,
          actualizado_en: new Date().toISOString(),
          actualizado_por: u.id,
        },
        { onConflict: "clave" },
      );
    if (error) throw error;
    // La palanca MÁS grave del sistema (congela toda la plata) debe quedar en el
    // rastro: quién la activó/desactivó y cuándo. Antes era invisible en /admin/auditoria.
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: activo ? "Activó el modo solo-lectura (congeló la plata)" : "Desactivó el modo solo-lectura (reanudó la operación)",
      entidad: "feature_flag",
      entidadId: "modo_solo_lectura",
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    reportarError("setModoSoloLectura", e, { activo });
    return { ok: false, error: "No se pudo cambiar el modo. Probá de nuevo." };
  }
}
