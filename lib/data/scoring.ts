// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — HISTORIAL para el scoring (uso interno: admin/supervisor).
//  Junta los préstamos del cliente y sus pagos vigentes, en la forma que
//  consume el núcleo puro lib/scoring.ts. Reutiliza las funciones ya testeadas.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pago, Prestamo } from "@/types/db";
import { getPrestamosDeCliente } from "./prestamos";
import { getPagosDeVariosPrestamos } from "./pagos";

export interface HistorialCrediticio {
  prestamos: Prestamo[];
  /** Pagos vigentes (no anulados) indexados por prestamo_id. */
  pagosPorPrestamo: Record<string, Pago[]>;
}

/**
 * Trae todo lo necesario para puntuar a un cliente: sus préstamos y los pagos
 * vigentes de cada uno. Pensado para el panel admin (RLS lo limita a gestores).
 */
export async function getHistorialCrediticio(
  db: SupabaseClient,
  clienteId: string,
): Promise<HistorialCrediticio> {
  const prestamos = await getPrestamosDeCliente(db, clienteId);

  // Los pagos de TODOS sus créditos en UNA consulta (antes: una por crédito → N+1).
  const pagosPorPrestamo = await getPagosDeVariosPrestamos(db, prestamos.map((p) => p.id));
  // Garantizar una entrada (aunque sea []) por cada préstamo, como antes.
  for (const p of prestamos) pagosPorPrestamo[p.id] ??= [];

  return { prestamos, pagosPorPrestamo };
}
