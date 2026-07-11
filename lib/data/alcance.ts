// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ALCANCE por ZONA del gestor logueado.
//  Traduce el Actor (rol + zonas supervisadas) a los CONJUNTOS DE IDs concretos
//  que ese gestor puede ver: cobradores de su(s) zona(s) y los clientes que esos
//  cobradores tienen asignados. Con esos sets, cada consulta del panel se acota
//  con `.in(...)` → el supervisor ve SOLO su zona, y de paso las consultas quedan
//  chicas (esquivan el statement-timeout del RLS por-fila sobre 13k clientes).
//
//  Regla de compatibilidad (espejo de lib/permisos.ts): admin = TODO; supervisor
//  SIN zonas = TODO (hasta que el admin le asigne su primera zona); supervisor
//  CON zonas = solo esas. El cobrador no pasa por acá (su app va por asignación).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActorActual } from "@/lib/auth";
import { alcanceZonas, type Actor } from "@/lib/permisos";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type Alcance =
  | { global: true }
  | {
      global: false;
      /** Zonas efectivas del supervisor. */
      zonas: string[];
      /** usuarios.id de los cobradores de esas zonas. */
      cobradorIds: string[];
      /** clientes.id asignados (activos) a esos cobradores. */
      clienteIds: string[];
    };

/** ¿El alcance ve todo (admin / supervisor sin zonas)? */
export const esGlobal = (a: Alcance): a is { global: true } => a.global;

// PostgREST arma el filtro `.in(...)` en la URL (GET); con cientos de UUIDs la
// URL supera el límite del server y la consulta falla ("fetch failed"). Por eso
// TODO `.in(...)` sobre `clienteIds` se parte en lotes chicos y se une en JS.
// (Verificado en PRUEBA: ~300 ids ok, ~445 falla.)
export const LOTE_IN = 150;

/** Parte un arreglo en lotes de `tam` para consultas `.in(...)` acotadas. */
export function enLotes<T>(arr: readonly T[], tam = LOTE_IN): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += tam) out.push(arr.slice(i, i + tam));
  return out;
}

/**
 * Resuelve el alcance del gestor logueado. Sin sesión → global (las guardas de
 * página ya cortan el acceso; acá no restringimos de más). Usa service_role SOLO
 * para resolver los sets de IDs (consultas acotadas por zona, no por-fila sobre
 * toda la base), nunca para devolver datos de negocio.
 */
export async function alcanceDelActor(actorPre?: Actor | null): Promise<Alcance> {
  // Reusa el actor ya resuelto por la página (evita otro getUser()); si no se
  // pasa, lo resuelve como antes.
  const actor = actorPre === undefined ? await getActorActual() : actorPre;
  if (!actor) return { global: true };

  const al = alcanceZonas(actor);
  if (al.tipo === "todas") return { global: true };
  if (al.tipo === "ninguna") {
    // Supervisor con zonas configuradas pero ninguna válida: no ve nada.
    return { global: false, zonas: [], cobradorIds: [], clienteIds: [] };
  }

  const zonas = [...al.zonas];
  const admin = createSupabaseAdmin();

  // Cobradores de esas zonas (acotado por zona → barato).
  const { data: cobs, error: eCob } = await admin
    .from("usuarios")
    .select("id")
    .eq("rol", "cobrador")
    .in("zona_id", zonas);
  if (eCob) throw eCob;
  const cobradorIds = (cobs ?? []).map((c) => (c as { id: string }).id);

  // Clientes asignados (activos) a esos cobradores.
  let clienteIds: string[] = [];
  if (cobradorIds.length > 0) {
    const { data: asig, error: eAsig } = await admin
      .from("asignaciones")
      .select("cliente_id")
      .eq("activo", true)
      .in("cobrador_id", cobradorIds);
    if (eAsig) throw eAsig;
    clienteIds = [...new Set((asig ?? []).map((a) => (a as { cliente_id: string }).cliente_id))];
  }

  return { global: false, zonas, cobradorIds, clienteIds };
}

/**
 * IDs de TODOS los préstamos (activos + finalizados) de los clientes del alcance.
 * Sirve para acotar consultas sobre `pagos` (que referencian préstamo, no cliente)
 * — p. ej. recaudos y sumas de recaudación por zona. Global → null (sin filtro).
 */
export async function prestamoIdsDelAlcance(
  alcance: Alcance,
): Promise<Set<string> | null> {
  if (alcance.global) return null;
  if (alcance.clienteIds.length === 0) return new Set();
  const admin = createSupabaseAdmin();
  const ids = new Set<string>();
  // `.in(cliente_id, ...)` EN LOTES (evita la URL demasiado larga de PostgREST).
  for (const lote of enLotes(alcance.clienteIds)) {
    const { data, error } = await admin.from("prestamos").select("id").in("cliente_id", lote);
    if (error) throw error;
    for (const p of data ?? []) ids.add((p as { id: string }).id);
  }
  return ids;
}

/** Filtra créditos activos al alcance (por cliente). Global → sin cambios. */
export function filtrarActivosPorAlcance<T extends { cliente_id: string }>(
  activos: readonly T[],
  alcance: Alcance,
): T[] {
  if (alcance.global) return [...activos];
  const set = new Set(alcance.clienteIds);
  return activos.filter((a) => set.has(a.cliente_id));
}
