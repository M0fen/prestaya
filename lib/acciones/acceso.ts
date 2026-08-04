"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — ENTREGA DEL LINK DE ACCESO (alta del cliente en la app).
//  La dispara el cobrador al compartir el QR / mandar el WhatsApp.
//
//  Seguridad: se VERIFICA con el cliente RLS que ese cliente es de quien lo
//  pide (un cobrador solo ve los suyos); recién ahí se escribe con
//  service_role, porque el cobrador no tiene UPDATE sobre `clientes` (0031).
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import { getClientePorId } from "@/lib/data/clientes";
import { marcarAccesoEntregado, marcarAppNoAplica } from "@/lib/data/acceso";
import { registrarBitacora } from "@/lib/data/bitacora";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Motivos que ofrece la app. Texto libre acotado para cualquier otro caso. */
export const MOTIVOS_NO_APP = [
  "No tiene celular",
  "Tiene teléfono fijo",
  "No quiere usarla",
  "Lo ve un familiar",
] as const;

export async function marcarAccesoEntregadoAction(
  clienteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!ES_UUID.test(clienteId)) return { ok: false, error: "Cliente inválido." };

  try {
    const db = await createSupabaseServer();
    // RLS: si el cliente no es suyo, no lo ve → no puede marcar nada.
    const cliente = await getClientePorId(db, clienteId);
    if (!cliente) return { ok: false, error: "Ese cliente no está en tu ruta." };

    await marcarAccesoEntregado(clienteId, u.id);
    revalidatePath(`/cobrador/cliente/${clienteId}/acceso`);
    revalidatePath(`/cobrador/cliente/${clienteId}`);
    revalidatePath("/cobrador/altas");
    return { ok: true };
  } catch {
    // No es plata: si falla el registro, el link YA se compartió igual.
    return { ok: false, error: "No se pudo registrar la entrega." };
  }
}

/**
 * "Este cliente NO va a usar la app" (0131). Lo saca de los pendientes de la
 * campaña sin darlo de baja: sigue en la ruta y se le cobra igual.
 *
 * Reversible: `activar=false` lo devuelve a pendiente. Queda en la bitácora
 * quién lo marcó, porque es la explicación de por qué un cliente nunca va a
 * aparecer como "activo" en el avance del cobrador.
 */
export async function marcarAppNoAplicaAction(input: {
  clienteId: string;
  motivo?: string | null;
  activar?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!ES_UUID.test(input.clienteId)) return { ok: false, error: "Cliente inválido." };
  const activar = input.activar !== false;
  const motivo = (input.motivo ?? "").trim().slice(0, 60) || null;

  try {
    const db = await createSupabaseServer();
    const cliente = await getClientePorId(db, input.clienteId);
    if (!cliente) return { ok: false, error: "Ese cliente no está en tu ruta." };

    await marcarAppNoAplica(input.clienteId, activar ? u.id : null, activar ? motivo : null);
    await registrarBitacora(createSupabaseAdmin(), {
      actorId: u.id,
      actorNombre: u.nombre,
      rol: u.rol,
      accion: "alta_app",
      clienteId: input.clienteId,
      detalle: activar ? `No usa la app${motivo ? `: ${motivo}` : ""}` : "Vuelve a contar para el alta",
      gpsLat: null,
      gpsLng: null,
      gpsDenegado: true,
    });
    revalidatePath(`/cobrador/cliente/${input.clienteId}/acceso`);
    revalidatePath("/cobrador/altas");
    revalidatePath("/admin/altas");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
}
