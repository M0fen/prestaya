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
import { alcanceDelActor, enLotes, prestamoIdsDelAlcance, type Alcance } from "./alcance";

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
  /** Capital entregado en créditos activos (UYU) = "Ventas Crédito". */
  capitalColocado: number;
  /** Total a cobrar (capital + interés en la cuota) = "Con Intereses". */
  totalConIntereses: number;
  /** Abonado acumulado a los créditos activos = "Recaudo" de la cartera. */
  recaudadoAcumulado: number;
  /** Saldo total por cobrar de los créditos activos (UYU) = "Cartera Pendiente". */
  carteraPorCobrar: number;
  /** Parte de la cartera correspondiente a los créditos VIP/especiales (los de
   *  los cobradores "CARTERA …": clientes grandes que Disapp no reflejaba). El
   *  resto (carteraPorCobrar − carteraVip) es la cartera OPERATIVA normal. */
  carteraVip: number;
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
  alcance?: Alcance,
): Promise<DashboardMetricas> {
  // Alcance del gestor: admin/supervisor-sin-zona → global; supervisor con zona
  // → solo su zona. Se resuelve una vez y se usa para conteos y recaudación.
  const al = alcance ?? (await alcanceDelActor());

  // 2) Créditos activos + sus pagos. A ESCALA: una sola RPC que devuelve los
  //    pagos YA AGRUPADOS por préstamo (≈2.661 filas, no ≈20k). El cartón se
  //    sigue calculando en TS. Ya viene ACOTADO a la zona si es supervisor.
  const activos = activosPre ?? (await getActivosConPagos(db, al));

  // 1) Conteos baratos (head count). Van por SERVICE_ROLE (bypass RLS) porque un
  //    count sobre 13k clientes evaluando el RLS por-fila daba statement timeout.
  //    Los anuncios son globales (no dependen de zona).
  const admin = createSupabaseAdmin();
  const anunciosActivos = await contar(admin, "anuncios", (q) => q.eq("activo", true));

  // Conteos de cartera/reportes: globales para el admin; ACOTADOS por cliente
  // (en lotes, para no exceder la URL de PostgREST) para el supervisor.
  let clientesActivos: number;
  let creditosFinalizados: number;
  let incobrables: number;
  let reportesNuevos: number;
  if (al.global) {
    [clientesActivos, creditosFinalizados, incobrables, reportesNuevos] = await Promise.all([
      contar(admin, "clientes", (q) => q.eq("activo", true)),
      contar(admin, "prestamos", (q) => q.eq("estado", "finalizado")),
      contar(admin, "prestamos", (q) => q.eq("estado", "incobrable")),
      contar(admin, "reportes", (q) => q.eq("estado", "nuevo")),
    ]);
  } else {
    // Clientes de la zona = los asignados (ya resueltos en el alcance).
    clientesActivos = al.clienteIds.length;
    // Suma de conteos por lotes de cliente (cada `.in` con ≤150 ids).
    const contarPorCliente = async (
      tabla: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filtro: (q: any) => any,
    ): Promise<number> => {
      let total = 0;
      for (const lote of enLotes(al.clienteIds))
        total += await contar(admin, tabla, (q) => filtro(q).in("cliente_id", lote));
      return total;
    };
    [creditosFinalizados, incobrables, reportesNuevos] = await Promise.all([
      contarPorCliente("prestamos", (q) => q.eq("estado", "finalizado")),
      contarPorCliente("prestamos", (q) => q.eq("estado", "incobrable")),
      contarPorCliente("reportes", (q) => q.eq("estado", "nuevo")),
    ]);
  }
  // Créditos activos = los que ya trajimos (coherente con la cartera/mora de abajo).
  const creditosActivos = activos.length;
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
  let totalConIntereses = 0;
  let recaudadoAcumulado = 0;
  let carteraPorCobrar = 0;
  let carteraVip = 0;
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
    totalConIntereses += r.totalAPagar;
    recaudadoAcumulado += r.totalPagado;
    // VIP/especial = créditos de los cobradores "CARTERA …" (los 3 grandes que
    // Disapp no reflejaba). El resto es la cartera operativa normal.
    if (/^CARTERA\b/i.test(p.cobrador_nombre ?? "")) carteraVip += r.falta;

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

  // 4) Recaudación de hoy y del mes (hora de Uruguay). Acotada a la zona del
  //    supervisor (por préstamo) o global para el admin.
  const prestamoSet = await prestamoIdsDelAlcance(al);
  const [recaudadoHoy, recaudadoMes] = await Promise.all([
    sumarPagosDesde(db, inicioDiaUYIso(hoy), prestamoSet, hoy),
    sumarPagosDesde(db, inicioMesUYIso(hoy), prestamoSet, hoy),
  ]);

  return {
    clientesActivos,
    deudoresActivos,
    creditosActivos,
    creditosFinalizados,
    incobrables,
    capitalColocado,
    totalConIntereses,
    recaudadoAcumulado,
    carteraPorCobrar,
    carteraVip,
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
 *  · Global (prestamoSet null): agrega en la base (RPC 0039), no trae filas.
 *  · Acotado (supervisor): trae los pagos del rango con la RPC de recaudos
 *    (definer, jsonb sin tope de 1000) y suma SOLO los de préstamos de la zona.
 *  Respeta la verdad del libro de pagos (no muta nada). */
async function sumarPagosDesde(
  db: SupabaseClient,
  desdeIso: string,
  prestamoSet?: Set<string> | null,
  hoy: Date = new Date(),
): Promise<number> {
  if (!prestamoSet) {
    const { data, error } = await db.rpc("app_suma_pagos_desde", { desde: desdeIso });
    if (error) throw error;
    return Number(data ?? 0);
  }
  if (prestamoSet.size === 0) return 0;
  const { data, error } = await db.rpc("app_recaudos_rango", {
    desde: desdeIso,
    hasta: hoy.toISOString(),
    vendedor: null,
  });
  if (error) throw error;
  const pagos = ((data as { pagos?: { prestamo_id: string; monto: number }[] } | null)?.pagos) ?? [];
  let suma = 0;
  for (const p of pagos) if (prestamoSet.has(p.prestamo_id)) suma += Number(p.monto);
  return suma;
}
