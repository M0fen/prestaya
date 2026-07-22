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
import { marcarAccesoEntregado } from "@/lib/data/acceso";

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
