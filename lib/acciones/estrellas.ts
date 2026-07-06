"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — REDENCIONES de estrellas (lado admin). Solo gestores.
//  Aprobar/rechazar una solicitud del cliente. Queda en la auditoría.
//  (La SOLICITUD del cliente vive en app/c/[token]/actions.ts, validada por token.)
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { resolverRedencionDb } from "@/lib/data/estrellas";
import { registrarAuditoria } from "@/lib/data/auditoria";

type Resultado = { ok: true } | { ok: false; error: string };

async function resolver(id: string, estado: "aprobada" | "rechazada"): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!id) return { ok: false, error: "Redención inválida." };
  try {
    const db = await createSupabaseServer();
    await resolverRedencionDb(db, id, estado, u.id);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: estado === "aprobada" ? "Aprobó redención de estrellas" : "Rechazó redención de estrellas",
      entidad: "estrellas",
      entidadId: id,
    });
    revalidatePath("/admin/estrellas");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo procesar. ¿Corriste la migración 0020?" };
  }
}

export async function aprobarRedencion(id: string): Promise<Resultado> {
  return resolver(id, "aprobada");
}
export async function rechazarRedencion(id: string): Promise<Resultado> {
  return resolver(id, "rechazada");
}
