"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — ROTAR el token de acceso de un cliente (Fase 6, SOLO admin).
//  Si el link de un cliente se filtra, el admin genera uno nuevo: el anterior
//  deja de funcionar al instante. Queda auditado (quién y cuándo).
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { setTokenCliente } from "@/lib/data/clientes";
import { nuevoToken } from "@/lib/seguridad/token";
import { registrarAuditoria } from "@/lib/data/auditoria";

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function rotarTokenAction(
  clienteId: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol))
    return { ok: false, error: "Solo el administrador puede regenerar el link." };
  if (!ES_UUID.test(clienteId)) return { ok: false, error: "Cliente inválido." };

  try {
    const db = await createSupabaseServer();
    const token = nuevoToken();
    // service_role: desde 0126 el token del cliente está CONGELADO para los roles
    // de API (un gestor no puede reescribirlo por REST y suplantar la vista del
    // cliente). Esta acción —gateada a admin arriba— es la única vía de rotación.
    await setTokenCliente(createSupabaseAdmin(), clienteId, token);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Regeneró el link de acceso de un cliente",
      entidad: "cliente",
      entidadId: clienteId,
    });
    revalidatePath(`/admin/clientes/${clienteId}`);
    return { ok: true, token };
  } catch {
    return { ok: false, error: "No se pudo regenerar el link. Probá de nuevo." };
  }
}
