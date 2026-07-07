// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — FICHA COMPLETA del cliente (panel admin/supervisor).
//  Junta en un solo objeto: datos, calificación/score, crédito activo + cartón
//  real, mora, historial de pagos y de créditos, y notas. Reusa los núcleos ya
//  testeados (cartón, scoring). Corre como gestor (RLS ve todo).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cliente, Prestamo } from "@/types/db";
import type { DiaEstado } from "@/types/cartones";
import type { ResultadoScore } from "@/types/scoring";
import type { NotaClienteVista } from "./notas";
import { getClientePorId } from "./clientes";
import { getHistorialCrediticio } from "./scoring";
import { getConfigScoring } from "./scoringConfig";
import { getNotasCliente } from "./notas";
import { calcularEstadosCarton } from "@/lib/cartones";
import { calcularScore, evolucionScore, type PuntoEvolucion } from "@/lib/scoring";
import { hoyUY } from "@/lib/fecha";

export interface PagoFicha {
  id: string;
  fecha: string;
  monto: number;
  dia: number;
  registradoPor: string | null;
}
export interface CreditoFicha {
  id: string;
  monto: number;
  cuota: number;
  totalDias: number;
  fechaInicio: string;
  estado: Prestamo["estado"];
  pagadoTotal: number;
}
export interface CreditoActivoFicha {
  saldo: number;
  deudaVencida: number;
  diasAtraso: number;
  pagados: number;
  totalDias: number;
  progresoPct: number;
  proximaFecha: string | null;
  dias: DiaEstado[];
  cuota: number;
}
export interface FichaCliente {
  cliente: Cliente;
  score: ResultadoScore;
  /** Serie histórica del puntaje (derivada, mensual). */
  evolucionScore: PuntoEvolucion[];
  activo: CreditoActivoFicha | null;
  creditos: CreditoFicha[];
  pagos: PagoFicha[];
  notas: NotaClienteVista[];
}

export async function getFichaCliente(
  db: SupabaseClient,
  id: string,
  hoy: Date = new Date(),
): Promise<FichaCliente | null> {
  const cliente = await getClientePorId(db, id);
  if (!cliente) return null;

  const hoyCal = hoyUY(hoy);
  const [historial, configScoring] = await Promise.all([
    getHistorialCrediticio(db, id),
    getConfigScoring(db),
  ]);
  const score = calcularScore({ ...historial, hoy: hoyCal }, configScoring);
  const evolucion = evolucionScore({ ...historial, hoy: hoyCal }, { config: configScoring });

  // Crédito activo + cartón.
  const prestamoActivo = historial.prestamos.find((p) => p.estado === "activo") ?? null;
  let activo: CreditoActivoFicha | null = null;
  if (prestamoActivo) {
    const pagos = historial.pagosPorPrestamo[prestamoActivo.id] ?? [];
    const r = calcularEstadosCarton(prestamoActivo, pagos, hoyCal);
    activo = {
      saldo: r.falta,
      deudaVencida: r.montoParaAlDia,
      diasAtraso: r.dias.filter((d) => d.estado === "atrasado").length,
      pagados: r.dias.filter((d) => d.estado === "pagado").length,
      totalDias: prestamoActivo.total_dias,
      progresoPct: r.progresoPct,
      proximaFecha: r.proxima?.fecha ?? null,
      dias: r.dias,
      cuota: prestamoActivo.cuota_diaria,
    };
  }

  // Historial de créditos (con lo pagado en cada uno).
  const creditos: CreditoFicha[] = historial.prestamos.map((p) => ({
    id: p.id,
    monto: p.monto_prestado,
    cuota: p.cuota_diaria,
    totalDias: p.total_dias,
    fechaInicio: p.fecha_inicio,
    estado: p.estado,
    pagadoTotal: (historial.pagosPorPrestamo[p.id] ?? []).reduce((s, x) => s + x.monto, 0),
  }));

  // Historial de pagos (todos los créditos), del más reciente al más viejo.
  const planos = historial.prestamos.flatMap((p) => historial.pagosPorPrestamo[p.id] ?? []);
  planos.sort((a, b) => (a.registrado_en < b.registrado_en ? 1 : -1));
  const autorIds = [...new Set(planos.map((p) => p.registrado_por).filter((x): x is string => !!x))];
  const nombres = new Map<string, string>();
  if (autorIds.length > 0) {
    const { data } = await db.from("usuarios").select("id, nombre").in("id", autorIds);
    for (const u of data ?? []) nombres.set(u.id as string, u.nombre as string);
  }
  const pagos: PagoFicha[] = planos.slice(0, 100).map((p) => ({
    id: p.id,
    fecha: p.registrado_en,
    monto: p.monto,
    dia: p.dia_credito,
    registradoPor: p.registrado_por ? (nombres.get(p.registrado_por) ?? null) : null,
  }));

  const notas = await getNotasCliente(db, id);

  return { cliente, score, evolucionScore: evolucion, activo, creditos, pagos, notas };
}
