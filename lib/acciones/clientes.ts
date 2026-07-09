"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — marcar/desmarcar un cliente como REPORTADO (buró/mora).
//  SOLO ADMIN. Escribe clientes.reportado y deja registro en auditoría.
//  (El flag `reportado` es un atributo del cliente, NO la tabla `reportes`
//   de quejas del cliente vía token — no confundir.)
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/data/auditoria";

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
