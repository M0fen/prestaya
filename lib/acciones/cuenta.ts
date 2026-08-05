"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — MI CUENTA: cambiar la contraseña propia (onboarding día 1).
//  Todo el equipo entra con una clave provisoria compartida; esta acción la
//  reemplaza por una propia. Corre con service_role (updateUserById) tras
//  validar la SESIÓN — el navegador nunca toca la API de auth de admin.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/data/auditoria";

type Resultado = { ok: true } | { ok: false; error: string };

// La clave provisoria del piloto: la nueva NO puede ser la misma.
const PROVISORIA = "PrestaYa2026!";

export async function cambiarMiClave(input: { nueva: string }): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!u.auth_user_id) return { ok: false, error: "Tu cuenta no tiene acceso configurado. Avisá a la oficina." };

  const nueva = String(input.nueva ?? "");
  if (nueva.length < 8)
    return { ok: false, error: "La clave tiene que tener al menos 8 caracteres." };
  if (nueva === PROVISORIA)
    return { ok: false, error: "Esa es la clave provisoria: elegí una tuya, distinta." };
  // Anti-obviedades mínimas (sin ponernos pesados: es gente en la calle).
  if (/^(.)\1+$/.test(nueva) || nueva === "12345678" || nueva.toLowerCase() === "password")
    return { ok: false, error: "Muy fácil de adivinar. Probá con otra." };

  const admin = createSupabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(u.auth_user_id, { password: nueva });
  if (error) return { ok: false, error: "No se pudo cambiar la clave. Probá de nuevo." };

  // Sella el onboarding (la tarjeta de arranque deja de insistir).
  await admin
    .from("usuarios")
    .update({ clave_cambiada_en: new Date().toISOString() })
    .eq("id", u.id);

  // Auditable SIN datos sensibles (jamás la clave).
  const db = await createSupabaseServer();
  await registrarAuditoria(db, {
    actorId: u.id,
    actorNombre: u.nombre,
    accion: "Cambió su contraseña",
    entidad: "usuario",
    entidadId: u.id,
    detalle: "Onboarding día 1: reemplazó la clave provisoria",
  }).catch(() => {});

  return { ok: true };
}
