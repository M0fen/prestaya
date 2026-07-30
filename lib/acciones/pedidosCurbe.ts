"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Acciones de la COLA DE DESPACHO a Curbe (0112). Solo el admin (la tienda es
//  del dueño). Es logística: no toca dinero. El admin avanza el estado del pedido
//  a medida que le avisa a Curbe y Curbe despacha.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { esUuid } from "@/lib/idempotencia";
import { actualizarPedidoCurbeDb, type EstadoPedidoCurbe } from "@/lib/data/pedidosCurbe";

type Resultado = { ok: true } | { ok: false; error: string };

const ESTADOS: EstadoPedidoCurbe[] = ["pendiente", "pedido", "despachado", "cancelado"];

/** Mueve un pedido de despacho de estado. Solo admin. */
export async function actualizarPedidoCurbe(input: {
  id: string;
  estado: EstadoPedidoCurbe;
  nota?: string | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !esAdmin(u.rol)) return { ok: false, error: "Solo el administrador gestiona los pedidos a Curbe." };
  if (!esUuid(input.id)) return { ok: false, error: "Pedido inválido." };
  if (!ESTADOS.includes(input.estado)) return { ok: false, error: "Estado inválido." };

  try {
    const admin = createSupabaseAdmin();
    const nota = input.nota != null ? String(input.nota).trim().slice(0, 300) || null : undefined;
    await actualizarPedidoCurbeDb(admin, input.id, input.estado, u.id, nota);
    await registrarAuditoria(admin, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Actualizó pedido a Curbe",
      entidad: "producto",
      entidadId: input.id,
      detalle: `Pedido de despacho → ${input.estado}`,
    });
    revalidatePath("/admin/tienda");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo actualizar el pedido. Probá de nuevo." };
  }
}
