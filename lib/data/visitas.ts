// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — VISITAS (registro de ruta: "no pago", "no estaba", etc.).
//  Se inserta cuando el cobrador pasa y no hay cobro. No se borra.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResultadoVisita, Visita } from "@/types/db";

export interface NuevaVisita {
  prestamo_id: string;
  cobrador_id?: string | null;
  resultado: ResultadoVisita;
  motivo?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  /** Hora real de la visita (ISO). Para registros offline sincronizados luego. */
  registrado_en?: string | null;
  /** Id de la operación offline (dedupe exactly-once, índice único, ver 0006). */
  op_id?: string | null;
}

function mapVisita(r: Record<string, unknown>): Visita {
  return {
    id: r.id as string,
    prestamo_id: r.prestamo_id as string,
    cobrador_id: (r.cobrador_id as string | null) ?? null,
    resultado: r.resultado as ResultadoVisita,
    motivo: (r.motivo as string | null) ?? null,
    gps_lat: r.gps_lat == null ? null : Number(r.gps_lat),
    gps_lng: r.gps_lng == null ? null : Number(r.gps_lng),
    registrado_en: r.registrado_en as string,
  };
}

/** Registra una visita (resultado de la pasada del cobrador). */
export async function crearVisita(
  db: SupabaseClient,
  v: NuevaVisita,
): Promise<Visita> {
  const { data, error } = await db
    .from("visitas")
    .insert({
      prestamo_id: v.prestamo_id,
      cobrador_id: v.cobrador_id ?? null,
      resultado: v.resultado,
      motivo: v.motivo ?? null,
      gps_lat: v.gps_lat ?? null,
      gps_lng: v.gps_lng ?? null,
      ...(v.registrado_en ? { registrado_en: v.registrado_en } : {}),
      ...(v.op_id ? { op_id: v.op_id } : {}),
    })
    .select()
    .single();

  if (error) throw error;
  return mapVisita(data);
}
