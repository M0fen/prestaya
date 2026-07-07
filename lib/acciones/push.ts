"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — activar/desactivar avisos push en ESTE dispositivo.
//  Guarda/borra la PushSubscription del usuario logueado (RLS: solo la suya).
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import { guardarSuscripcionDb, borrarSuscripcionDb } from "@/lib/data/push";

type Resultado = { ok: true } | { ok: false; error: string };

export async function guardarSuscripcion(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return { ok: false, error: "Sesión inválida." };
  if (!sub?.endpoint || !sub?.p256dh || !sub?.auth)
    return { ok: false, error: "Suscripción incompleta." };
  try {
    const db = await createSupabaseServer();
    await guardarSuscripcionDb(db, u.id, sub);
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo activar. ¿Corriste la migración 0026?" };
  }
}

export async function borrarSuscripcion(endpoint: string): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u) return { ok: false, error: "Sesión inválida." };
  try {
    const db = await createSupabaseServer();
    await borrarSuscripcionDb(db, endpoint);
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo desactivar." };
  }
}
