// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CARTERA para exportar (admin/supervisor).
//  Lista TODOS los créditos activos con su saldo derivado del cartón (fuente
//  canónica: mismo cálculo que ve el cliente). Carga en batch (sin N+1),
//  espejando el patrón de lib/data/mora.ts. Corre como gestor (RLS ve todo).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pago, Prestamo } from "@/types/db";
import { calcularEstadosCarton } from "@/lib/cartones";
import { hoyUY } from "@/lib/fecha";
import { getActivosConPagos, pagosDeActivo } from "./activos";

const N = (v: unknown): number => Number(v);

export interface FilaCartera {
  cliente: string;
  documento: string;
  telefono: string;
  cobrador: string;
  calificacion: string;
  frecuencia: string;
  inicio: string;
  montoPrestado: number;
  cuota: number;
  totalDias: number;
  totalAPagar: number;
  pagado: number;
  saldo: number;
  progresoPct: number;
  diasAtrasados: number;
}

/** Todos los créditos activos con su saldo (para exportar la cartera). */
export async function getCarteraExport(
  db: SupabaseClient,
  hoy: Date = new Date(),
): Promise<FilaCartera[]> {
  const hoyCal = hoyUY(hoy);

  // A ESCALA: una sola RPC con los créditos activos y sus pagos agrupados.
  const activos = await getActivosConPagos(db);
  if (activos.length === 0) return [];

  const filas: FilaCartera[] = activos.map((p) => {
    const carton = calcularEstadosCarton(
      {
        cuota_diaria: N(p.cuota_diaria),
        total_dias: N(p.total_dias),
        frecuencia: p.frecuencia ?? "diario",
        fecha_inicio: p.fecha_inicio,
      },
      pagosDeActivo(p),
      hoyCal,
    );
    return {
      cliente: p.cliente_nombre ?? "Cliente",
      documento: p.cliente_documento ?? "",
      telefono: p.cliente_telefono ?? "",
      cobrador: p.cobrador_nombre ?? "",
      calificacion: p.cliente_calificacion ?? "",
      frecuencia: p.frecuencia ?? "diario",
      inicio: p.fecha_inicio,
      montoPrestado: Math.round(N(p.monto_prestado)),
      cuota: Math.round(N(p.cuota_diaria)),
      totalDias: N(p.total_dias),
      totalAPagar: carton.totalAPagar,
      pagado: carton.totalPagado,
      saldo: carton.falta,
      progresoPct: carton.progresoPct,
      diasAtrasados: carton.dias.filter((d) => d.estado === "atrasado").length,
    };
  });

  filas.sort((a, b) => a.cliente.localeCompare(b.cliente, "es"));
  return filas;
}
