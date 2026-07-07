// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ASIGNACIONES (cobrador ↔ cliente).
//  Un cliente tiene UN cobrador activo (índice único). De ahí se DERIVA su
//  zona. Reasignar = bajar la activa y subir la nueva (respetando el índice).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CobradorDeCliente {
  cobradorId: string;
  cobradorNombre: string;
  zonaId: string | null;
}

/** Cobrador ACTIVO de un cliente (con su zona), o null si no tiene. */
export async function getCobradorDeCliente(
  db: SupabaseClient,
  clienteId: string,
): Promise<CobradorDeCliente | null> {
  const { data, error } = await db
    .from("asignaciones")
    .select("cobrador_id, usuarios(nombre, zona_id)")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .maybeSingle();
  if (error || !data) return null;
  const d = data as {
    cobrador_id: string;
    usuarios?: { nombre?: string; zona_id?: string | null } | { nombre?: string; zona_id?: string | null }[];
  };
  const u = Array.isArray(d.usuarios) ? d.usuarios[0] : d.usuarios;
  return {
    cobradorId: d.cobrador_id,
    cobradorNombre: u?.nombre ?? "—",
    zonaId: u?.zona_id ?? null,
  };
}

/**
 * Reasigna un cliente a un nuevo cobrador: baja la asignación activa actual y
 * activa la del nuevo (respeta el índice "un cobrador activo por cliente").
 */
export async function reasignarCliente(
  db: SupabaseClient,
  clienteId: string,
  nuevoCobradorId: string,
): Promise<void> {
  // 1) Bajar la(s) activa(s) del cliente.
  const off = await db
    .from("asignaciones")
    .update({ activo: false })
    .eq("cliente_id", clienteId)
    .eq("activo", true);
  if (off.error) throw off.error;

  // 2) Activar la del nuevo cobrador (upsert: puede haber una vieja inactiva).
  const on = await db
    .from("asignaciones")
    .upsert(
      { cobrador_id: nuevoCobradorId, cliente_id: clienteId, activo: true },
      { onConflict: "cobrador_id,cliente_id" },
    );
  if (on.error) throw on.error;
}
