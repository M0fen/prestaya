import "server-only";
// ─────────────────────────────────────────────────────────────────────────
//  AVISO PUSH a los gestores que tienen que ACTUAR (quejas del piloto 19-08).
//
//  El hueco: una solicitud de renovación/venta sobre el tope nacía MUDA — el
//  cobrador la pedía desde la calle y el supervisor solo se enteraba si abría
//  "Menú → Renovaciones" por su cuenta. Medido: 2 pedidos llevaban 1-2 días
//  esperando sin que nadie los viera ("el 20% no se deja" = nadie aprobó).
//
//  Destinatarios = los SUPERVISORES de la zona del cobrador + todos los ADMIN.
//  Best-effort (la solicitud ya está creada cuando esto corre): un push que
//  falla no rompe el pedido. Las suscripciones caducadas se borran.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { enviarPush, type PushPayload } from "@/lib/push/enviar";
import { borrarSuscripcionDb } from "@/lib/data/push";
import { reportarError } from "@/lib/observabilidad";

/**
 * Push a los gestores responsables de `cobradorId`: supervisores de su zona +
 * admins activos. Devuelve cuántos dispositivos recibieron el aviso.
 */
export async function avisarGestoresDeCobrador(
  cobradorId: string,
  payload: PushPayload,
): Promise<number> {
  try {
    const db = createSupabaseAdmin();
    const { data: cob } = await db.from("usuarios").select("zona_id").eq("id", cobradorId).maybeSingle();
    const zonaId = (cob?.zona_id as string | null) ?? null;

    // Admins activos siempre; supervisores SOLO los de la zona del cobrador.
    const { data: admins } = await db.from("usuarios").select("id").eq("rol", "admin").eq("activo", true);
    let supIds: string[] = [];
    if (zonaId) {
      const { data: sz } = await db.from("supervisor_zonas").select("supervisor_id").eq("zona_id", zonaId);
      supIds = (sz ?? []).map((r) => r.supervisor_id as string);
      if (supIds.length > 0) {
        const { data: activos } = await db.from("usuarios").select("id").in("id", supIds).eq("rol", "supervisor").eq("activo", true);
        supIds = (activos ?? []).map((r) => r.id as string);
      }
    }
    const ids = [...new Set([...(admins ?? []).map((a) => a.id as string), ...supIds])];
    if (ids.length === 0) return 0;

    const { data: subs, error } = await db
      .from("push_suscripciones")
      .select("usuario_id, endpoint, p256dh, auth")
      .in("usuario_id", ids);
    if (error) throw error;

    let ok = 0;
    for (const s of subs ?? []) {
      const r = await enviarPush(
        { endpoint: s.endpoint as string, p256dh: s.p256dh as string, auth: s.auth as string },
        payload,
      );
      if (r === "ok") ok++;
      else if (r === "gone") await borrarSuscripcionDb(db, s.endpoint as string).catch(() => {});
    }
    return ok;
  } catch (e) {
    reportarError("avisarGestoresDeCobrador", e, { cobradorId });
    return 0;
  }
}
