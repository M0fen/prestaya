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
  // Desde 0038 un cliente puede tener VARIOS cobradores activos (créditos de
  // distintos cobradores). Devolvemos el más reciente (no usar maybeSingle: con
  // múltiples activos rompería). El detalle por crédito lo maneja cada superficie.
  const { data: filas, error } = await db
    .from("asignaciones")
    .select("cobrador_id, usuarios(nombre, zona_id)")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .order("asignado_en", { ascending: false })
    .limit(1);
  const data = filas && filas.length > 0 ? filas[0] : null;
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
 * COMPENSACIÓN: baja una asignación activa cliente↔cobrador recién creada cuando la
 * operación que la motivó (p. ej. una venta de tienda) falló. Evita dejar al cliente
 * en la ruta de un cobrador sin crédito. NO toca prestamos.cobrador_id (no conocemos
 * el valor previo); revierte solo la RUTA. Idempotente. Best-effort en el llamador.
 */
export async function desactivarAsignacion(
  db: SupabaseClient,
  clienteId: string,
  cobradorId: string,
): Promise<void> {
  const { error } = await db
    .from("asignaciones")
    .update({ activo: false })
    .eq("cliente_id", clienteId)
    .eq("cobrador_id", cobradorId)
    .eq("activo", true);
  if (error) throw error;
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
  // ORDEN DELIBERADO: primero SE SUBE la nueva, después se bajan las viejas.
  //
  // Son dos requests distintas (no hay transacción). Al revés —bajar y después
  // subir— un corte en el medio (504 / cierre de la función serverless / red)
  // dejaba al cliente SIN NINGUNA asignación activa: desaparecía de la ruta de
  // todos mientras seguía debiendo, y nadie se enteraba porque ninguna pantalla
  // lista "créditos sin ruta". Es el "cliente fantasma", y ya pasó de verdad
  // (46 créditos activos / $634.666 huérfanos, reparados a mano en la auditoría
  // del 08-02). En este orden, el peor caso es que el cliente quede un instante
  // en DOS rutas: molesto, visible y sin plata perdida — desde 0038 la tabla
  // admite varios cobradores activos por cliente, así que no viola nada.
  const on = await db
    .from("asignaciones")
    .upsert(
      { cobrador_id: nuevoCobradorId, cliente_id: clienteId, activo: true },
      { onConflict: "cobrador_id,cliente_id" },
    );
  if (on.error) throw on.error;

  // 2) Bajar las OTRAS activas (nunca la que acabamos de subir).
  const off = await db
    .from("asignaciones")
    .update({ activo: false })
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .neq("cobrador_id", nuevoCobradorId);
  if (off.error) throw off.error;

  // 3) Sincronizar el DUEÑO de los créditos ACTIVOS del cliente. La ruta se arma
  // desde `asignaciones`, pero `prestamos.cobrador_id` es la fuente de verdad del
  // dueño de la ruta para comisiones (RPC app_comision_por_ruta) y auditorías. Sin
  // esto quedaba STALE: comisión y auditoría apuntaban al cobrador viejo. Solo los
  // ACTIVOS (los finalizados conservan su historia). Los pagos ya hechos guardan su
  // registrado_por, no se tocan.
  const upd = await db
    .from("prestamos")
    .update({ cobrador_id: nuevoCobradorId })
    .eq("cliente_id", clienteId)
    .eq("estado", "activo")
    .select("id");
  if (upd.error) throw upd.error;

  // Un UPDATE que no matchea filas bajo RLS NO es un error en PostgREST: vuelve
  // vacío y en silencio. Si el cliente tiene créditos activos y ninguno se movió,
  // la ruta cambió pero la COMISIÓN sigue yendo al cobrador viejo → hay que verlo,
  // no tragárselo. (Cero filas con cero créditos activos es normal y no avisa.)
  if ((upd.data?.length ?? 0) === 0) {
    const { count } = await db
      .from("prestamos")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .eq("estado", "activo");
    if ((count ?? 0) > 0) {
      throw new Error(
        "La ruta se cambió pero no se pudo mover el dueño de los créditos activos (la comisión seguiría yendo al cobrador anterior).",
      );
    }
  }
}
