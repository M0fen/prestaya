// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — PRÉSTAMOS.
//  ⚠️ El dinero llega de PostgREST como string: se convierte a number aquí.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prestamo } from "@/types/db";

/** Convierte una fila cruda en un Prestamo tipado (parsea numeric → number). */
function mapPrestamo(r: Record<string, unknown>): Prestamo {
  return {
    id: r.id as string,
    cliente_id: r.cliente_id as string,
    cobrador_id: (r.cobrador_id as string | null) ?? null,
    monto_prestado: Number(r.monto_prestado),
    cuota_diaria: Number(r.cuota_diaria),
    total_dias: Number(r.total_dias),
    fecha_inicio: r.fecha_inicio as string,
    estado: r.estado as Prestamo["estado"],
    creado_por: (r.creado_por as string | null) ?? null,
    creado_en: r.creado_en as string,
    actualizado_en: r.actualizado_en as string,
    finalizado_en: (r.finalizado_en as string | null) ?? null,
  };
}

/**
 * Devuelve el préstamo ACTIVO de un cliente (o null si no tiene).
 * La BD garantiza que haya como máximo uno activo por cliente.
 */
export async function getPrestamoActivoPorCliente(
  db: SupabaseClient,
  clienteId: string,
): Promise<Prestamo | null> {
  const { data, error } = await db
    .from("prestamos")
    .select("*")
    .eq("cliente_id", clienteId)
    .eq("estado", "activo")
    .maybeSingle();

  if (error) throw error;
  return data ? mapPrestamo(data) : null;
}

/** Cuenta los créditos ya finalizados (pagados) de un cliente. */
export async function contarCreditosPagados(
  db: SupabaseClient,
  clienteId: string,
): Promise<number> {
  const { count, error } = await db
    .from("prestamos")
    .select("*", { count: "exact", head: true })
    .eq("cliente_id", clienteId)
    .eq("estado", "finalizado");

  if (error) throw error;
  return count ?? 0;
}

/** Busca un préstamo por su id. */
export async function getPrestamoPorId(
  db: SupabaseClient,
  id: string,
): Promise<Prestamo | null> {
  const { data, error } = await db
    .from("prestamos")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapPrestamo(data) : null;
}
