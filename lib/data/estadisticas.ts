// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ESTADÍSTICAS del negocio (panel admin + Dev). Todo agregado
//  en SQL (migración 0048) para no traer 158k pagos al servidor. Degrada elegante
//  a `disponible:false` si 0048 aún no corrió (la pantalla lo avisa, no rompe).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MesStats {
  mes: string; // "YYYY-MM"
  colocado: number;
  creditosNuevos: number;
  recaudado: number;
  cobros: number;
  clientesNuevos: number;
  cobradoresNuevos: number;
  creditosFinalizados: number;
}
export interface CobradorStats {
  cobradorId: string;
  nombre: string;
  creditosActivos: number;
  capital: number;
  recaudo: number;
  cobros: number;
  ultimoCobro: string | null;
}
export interface TopCliente {
  clienteId: string;
  nombre: string;
  creditos: number;
  activos: number;
  capitalHist: number;
}
export interface Distribucion {
  frecuencia: { k: string; n: number; capital: number }[];
  calificacion: { k: string; n: number }[];
}
export interface Estadisticas {
  disponible: boolean;
  mensual: MesStats[];
  distribucion: Distribucion;
  porCobrador: CobradorStats[];
  topClientes: TopCliente[];
}

const N = (v: unknown) => Number(v ?? 0);

export async function getEstadisticas(
  db: SupabaseClient,
  opts: { meses?: number; dias?: number; topN?: number } = {},
): Promise<Estadisticas> {
  const meses = opts.meses ?? 8;
  const dias = opts.dias ?? 30;
  const topN = opts.topN ?? 10;
  const vacio: Estadisticas = {
    disponible: false,
    mensual: [],
    distribucion: { frecuencia: [], calificacion: [] },
    porCobrador: [],
    topClientes: [],
  };
  try {
    const [m, d, c, t] = await Promise.all([
      db.rpc("app_stats_mensual", { meses }),
      db.rpc("app_stats_distribucion"),
      db.rpc("app_stats_por_cobrador", { dias }),
      db.rpc("app_stats_top_clientes", { limite: topN }),
    ]);
    if (m.error) throw m.error;

    const mensual = ((m.data ?? []) as Record<string, unknown>[]).map((r) => ({
      mes: String(r.mes),
      colocado: N(r.colocado),
      creditosNuevos: N(r.creditosNuevos),
      recaudado: N(r.recaudado),
      cobros: N(r.cobros),
      clientesNuevos: N(r.clientesNuevos),
      cobradoresNuevos: N(r.cobradoresNuevos),
      creditosFinalizados: N(r.creditosFinalizados),
    }));

    const dd = (d.data ?? {}) as { frecuencia?: unknown[]; calificacion?: unknown[] };
    const distribucion: Distribucion = {
      frecuencia: ((dd.frecuencia ?? []) as Record<string, unknown>[]).map((x) => ({
        k: String(x.k), n: N(x.n), capital: N(x.capital),
      })),
      calificacion: ((dd.calificacion ?? []) as Record<string, unknown>[]).map((x) => ({
        k: String(x.k), n: N(x.n),
      })),
    };

    const porCobrador = ((c.data ?? []) as Record<string, unknown>[]).map((r) => ({
      cobradorId: String(r.cobrador_id),
      nombre: String(r.nombre),
      creditosActivos: N(r.creditos_activos),
      capital: N(r.capital),
      recaudo: N(r.recaudo),
      cobros: N(r.cobros),
      ultimoCobro: (r.ultimo_cobro as string | null) ?? null,
    }));

    const topClientes = ((t.data ?? []) as Record<string, unknown>[]).map((r) => ({
      clienteId: String(r.cliente_id),
      nombre: String(r.nombre),
      creditos: N(r.creditos),
      activos: N(r.activos),
      capitalHist: N(r.capital_hist),
    }));

    return { disponible: true, mensual, distribucion, porCobrador, topClientes };
  } catch {
    return vacio;
  }
}
