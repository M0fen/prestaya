// ─────────────────────────────────────────────────────────────────────────
//  Créditos ACTIVOS con sus pagos agrupados (RPC `app_cartera_activa`, 0040).
//  Devuelve UNA fila por crédito (≈2.661) en vez de una por pago (≈20k), para
//  que el panel escale. La lógica del cartón/mora se sigue calculando en TS
//  (tested, autoritativa) sobre estos datos. Respeta RLS (la RPC no es definer).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pago, Prestamo } from "@/types/db";
import { alcanceDelActor, filtrarActivosPorAlcance, type Alcance } from "./alcance";
import { funcionFaltante, tablaFaltante } from "./errores";

export interface ActivoConPagos {
  id: string;
  cliente_id: string;
  cobrador_id: string | null;
  monto_prestado: number;
  cuota_diaria: number;
  total_dias: number;
  frecuencia: Prestamo["frecuencia"];
  fecha_inicio: string;
  /** Ref e interés informativo de Disapp (para el Informe de cartera). */
  disapp_credit_ref: string | null;
  interes_pct: number | null;
  cliente_nombre: string;
  cliente_documento: string | null;
  cliente_telefono: string | null;
  cliente_direccion: string | null;
  cliente_calificacion: string | null;
  cliente_gps_lat: number | null;
  cliente_gps_lng: number | null;
  cobrador_nombre: string | null;
  /** TOTAL pagado del crédito (suma de pagos vigentes). El cartón (FIFO) deriva
   *  el estado de cada cuota del acumulado, así que no hace falta cada pago. */
  pagado: number;
  /** Compat: RPC vieja embebía los pagos uno a uno. Puede no venir. */
  pagos?: { d: number; m: number }[];
}

// Cache en memoria de la cartera GLOBAL (admin). SOLO el agregado informativo del
// dashboard (cartera por cobrar / mora), NUNCA datos operativos: el cobrador y la
// ficha leen el libro de pagos en vivo, y el recaudo del día es query aparte (no
// se cachea). Best-effort por instancia serverless; el supervisor usa la RPC
// acotada y nunca toca esto. Ver el path global de getActivosConPagos.
const CARTERA_TTL_MS = 20_000;
let carteraGlobalCache: { data: ActivoConPagos[]; exp: number } | null = null;

export async function getActivosConPagos(
  db: SupabaseClient,
  alcance?: Alcance,
): Promise<ActivoConPagos[]> {
  const al = alcance ?? (await alcanceDelActor());

  // Supervisor (alcance por ZONA): RPC ACOTADA por cliente_ids → SQL filtra y
  // agrega SOLO su cartera (~150 créditos), no toda la base (~2.400 / 1,4 MB /
  // ~3,5 s medidos). Antes se traía TODO y se filtraba en JS. Fallback a la RPC
  // completa + filtro JS si la RPC acotada (0062) aún no corrió.
  if (!al.global) {
    if (al.clienteIds.length === 0) return [];
    try {
      const { data, error } = await db.rpc("app_cartera_activa_zona", { cliente_ids: al.clienteIds });
      if (error) throw error;
      return (data ?? []) as ActivoConPagos[];
    } catch (e) {
      if (!tablaFaltante(e) && !funcionFaltante(e)) throw e;
      // 0062 sin correr → cae al camino completo de abajo (mismo resultado, más lento).
    }
  }

  // Admin (global) o fallback (supervisor sin 0062): cartera COMPLETA. Cache corto
  // SOLO para el caso global → cargas repetidas del admin (dashboard→jornada→…)
  // quedan instantáneas, con un desfasaje ≤20s únicamente en ese agregado lento.
  const ahora = Date.now();
  if (al.global && carteraGlobalCache && carteraGlobalCache.exp > ahora) {
    return [...carteraGlobalCache.data];
  }
  const { data, error } = await db.rpc("app_cartera_activa");
  if (error) throw error;
  const activos = (data ?? []) as ActivoConPagos[];
  if (al.global) carteraGlobalCache = { data: activos, exp: ahora + CARTERA_TTL_MS };
  return filtrarActivosPorAlcance(activos, al);
}

/**
 * Pagos de un crédito activo en la forma que espera el cartón. Como el cartón
 * solo usa la SUMA, se pasa UN pago sintético con el total (payload mínimo).
 * Compat: si la RPC vieja todavía manda `pagos` uno a uno, se usan esos.
 */
export function pagosDeActivo(a: ActivoConPagos): Pick<Pago, "dia_credito" | "monto">[] {
  if (typeof a.pagado === "number") return [{ dia_credito: 1, monto: a.pagado }];
  if (a.pagos) return a.pagos.map((x) => ({ dia_credito: Number(x.d), monto: Number(x.m) }));
  return [];
}
