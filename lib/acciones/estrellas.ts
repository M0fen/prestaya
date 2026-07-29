"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — REDENCIONES de estrellas (lado admin). Solo gestores.
//  Aprobar/rechazar una solicitud del cliente. Queda en la auditoría.
//  (La SOLICITUD del cliente vive en app/c/[token]/actions.ts, validada por token.)
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { resolverRedencionDb, getSaldoEstrellas, redimirDirectoDb, marcarEntregadaDb } from "@/lib/data/estrellas";
import { getPrestamosActivosPorCliente } from "@/lib/data/prestamos";
import { getAjustesJuego } from "@/lib/data/juegoConfig";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { validarRedencion, claveCiclo, type SaldoEstrellas } from "@/lib/estrellas";
import { cicloUY } from "@/lib/fecha";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Ciclo de tope de estrellas del cliente, igual que la vista de cliente y la
 *  ficha: respeta la config (mensual vs por-crédito) para que el cupo coincida. */
async function cicloDeCliente(db: SupabaseClient, clienteId: string): Promise<string> {
  const [ajustes, activos] = await Promise.all([
    getAjustesJuego(db),
    getPrestamosActivosPorCliente(db, clienteId),
  ]);
  return claveCiclo(ajustes.estrellasCiclo, { cicloMes: cicloUY(), prestamoId: activos[0]?.id ?? null });
}

type Resultado = { ok: true } | { ok: false; error: string };

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolver(id: string, estado: "aprobada" | "rechazada"): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!id) return { ok: false, error: "Redención inválida." };
  try {
    const db = await createSupabaseServer();
    // Re-validar el SALDO DERIVADO al momento de APROBAR: el saldo sale de los pagos NO
    // anulados y pudo ENCOGER entre la solicitud y ahora (anulaciones). Si ganadas cayó
    // por debajo de lo ya redimido + esta redención, NO se aprueba (si no, el cliente
    // canjearía más de lo ganado). Invariante global: redimidas + n <= ganadas.
    if (estado === "aprobada") {
      const { data: red } = await db
        .from("estrellas_redenciones")
        .select("cliente_id, estrellas, ciclo, estado")
        .eq("id", id)
        .maybeSingle();
      if (red && red.estado === "pendiente") {
        const saldo = await getSaldoEstrellas(db, red.cliente_id as string, red.ciclo as string);
        if (saldo.estrellasRedimidas + Number(red.estrellas) > saldo.estrellasGanadas) {
          return { ok: false, error: "El cliente ya no tiene saldo para este canje (se anularon pagos). Rechazalo o aprobá uno menor." };
        }
      }
    }
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
    return { ok: false, error: "No se pudo procesar. Probá de nuevo." };
  }
}

export async function aprobarRedencion(id: string): Promise<Resultado> {
  return resolver(id, "aprobada");
}
export async function rechazarRedencion(id: string): Promise<Resultado> {
  return resolver(id, "rechazada");
}

/** Marca una redención APROBADA como ENTREGADA (el cliente recibió el premio). 0104. */
export async function marcarEntregada(id: string): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!ES_UUID.test(id)) return { ok: false, error: "Redención inválida." };
  try {
    const db = await createSupabaseServer();
    await marcarEntregadaDb(db, id, u.id);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Marcó entregado un premio de estrellas",
      entidad: "estrellas",
      entidadId: id,
    });
    revalidatePath("/admin/estrellas");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo marcar. Probá de nuevo." };
  }
}

/** Saldo de estrellas de un cliente (para el panel de redención directa del admin). */
export async function saldoEstrellasCliente(
  clienteId: string,
): Promise<{ ok: true; saldo: SaldoEstrellas; nombre: string } | { ok: false; error: string }> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!ES_UUID.test(clienteId)) return { ok: false, error: "Cliente inválido." };
  try {
    const db = await createSupabaseServer();
    const saldo = await getSaldoEstrellas(db, clienteId, await cicloDeCliente(db, clienteId));
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
  /** Qué premio se entregó (opcional, 0104). Queda en el registro. */
  premioTexto?: string | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!ES_UUID.test(input.clienteId)) return { ok: false, error: "Cliente inválido." };
  const n = Math.round(input.estrellas);
  const premioTexto = (input.premioTexto ?? "").trim().slice(0, 120) || null;
  try {
    const db = await createSupabaseServer();
    const ciclo = await cicloDeCliente(db, input.clienteId);
    // Verdad del servidor: recalcula el saldo y valida ANTES de escribir.
    const saldo = await getSaldoEstrellas(db, input.clienteId, ciclo);
    const v = validarRedencion(saldo, n);
    if (!v.ok) return v;
    await redimirDirectoDb(createSupabaseAdmin(), {
      clienteId: input.clienteId,
      estrellas: n,
      ciclo,
      resueltoPor: u.id,
      premioTexto,
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
    return { ok: false, error: "No se pudo redimir. Probá de nuevo." };
  }
}
