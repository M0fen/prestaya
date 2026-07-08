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
  cliente_nombre: string;
  cliente_documento: string | null;
  cliente_telefono: string | null;
  cliente_direccion: string | null;
  cliente_calificacion: string | null;
  cliente_gps_lat: number | null;
  cliente_gps_lng: number | null;
  cobrador_nombre: string | null;
  /** Pagos vigentes del crédito, compactados: {d: dia_credito, m: monto}. */
  pagos: { d: number; m: number }[];
}

export async function getActivosConPagos(db: SupabaseClient): Promise<ActivoConPagos[]> {
  const { data, error } = await db.rpc("app_cartera_activa");
  if (error) throw error;
  return (data ?? []) as ActivoConPagos[];
}

/** Pagos de un crédito activo en la forma que espera el cartón. */
export function pagosDeActivo(a: ActivoConPagos): Pick<Pago, "dia_credito" | "monto">[] {
  return a.pagos.map((x) => ({ dia_credito: Number(x.d), monto: Number(x.m) }));
}
