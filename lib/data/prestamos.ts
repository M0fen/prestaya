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
    // Defensivo: si 0011 aún no corrió, la columna viene undefined → 'diario'.
    frecuencia: (r.frecuencia as Prestamo["frecuencia"]) ?? "diario",
    fecha_inicio: r.fecha_inicio as string,
    estado: r.estado as Prestamo["estado"],
    creado_por: (r.creado_por as string | null) ?? null,
    // Paridad Disapp (0041); defensivo si aún no corrió la migración.
    es_float_supervisor: (r.es_float_supervisor as boolean | undefined) ?? false,
    interes_pct: r.interes_pct == null ? null : Number(r.interes_pct),
    creado_en: r.creado_en as string,
    actualizado_en: r.actualizado_en as string,
    finalizado_en: (r.finalizado_en as string | null) ?? null,
  };
}

/**
 * Devuelve el préstamo ACTIVO de un cliente (o null si no tiene).
 * Desde 0037 un cliente puede tener VARIOS créditos activos. Esta función
 * devuelve el "principal" (el más nuevo por fecha de inicio) para las vistas
 * que muestran uno solo; usar `getPrestamosActivosPorCliente` para listarlos
 * todos. Ya NO usa `.maybeSingle()` (rompería con múltiples activos).
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
    .order("fecha_inicio", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data && data.length > 0 ? mapPrestamo(data[0]) : null;
}

/**
 * TODOS los créditos activos de un cliente (del más nuevo al más viejo).
 * Desde 0037 pueden ser varios. Cada uno mantiene su propio cartón.
 */
export async function getPrestamosActivosPorCliente(
  db: SupabaseClient,
  clienteId: string,
): Promise<Prestamo[]> {
  const { data, error } = await db
    .from("prestamos")
    .select("*")
    .eq("cliente_id", clienteId)
    .eq("estado", "activo")
    .order("fecha_inicio", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapPrestamo);
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

/** Todos los préstamos de un cliente (cualquier estado), del más nuevo al más
 *  viejo. Base del scoring crediticio (lib/scoring.ts). */
export async function getPrestamosDeCliente(
  db: SupabaseClient,
  clienteId: string,
): Promise<Prestamo[]> {
  const { data, error } = await db
    .from("prestamos")
    .select("*")
    .eq("cliente_id", clienteId)
    .order("fecha_inicio", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapPrestamo);
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
