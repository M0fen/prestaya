// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RECAUDOS (pagos del día). Replica "Recaudos Diario" de
//  Disapp. SOLO LECTURA. Los pagos vienen de la RPC `app_recaudos_rango` (0041,
//  security definer, esquiva el tope de 1000 filas devolviendo un jsonb). El
//  SALDO pendiente de cada crédito NO se calcula en SQL: se deriva del cartón en
//  TS (verdad única). Sin N+1: se resuelven todos los saldos en un solo pase
//  sobre la cartera activa (RPC `app_cartera_activa`).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularEstadosCarton } from "@/lib/cartones";
import { getActivosConPagos, pagosDeActivo } from "./activos";
import { hoyUY } from "@/lib/fecha";

/** Un pago del listado de recaudos (crudo, tal como lo devuelve la RPC). */
interface PagoRpc {
  pago_id: string;
  registrado_en: string;
  monto: number;
  prestamo_id: string;
  disapp_credit_ref: string | null;
  total_credito: number;
  cliente_nombre: string | null;
  cliente_documento: string | null;
  cobrador_nombre: string | null;
}

interface RecaudosRpc {
  pagos: PagoRpc[];
  total_pagos: number;
  monto_total: number;
  creditos_unicos: number;
}

export interface FilaRecaudo {
  pagoId: string;
  fechaIso: string;
  monto: number;
  prestamoId: string;
  refCredito: string | null;
  totalCredito: number;
  clienteNombre: string;
  clienteDocumento: string | null;
  cobradorNombre: string | null;
  /** Saldo pendiente del crédito HOY (cartón). null = crédito histórico/finalizado. */
  saldoPendiente: number | null;
}

export interface Recaudos {
  filas: FilaRecaudo[];
  totalPagos: number;
  montoTotal: number;
  creditosUnicos: number;
}

const N = (v: unknown) => Number(v);

export async function getRecaudos(
  db: SupabaseClient,
  opts: { desde: string; hasta: string; vendedorId?: string | null; q?: string | null },
  hoy: Date = new Date(),
): Promise<Recaudos> {
  const { data, error } = await db.rpc("app_recaudos_rango", {
    desde: opts.desde,
    hasta: opts.hasta,
    vendedor: opts.vendedorId || null,
  });
  if (error) throw error;
  const rpc = (data ?? { pagos: [], total_pagos: 0, monto_total: 0, creditos_unicos: 0 }) as RecaudosRpc;

  // Saldo por crédito activo: un solo pase sobre la cartera (cartón en TS). Los
  // créditos que no estén activos (históricos/finalizados) quedan sin saldo → "—".
  const activos = await getActivosConPagos(db);
  const hoyCal = hoyUY(hoy);
  const saldoPorPrestamo = new Map<string, number>();
  for (const a of activos) {
    const carton = calcularEstadosCarton(
      {
        cuota_diaria: N(a.cuota_diaria),
        total_dias: N(a.total_dias),
        fecha_inicio: a.fecha_inicio,
        frecuencia: a.frecuencia ?? "diario",
      },
      pagosDeActivo(a),
      hoyCal,
    );
    saldoPorPrestamo.set(a.id, carton.falta);
  }

  // Filtro de texto (cliente / documento) en TS: el rango+vendedor ya acotó.
  const termino = (opts.q ?? "").trim().toLowerCase();
  let filas: FilaRecaudo[] = rpc.pagos.map((p) => ({
    pagoId: p.pago_id,
    fechaIso: p.registrado_en,
    monto: N(p.monto),
    prestamoId: p.prestamo_id,
    refCredito: p.disapp_credit_ref ?? null,
    totalCredito: N(p.total_credito),
    clienteNombre: p.cliente_nombre ?? "Cliente",
    clienteDocumento: p.cliente_documento ?? null,
    cobradorNombre: p.cobrador_nombre ?? null,
    saldoPendiente: saldoPorPrestamo.has(p.prestamo_id)
      ? saldoPorPrestamo.get(p.prestamo_id)!
      : null,
  }));

  if (termino) {
    filas = filas.filter(
      (f) =>
        f.clienteNombre.toLowerCase().includes(termino) ||
        (f.clienteDocumento ?? "").toLowerCase().includes(termino),
    );
  }

  // Si hay filtro de texto, los agregados reflejan lo FILTRADO (coherente con la
  // tabla que se ve); si no, vienen exactos de la RPC (matchean Disapp).
  if (termino) {
    const prestamos = new Set(filas.map((f) => f.prestamoId));
    return {
      filas,
      totalPagos: filas.length,
      montoTotal: filas.reduce((s, f) => s + f.monto, 0),
      creditosUnicos: prestamos.size,
    };
  }
  return {
    filas,
    totalPagos: N(rpc.total_pagos),
    montoTotal: N(rpc.monto_total),
    creditosUnicos: N(rpc.creditos_unicos),
  };
}
