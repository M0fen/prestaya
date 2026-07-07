// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — suscripciones de PUSH (0026).
//  Guardado/borrado corren como el usuario (RLS: solo las suyas). La lectura
//  para ENVIAR corre con service_role (ve las de todos). Degrada si falta 0026.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "./errores";

export interface SuscripcionRow {
  usuarioId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function guardarSuscripcionDb(
  db: SupabaseClient,
  usuarioId: string,
  sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null },
): Promise<void> {
  const { error } = await db.from("push_suscripciones").upsert(
    {
      usuario_id: usuarioId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      user_agent: sub.userAgent ?? null,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

export async function borrarSuscripcionDb(db: SupabaseClient, endpoint: string): Promise<void> {
  const { error } = await db.from("push_suscripciones").delete().eq("endpoint", endpoint);
  if (error) throw error;
}

/** Suscripciones de todos los usuarios activos con alguno de esos roles. */
export async function getSuscripcionesDeRoles(
  db: SupabaseClient,
  roles: string[],
): Promise<SuscripcionRow[]> {
  try {
    const { data: us, error: e1 } = await db
      .from("usuarios")
      .select("id")
      .in("rol", roles)
      .eq("activo", true);
    if (e1) throw e1;
    const ids = (us ?? []).map((u) => u.id as string);
    if (ids.length === 0) return [];

    const { data, error } = await db
      .from("push_suscripciones")
      .select("usuario_id, endpoint, p256dh, auth")
      .in("usuario_id", ids);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      usuarioId: r.usuario_id as string,
      endpoint: r.endpoint as string,
      p256dh: r.p256dh as string,
      auth: r.auth as string,
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}
