"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — RESTABLECER el acceso (contraseña) de un miembro del equipo.
//
//  Tapa el hueco de soporte del día 1: si un cobrador olvida su clave, no hay
//  forma dentro de la app de recuperarla. Ahora el admin (o el supervisor, para
//  los cobradores de SU zona) genera una nueva al instante y se la pasa.
//
//  Autorización (server-side, no confía en la UI):
//    · admin      → puede restablecer a cualquiera.
//    · supervisor → SOLO a cobradores dentro de su alcance de zona.
//  Genera una contraseña temporal, la fija en Supabase Auth y la DEVUELVE una
//  sola vez para mostrarla/compartirla. Queda auditado (quién a quién).
// ─────────────────────────────────────────────────────────────────────────
import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { alcanceDelActor, esGlobal } from "@/lib/data/alcance";
import { registrarAuditoria } from "@/lib/data/auditoria";

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Alfabeto SIN caracteres ambiguos (0/O, 1/l/I): se tipea una vez en el teléfono
// del cobrador, no queremos que confunda un cero con una O.
const ABC = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Contraseña temporal legible de 10 caracteres (cripto-aleatoria). */
function passwordTemporal(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += ABC[randomInt(ABC.length)];
  return s;
}

export async function restablecerAccesoAction(
  usuarioId: string,
): Promise<{ ok: true; password: string; nombre: string } | { ok: false; error: string }> {
  const actor = await getUsuarioActual();
  if (!actor || !actor.activo) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!ES_UUID.test(usuarioId)) return { ok: false, error: "Usuario inválido." };

  const admin = createSupabaseAdmin();

  // Traer al objetivo (por service_role: necesitamos su auth_user_id y rol).
  const { data: obj, error: e0 } = await admin
    .from("usuarios")
    .select("id, nombre, rol, activo, auth_user_id")
    .eq("id", usuarioId)
    .maybeSingle();
  if (e0 || !obj) return { ok: false, error: "No se encontró ese usuario." };

  // ── Autorización (server-side, SOLO gestores; no confía en la UI) ─────────
  if (!esAdmin(actor.rol)) {
    // Gate de ROL explícito: un COBRADOR también es "no admin", y su
    // alcanceDelActor() incluye a los cobradores de su misma zona → sin este corte
    // podría resetearle la clave a un compañero (toma de cuenta). Solo el SUPERVISOR
    // llega a la rama de zona; cualquier otro rol se rechaza de plano.
    if (actor.rol !== "supervisor")
      return { ok: false, error: "No tenés permiso para restablecer accesos." };
    // Supervisor: solo COBRADORES de su alcance de zona.
    if (obj.rol !== "cobrador")
      return { ok: false, error: "Solo el administrador puede restablecer accesos de gestores." };
    const alcance = await alcanceDelActor();
    const enZona = esGlobal(alcance) || alcance.cobradorIds.includes(obj.id as string);
    if (!enZona) return { ok: false, error: "Ese cobrador no es de tu zona." };
  }

  if (!obj.auth_user_id)
    return { ok: false, error: "Ese usuario no tiene un login asociado." };

  // Fijar la nueva contraseña en Supabase Auth.
  const password = passwordTemporal();
  const { error: e1 } = await admin.auth.admin.updateUserById(obj.auth_user_id as string, {
    password,
  });
  if (e1) return { ok: false, error: "No se pudo restablecer el acceso. Probá de nuevo." };

  // Auditar (sin registrar la contraseña, claro).
  try {
    const db = await createSupabaseServer();
    await registrarAuditoria(db, {
      actorId: actor.id,
      actorNombre: actor.nombre,
      accion: "Restableció el acceso de un usuario",
      entidad: "usuario",
      entidadId: obj.id as string,
      detalle: `${obj.nombre} · ${obj.rol}`,
    });
  } catch {
    /* la auditoría no debe tumbar el reset ya aplicado */
  }

  revalidatePath("/admin/equipo");
  return { ok: true, password, nombre: obj.nombre as string };
}
