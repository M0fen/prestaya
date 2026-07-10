// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — "VALOR DEL SISTEMA" (tablero de ROI para el dueño).
//  Hace visible la razón de la inversión con números REALES: trazabilidad de
//  la cobranza (auditable), salud de cartera y crecimiento. Honesto: lo que es
//  estimación se marca como tal, y crece con el volumen.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDashboardMetricas } from "./metricas";
import { inicioMesUYIso } from "@/lib/fecha";

export interface ValorSistema {
  // Trazabilidad / anti-fuga
  gestionadoMes: number; // $ cobrado este mes por el sistema
  cobrosMes: number;
  cobrosAuditables: number; // con GPS + hora
  trazabilidadPct: number; // 0..1
  // Cartera sana
  carteraPorCobrar: number;
  montoEnMora: number;
  morosos: number;
  moraPct: number; // 0..1 sobre la cartera
  // Crecimiento / originación
  capitalColocado: number;
  creditosActivos: number;
  creditosFinalizados: number;
  clientesActivos: number;
  // Eficiencia
  reportesNuevos: number;
}

/** Cuenta pagos vigentes del mes (head count, sin traer filas). Con `soloGps`
 *  cuenta solo los que tienen GPS (cobros auditables en el terreno).
 *  Fallback: se usa solo si el RPC `app_cobros_mes` (0052) aún no existe. */
async function contarPagosMes(
  db: SupabaseClient,
  desde: string,
  soloGps: boolean,
): Promise<number> {
  let q = db
    .from("pagos")
    .select("*", { count: "exact", head: true })
    .eq("anulado", false)
    .gte("registrado_en", desde);
  if (soloGps) q = q.not("gps_lat", "is", null);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/**
 * Cobros del mes (total + con GPS) en UNA llamada. Usa el RPC security-definer
 * (salta el RLS por-fila que hacía el count lento ~6s). Si el RPC aún no existe
 * (0052 sin correr), cae al conteo directo por PostgREST (más lento pero funciona).
 */
async function cobrosDelMes(
  db: SupabaseClient,
  desde: string,
): Promise<{ total: number; gps: number }> {
  try {
    const { data, error } = await db.rpc("app_cobros_mes", { desde });
    if (error) throw error;
    const o = (data ?? {}) as { total?: number; gps?: number };
    return { total: Number(o.total ?? 0), gps: Number(o.gps ?? 0) };
  } catch {
    const [total, gps] = await Promise.all([
      contarPagosMes(db, desde, false),
      contarPagosMes(db, desde, true),
    ]);
    return { total, gps };
  }
}

export async function getValorSistema(
  db: SupabaseClient,
  hoy: Date = new Date(),
): Promise<ValorSistema> {
  const dash = await getDashboardMetricas(db, hoy);

  // Trazabilidad del mes: cobros con GPS + hora (auditables) sobre el total.
  // ⚠️ Se cuentan en la BD (head count): traer las filas truncaba a 1000 y el mes
  //    tiene decenas de miles → la métrica quedaba mal. Sin traer filas.
  const desdeMes = inicioMesUYIso(hoy);
  const { total: cobrosMes, gps: cobrosAuditables } = await cobrosDelMes(db, desdeMes);
  const trazabilidadPct = cobrosMes > 0 ? cobrosAuditables / cobrosMes : 0;

  // `carteraPorCobrar` (falta) YA incluye lo vencido: la mora es una parte de
  // la cartera, no algo aparte. El % de mora es mora / cartera por cobrar.
  const moraPct =
    dash.carteraPorCobrar > 0 ? dash.montoEnMora / dash.carteraPorCobrar : 0;

  return {
    gestionadoMes: dash.recaudadoMes,
    cobrosMes,
    cobrosAuditables,
    trazabilidadPct,
    carteraPorCobrar: dash.carteraPorCobrar,
    montoEnMora: dash.montoEnMora,
    morosos: dash.morosos,
    moraPct,
    capitalColocado: dash.capitalColocado,
    creditosActivos: dash.creditosActivos,
    creditosFinalizados: dash.creditosFinalizados,
    clientesActivos: dash.clientesActivos,
    reportesNuevos: dash.reportesNuevos,
  };
}
