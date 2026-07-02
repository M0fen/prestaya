// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — MÉTRICAS del dashboard (uso interno: admin/supervisor).
//  Reusa el núcleo del cartón (calcularEstadosCarton) para medir mora/cartera
//  con la MISMA verdad que ve el cliente. Las consultas corren como el usuario
//  logueado (RLS): un gestor ve todo; un cobrador, solo lo suyo.
//
//  ⚠️ v1: agrega en JS sobre lo consultado (ok para el volumen actual). A
//  escala (miles de créditos) conviene mover esto a una vista/RPC en SQL.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pago, Prestamo } from "@/types/db";
import { calcularEstadosCarton } from "@/lib/cartones";
import { hoyUY, inicioDiaUYIso, inicioMesUYIso } from "@/lib/fecha";

export interface TramoMora {
  /** Etiqueta del tramo, p. ej. "1–7 días". */
  tramo: string;
  creditos: number;
  monto: number;
}

export interface DashboardMetricas {
  clientesActivos: number;
  creditosActivos: number;
  creditosFinalizados: number;
  incobrables: number;
  /** Capital entregado en créditos activos (UYU). */
  capitalColocado: number;
  /** Saldo total por cobrar de los créditos activos (UYU). */
  carteraPorCobrar: number;
  recaudadoHoy: number;
  recaudadoMes: number;
  /** Créditos activos con al menos un día atrasado. */
  morosos: number;
  /** Monto vencido e impago (sin contar la cuota de hoy ni futuros). */
  montoEnMora: number;
  tramosMora: TramoMora[];
  reportesNuevos: number;
  anunciosActivos: number;
  /** Instante del cálculo (ISO). */
  generadoEn: string;
}

async function contar(
  db: SupabaseClient,
  tabla: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filtros: (q: any) => any,
): Promise<number> {
  // ⚠️ El await es imprescindible: sin él se destructura el builder de PostgREST
  //    (que aún no resolvió) y `count` queda undefined → el KPI siempre daría 0.
  const { count, error } = await filtros(
    db.from(tabla).select("*", { count: "exact", head: true }),
  );
  if (error) throw error;
  return count ?? 0;
}

/** Calcula todas las métricas del dashboard. `hoy` = referencia del servidor. */
export async function getDashboardMetricas(
  db: SupabaseClient,
  hoy: Date = new Date(),
): Promise<DashboardMetricas> {
  // 1) Conteos baratos (head count).
  const [
    clientesActivos,
    creditosActivos,
    creditosFinalizados,
    incobrables,
    reportesNuevos,
    anunciosActivos,
  ] = await Promise.all([
    contar(db, "clientes", (q) => q.eq("activo", true)),
    contar(db, "prestamos", (q) => q.eq("estado", "activo")),
    contar(db, "prestamos", (q) => q.eq("estado", "finalizado")),
    contar(db, "prestamos", (q) => q.eq("estado", "incobrable")),
    contar(db, "reportes", (q) => q.eq("estado", "nuevo")),
    contar(db, "anuncios", (q) => q.eq("activo", true)),
  ]);

  // 2) Créditos activos (para cartera y mora) + sus pagos vigentes.
  const { data: activosRaw, error: errAct } = await db
    .from("prestamos")
    .select("id, monto_prestado, cuota_diaria, total_dias, frecuencia, fecha_inicio, estado")
    .eq("estado", "activo");
  if (errAct) throw errAct;
  const activos = (activosRaw ?? []) as Pick<
    Prestamo,
    "id" | "monto_prestado" | "cuota_diaria" | "total_dias" | "frecuencia" | "fecha_inicio"
  >[];

  const ids = activos.map((p) => p.id);
  const pagosPorPrestamo: Record<string, Pago[]> = {};
  if (ids.length > 0) {
    const { data: pagosRaw, error: errPag } = await db
      .from("pagos")
      .select("prestamo_id, dia_credito, monto")
      .in("prestamo_id", ids)
      .eq("anulado", false);
    if (errPag) throw errPag;
    for (const r of pagosRaw ?? []) {
      const k = r.prestamo_id as string;
      (pagosPorPrestamo[k] ??= []).push({
        dia_credito: Number(r.dia_credito),
        monto: Number(r.monto),
      } as Pago);
    }
  }

  // 3) Cartera y mora: corremos el cartón de cada crédito activo.
  let capitalColocado = 0;
  let carteraPorCobrar = 0;
  let morosos = 0;
  let montoEnMora = 0;
  const tramos = [
    { tramo: "1–7 días", creditos: 0, monto: 0 },
    { tramo: "8–15 días", creditos: 0, monto: 0 },
    { tramo: "16+ días", creditos: 0, monto: 0 },
  ];
  const hoyCal = hoyUY(hoy);

  for (const p of activos) {
    capitalColocado += Number(p.monto_prestado);
    const r = calcularEstadosCarton(
      {
        cuota_diaria: Number(p.cuota_diaria),
        total_dias: Number(p.total_dias),
        frecuencia: p.frecuencia ?? "diario",
        fecha_inicio: p.fecha_inicio,
      } as Prestamo,
      pagosPorPrestamo[p.id] ?? [],
      hoyCal,
    );
    carteraPorCobrar += r.falta;

    const diasAtraso = r.dias.filter((d) => d.estado === "atrasado");
    if (diasAtraso.length > 0) {
      morosos++;
      const moraCredito = diasAtraso.reduce(
        (s, d) => s + Math.max(0, Number(p.cuota_diaria) - d.montoPagado),
        0,
      );
      montoEnMora += moraCredito;
      const t = diasAtraso.length <= 7 ? 0 : diasAtraso.length <= 15 ? 1 : 2;
      tramos[t].creditos++;
      tramos[t].monto += moraCredito;
    }
  }

  // 4) Recaudación de hoy y del mes (hora de Uruguay).
  const [recaudadoHoy, recaudadoMes] = await Promise.all([
    sumarPagosDesde(db, inicioDiaUYIso(hoy)),
    sumarPagosDesde(db, inicioMesUYIso(hoy)),
  ]);

  return {
    clientesActivos,
    creditosActivos,
    creditosFinalizados,
    incobrables,
    capitalColocado,
    carteraPorCobrar,
    recaudadoHoy,
    recaudadoMes,
    morosos,
    montoEnMora,
    tramosMora: tramos,
    reportesNuevos,
    anunciosActivos,
    generadoEn: hoy.toISOString(),
  };
}

/** Suma los pagos vigentes registrados desde un instante ISO. */
async function sumarPagosDesde(
  db: SupabaseClient,
  desdeIso: string,
): Promise<number> {
  const { data, error } = await db
    .from("pagos")
    .select("monto")
    .eq("anulado", false)
    .gte("registrado_en", desdeIso);
  if (error) throw error;
  return (data ?? []).reduce((s, r) => s + Number(r.monto), 0);
}
