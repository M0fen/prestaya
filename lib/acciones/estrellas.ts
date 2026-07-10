"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — REDENCIONES de estrellas (lado admin). Solo gestores.
//  Aprobar/rechazar una solicitud del cliente. Queda en la auditoría.
//  (La SOLICITUD del cliente vive en app/c/[token]/actions.ts, validada por token.)
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { resolverRedencionDb, getSaldoEstrellas, redimirDirectoDb } from "@/lib/data/estrellas";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { validarRedencion, type SaldoEstrellas } from "@/lib/estrellas";
import { cicloUY } from "@/lib/fecha";

type Resultado = { ok: true } | { ok: false; error: string };

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Saldo de estrellas de un cliente (para el panel de redención directa del admin). */
export async function saldoEstrellasCliente(
  clienteId: string,
): Promise<{ ok: true; saldo: SaldoEstrellas; nombre: string } | { ok: false; error: string }> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!ES_UUID.test(clienteId)) return { ok: false, error: "Cliente inválido." };
  try {
    const db = await createSupabaseServer();
    const saldo = await getSaldoEstrellas(db, clienteId, cicloUY());
    const { data: c } = await db.from("clientes").select("nombre").eq("id", clienteId).maybeSingle();
    return { ok: true, saldo, nombre: (c?.nombre as string) ?? "Cliente" };
  } catch {
    return { ok: false, error: "No se pudo leer el saldo." };
  }
}

/**
 * Canje DIRECTO del admin: redime `estrellas` de un cliente en persona (queda
 * aprobado al instante, con auditoría). Valida saldo y tope de ciclo en el
 * servidor. El INSERT va con service_role (RLS no tiene policy de insert), pero
 * la acción está gateada a gestor + validada.
 */
export async function redimirEstrellasAdmin(input: {
  clienteId: string;
  estrellas: number;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!ES_UUID.test(input.clienteId)) return { ok: false, error: "Cliente inválido." };
  const n = Math.round(input.estrellas);
  try {
    const db = await createSupabaseServer();
    const ciclo = cicloUY();
    // Verdad del servidor: recalcula el saldo y valida ANTES de escribir.
    const saldo = await getSaldoEstrellas(db, input.clienteId, ciclo);
    const v = validarRedencion(saldo, n);
    if (!v.ok) return v;
    await redimirDirectoDb(createSupabaseAdmin(), {
      clienteId: input.clienteId,
      estrellas: n,
      ciclo,
      resueltoPor: u.id,
    });
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: `Canjeó ${n} estrella(s) (directo)`,
      entidad: "estrellas",
      entidadId: input.clienteId,
    });
    revalidatePath("/admin/estrellas");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo redimir. ¿Corriste la migración 0020?" };
  }
}
