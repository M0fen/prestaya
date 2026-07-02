// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — HISTORIAL para el scoring (uso interno: admin/supervisor).
//  Junta los préstamos del cliente y sus pagos vigentes, en la forma que
//  consume el núcleo puro lib/scoring.ts. Reutiliza las funciones ya testeadas.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pago, Prestamo } from "@/types/db";
import { getPrestamosDeCliente } from "./prestamos";
import { getPagosDePrestamo } from "./pagos";

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

  const pagosPorPrestamo: Record<string, Pago[]> = {};
  await Promise.all(
    prestamos.map(async (p) => {
      pagosPorPrestamo[p.id] = await getPagosDePrestamo(db, p.id);
    }),
  );

  return { prestamos, pagosPorPrestamo };
}
