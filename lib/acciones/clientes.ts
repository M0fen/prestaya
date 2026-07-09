"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — marcar/desmarcar un cliente como REPORTADO (buró/mora).
//  SOLO ADMIN. Escribe clientes.reportado y deja registro en auditoría.
//  (El flag `reportado` es un atributo del cliente, NO la tabla `reportes`
//   de quejas del cliente vía token — no confundir.)
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin, esGestor } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { subirFotoCliente } from "@/lib/data/fotos";
import { alcanceDelActor } from "@/lib/data/alcance";

type Resultado = { ok: true; reportado: boolean } | { ok: false; error: string };

export async function marcarClienteReportado(input: {
  clienteId: string;
  reportado: boolean;
}): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || !esAdmin(usuario.rol)) {
    return { ok: false, error: "Solo el administrador puede reportar clientes." };
  }
  if (!input.clienteId) return { ok: false, error: "Cliente inválido." };

  try {
    const db = await createSupabaseServer();
    const { error } = await db
      .from("clientes")
      .update({ reportado: input.reportado })
      .eq("id", input.clienteId);
    if (error) throw error;
    await registrarAuditoria(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      accion: input.reportado ? "Marcó cliente como reportado" : "Quitó reporte del cliente",
      entidad: "cliente",
      entidadId: input.clienteId,
    });
    revalidatePath(`/admin/clientes/${input.clienteId}`);
    revalidatePath("/admin/clientes");
    return { ok: true, reportado: input.reportado };
  } catch {
    return { ok: false, error: "No se pudo actualizar. ¿Corriste la migración 0041?" };
  }
}

// ── Subir/actualizar la FOTO de un cliente (gestor) ────────────────────────
// La imagen viene YA comprimida del navegador (data URL). Se guarda en Storage
// (service_role) y queda la ruta en clientes.foto_path. Gestores (admin/supervisor
// de su zona); el RLS del cliente igual acota, pero la subida va por service_role,
// así que validamos el rol acá.
export async function guardarFotoCliente(input: {
  clienteId: string;
  dataUrl: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || !esGestor(usuario.rol)) {
    return { ok: false, error: "No tenés permisos para cargar la foto." };
  }
  if (!input.clienteId) return { ok: false, error: "Cliente inválido." };
  // Recorte por zona: la subida va por service_role (salta RLS), así que acá
  // verificamos que el cliente sea de la zona del gestor (un supervisor no puede
  // tocar la foto de un cliente de otra zona). El admin ve todo.
  const alcance = await alcanceDelActor();
  if (!alcance.global && !alcance.clienteIds.includes(input.clienteId)) {
    return { ok: false, error: "Ese cliente no es de tu zona." };
  }
  const res = await subirFotoCliente(input.clienteId, input.dataUrl);
  if (!res.ok) return { ok: false, error: res.error };
  try {
    const db = await createSupabaseServer();
    await registrarAuditoria(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      accion: "Cargó/actualizó la foto del cliente",
      entidad: "cliente",
      entidadId: input.clienteId,
    });
  } catch {
    /* la auditoría es best-effort: la foto ya se guardó */
  }
  revalidatePath(`/admin/clientes/${input.clienteId}`);
  return { ok: true };
}
