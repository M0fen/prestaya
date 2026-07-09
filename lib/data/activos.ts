// ─────────────────────────────────────────────────────────────────────────
//  Créditos ACTIVOS con sus pagos agrupados (RPC `app_cartera_activa`, 0040).
//  Devuelve UNA fila por crédito (≈2.661) en vez de una por pago (≈20k), para
//  que el panel escale. La lógica del cartón/mora se sigue calculando en TS
//  (tested, autoritativa) sobre estos datos. Respeta RLS (la RPC no es definer).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pago, Prestamo } from "@/types/db";

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

export async function getActivosConPagos(db: SupabaseClient): Promise<ActivoConPagos[]> {
  const { data, error } = await db.rpc("app_cartera_activa");
  if (error) throw error;
  return (data ?? []) as ActivoConPagos[];
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
