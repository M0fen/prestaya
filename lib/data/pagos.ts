// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — PAGOS (libro contable inmutable).
//  Lectura: solo pagos NO anulados. Escritura: insertar (nunca update/delete).
//  ⚠️ El dinero llega de PostgREST como string: se convierte a number aquí.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NuevoPago, Pago } from "@/types/db";

/** Convierte una fila cruda en un Pago tipado (parsea numeric → number). */
function mapPago(r: Record<string, unknown>): Pago {
  return {
    id: r.id as string,
    prestamo_id: r.prestamo_id as string,
    dia_credito: Number(r.dia_credito),
    monto: Number(r.monto),
    registrado_por: (r.registrado_por as string | null) ?? null,
    registrado_en: r.registrado_en as string,
    gps_lat: r.gps_lat == null ? null : Number(r.gps_lat),
    gps_lng: r.gps_lng == null ? null : Number(r.gps_lng),
    anulado: r.anulado as boolean,
    anulado_por: (r.anulado_por as string | null) ?? null,
    anulado_en: (r.anulado_en as string | null) ?? null,
    motivo_anulacion: (r.motivo_anulacion as string | null) ?? null,
  };
}

/**
 * Lista los pagos VIGENTES (no anulados) de un préstamo, ordenados por día.
 * Esta es la entrada que consume el cálculo del cartón.
 */
export async function getPagosDePrestamo(
  db: SupabaseClient,
  prestamoId: string,
): Promise<Pago[]> {
  const { data, error } = await db
    .from("pagos")
    .select("*")
    .eq("prestamo_id", prestamoId)
    .eq("anulado", false)
    .order("dia_credito", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapPago);
}

/**
 * Registra un pago nuevo. Los pagos NUNCA se editan ni borran: para corregir
 * un error se inserta la anulación (otro paso) sobre el registro existente.
 */
export async function registrarPago(
  db: SupabaseClient,
  pago: NuevoPago,
): Promise<Pago> {
  const { data, error } = await db
    .from("pagos")
    .insert({
      prestamo_id: pago.prestamo_id,
      dia_credito: pago.dia_credito,
      monto: pago.monto,
      registrado_por: pago.registrado_por ?? null,
      gps_lat: pago.gps_lat ?? null,
      gps_lng: pago.gps_lng ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return mapPago(data);
}
