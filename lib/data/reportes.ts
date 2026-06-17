// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — REPORTES de discrepancia.
//  Las escrituras se invocan desde el Server Action (service_role), nunca
//  desde el navegador.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NuevoReporte, Reporte } from "@/types/db";

function mapReporte(r: Record<string, unknown>): Reporte {
  return {
    id: r.id as string,
    cliente_id: r.cliente_id as string,
    prestamo_id: (r.prestamo_id as string | null) ?? null,
    tipo: r.tipo as Reporte["tipo"],
    dia_credito: r.dia_credito == null ? null : Number(r.dia_credito),
    monto_reclamado:
      r.monto_reclamado == null ? null : Number(r.monto_reclamado),
    comentario: (r.comentario as string | null) ?? null,
    estado: r.estado as Reporte["estado"],
    creado_en: r.creado_en as string,
    atendido_por: (r.atendido_por as string | null) ?? null,
    atendido_en: (r.atendido_en as string | null) ?? null,
  };
}

/** Crea un reporte de discrepancia. */
export async function crearReporte(
  db: SupabaseClient,
  input: NuevoReporte,
): Promise<Reporte> {
  const { data, error } = await db
    .from("reportes")
    .insert({
      cliente_id: input.cliente_id,
      prestamo_id: input.prestamo_id ?? null,
      tipo: input.tipo ?? "falta_pago",
      dia_credito: input.dia_credito ?? null,
      monto_reclamado: input.monto_reclamado ?? null,
      comentario: input.comentario ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return mapReporte(data);
}

/** Cuenta reportes de un cliente creados desde `desde` (para rate-limit). */
export async function contarReportesRecientes(
  db: SupabaseClient,
  clienteId: string,
  desde: Date,
): Promise<number> {
  const { count, error } = await db
    .from("reportes")
    .select("*", { count: "exact", head: true })
    .eq("cliente_id", clienteId)
    .gte("creado_en", desde.toISOString());

  if (error) throw error;
  return count ?? 0;
}
