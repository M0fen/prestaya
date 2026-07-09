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
import { getActivosConPagos, pagosDeActivo } from "./activos";
import { getConfigMora } from "./moraConfig";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export interface TramoMora {
  /** Etiqueta del tramo, p. ej. "1–7 días". */
  tramo: string;
  creditos: number;
  monto: number;
}

export interface DashboardMetricas {
  /** Clientes con registro activo (toda la base, tengan crédito o no). */
  clientesActivos: number;
  /** Clientes que HOY tienen al menos un crédito activo (deudores reales). */
  deudoresActivos: number;
  creditosActivos: number;
  creditosFinalizados: number;
  incobrables: number;
  /** Capital entregado en créditos activos (UYU). */
  capitalColocado: number;
  /** Saldo total por cobrar de los créditos activos (UYU). */
  carteraPorCobrar: number;
  /** Cuotas que VENCEN hoy y aún no están saldadas (≠ cartera total). */
  porCobrarHoy: number;
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

/** Calcula todas las métricas del dashboard. `hoy` = referencia del servidor.
 *  `activosPre`: créditos activos ya traídos (para compartir la RPC con mora). */
export async function getDashboardMetricas(
  db: SupabaseClient,
  hoy: Date = new Date(),
  activosPre?: import("./activos").ActivoConPagos[],
): Promise<DashboardMetricas> {
  // 1) Conteos baratos (head count). Van por SERVICE_ROLE (bypass RLS) porque un
  //    count sobre 13k clientes / 11k préstamos evaluando el RLS por-fila daba
  //    statement timeout (sobre todo para un supervisor con zona, cuyo RLS es más
  //    pesado). Son agregados globales, coherentes con que el dashboard ya
  //    muestra la operación COMPLETA a cualquier gestor vía las RPCs definer.
  const admin = createSupabaseAdmin();
  const [
    clientesActivos,
    creditosActivos,
    creditosFinalizados,
    incobrables,
    reportesNuevos,
    anunciosActivos,
  ] = await Promise.all([
    contar(admin, "clientes", (q) => q.eq("activo", true)),
    contar(admin, "prestamos", (q) => q.eq("estado", "activo")),
    contar(admin, "prestamos", (q) => q.eq("estado", "finalizado")),
    contar(admin, "prestamos", (q) => q.eq("estado", "incobrable")),
    contar(admin, "reportes", (q) => q.eq("estado", "nuevo")),
    contar(admin, "anuncios", (q) => q.eq("activo", true)),
  ]);

  // 2) Créditos activos + sus pagos. A ESCALA: una sola RPC que devuelve los
  //    pagos YA AGRUPADOS por préstamo (≈2.661 filas, no ≈20k). El cartón se
  //    sigue calculando en TS.
  const activos = activosPre ?? (await getActivosConPagos(db));
  const pagosPorPrestamo: Record<string, Pick<Pago, "dia_credito" | "monto">[]> = {};
  for (const a of activos) pagosPorPrestamo[a.id] = pagosDeActivo(a);
  // Deudores reales = clientes DISTINTOS con al menos un crédito activo (un
  // cliente puede tener varios). Es lo que la gente entiende por "cliente
  // activo", ≠ total de clientes registrados en la base.
  const deudoresActivos = new Set(activos.map((a) => a.cliente_id)).size;

  // Gracia para clasificar MORA (no alarmar por atrasos menores): la de la
  // política vigente (config_mora) + 1 cuota por el día de DESEMBOLSO — la 1ª
  // cuota vence al día siguiente de entregar, así que el día 1 del cartón nunca
  // se paga y no debe contar como mora. Un crédito atrasado ≤ gracia = "al día".
  const configMora = await getConfigMora(db);
  const graciaMora = Math.max(0, Math.floor(configMora.cuotasGracia)) + 1;

  // 3) Cartera y mora: corremos el cartón de cada crédito activo.
  let capitalColocado = 0;
  let carteraPorCobrar = 0;
  let porCobrarHoy = 0;
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

    // "Por cobrar HOY": la cuota que vence hoy y aún no se saldó (lo que el
    // cobrador debería juntar en el día, ≠ cartera total pendiente).
    const diaHoy = r.dias.find((d) => d.esHoy);
    if (diaHoy && diaHoy.estado !== "pagado") {
      porCobrarHoy += Math.max(0, Number(p.cuota_diaria) - diaHoy.montoPagado);
    }

    // Cuotas vencidas impagas, menos la gracia (día de desembolso + política).
    const nAtraso = r.dias.filter((d) => d.estado === "atrasado").length;
    const atrasoNeto = nAtraso - graciaMora;
    if (atrasoNeto > 0) {
      morosos++;
      // Un día atrasado siempre está impago (parcial → "pendiente"): cuota entera.
      const moraCredito = atrasoNeto * Number(p.cuota_diaria);
      montoEnMora += moraCredito;
      const t = atrasoNeto <= 7 ? 0 : atrasoNeto <= 15 ? 1 : 2;
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
    deudoresActivos,
    creditosActivos,
    creditosFinalizados,
    incobrables,
    capitalColocado,
    carteraPorCobrar,
    porCobrarHoy,
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

/** Suma los pagos vigentes registrados desde un instante ISO.
 *  A ESCALA: agrega en la base (RPC 0039), no trae las filas (que se truncarían
 *  a 1000). Respeta RLS (no es SECURITY DEFINER). */
async function sumarPagosDesde(
  db: SupabaseClient,
  desdeIso: string,
): Promise<number> {
  const { data, error } = await db.rpc("app_suma_pagos_desde", { desde: desdeIso });
  if (error) throw error;
  return Number(data ?? 0);
}
