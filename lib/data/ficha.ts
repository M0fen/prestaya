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

/** Días de CALENDARIO que ocupa una cuota, por frecuencia. El diario no cobra
 *  domingo (6 cuotas por semana → 7/6 de día por cuota). */
const PASO_CAL: Record<string, number> = {
  diario: 7 / 6,
  semanal: 7,
  quincenal: 15,
  mensual: 30,
};

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
  /** 'tienda' = compra financiada; 'credito' = préstamo normal (0101). */
  origen: "credito" | "tienda";
  productoNombre: string | null;
  /** Crédito anterior que este renovó (linaje, 0116). null = no vino de renovación. */
  renovadoDe: string | null;
  /** De dónde salió este crédito, en criollo. Se DERIVA, no se guarda:
   *   renovacion  — nació de otro crédito del mismo cliente (`renovado_de`)
   *   venta       — se colocó de cero, con alguien que lo dio de alta
   *   tienda      — compra financiada
   *   importado   — vino de Disapp (sin autor: el empalme no setea `creado_por`) */
  tipo: "renovacion" | "venta" | "tienda" | "importado";
  /** Quién lo dio de alta (null = importado). */
  colocadoPor: string | null;
  /** Cuándo se dio de alta y cuándo se cerró (ISO). */
  creadoEn: string;
  finalizadoEn: string | null;
  /** Lo que el cliente tenía que pagar en total (cuota × cuotas). */
  totalAPagar: number;
  /** Cuántas VECES renovó hasta llegar acá: 1 = es su primer crédito de la cadena. */
  vueltaNro: number;
  /** Solo si terminó: en cuántos días CALENDARIO lo pagó, contra los que le tocaban.
   *  Es el dato que dice si conviene volver a prestarle — un crédito de 35 días
   *  pagado en 155 se ve idéntico a uno perfecto si no se mira esto. */
  diasReales: number | null;
  diasDePlazo: number | null;
}
export interface CreditoActivoFicha {
  id: string;
  saldo: number;
  deudaVencida: number;
  diasAtraso: number;
  pagados: number;
  totalDias: number;
  progresoPct: number;
  proximaFecha: string | null;
  dias: DiaEstado[];
  cuota: number;
  fechaInicio: string;
  /** Origen del crédito, para distinguir el dinero en la ficha (0101). */
  origen: "credito" | "tienda";
  productoNombre: string | null;
  /** Crédito anterior que este renovó (linaje, 0116). null = no vino de renovación. */
  renovadoDe: string | null;
}
export interface FichaCliente {
  cliente: Cliente;
  score: ResultadoScore;
  /** Serie histórica del puntaje (derivada, mensual). */
  evolucionScore: PuntoEvolucion[];
  /** Créditos activos con su cartón. Desde 0037 pueden ser VARIOS. */
  activos: CreditoActivoFicha[];
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

  // Créditos activos + cartón de cada uno (desde 0037 pueden ser varios).
  const prestamosActivos = historial.prestamos
    .filter((p) => p.estado === "activo")
    // Desempate determinista por id cuando comparten fecha_inicio: así el "principal"
    // (activos[0]) es el MISMO en cliente/cobrador/admin (evita que cada rol muestre
    // un crédito distinto por defecto ante dos activos del mismo día).
    .sort((a, b) =>
      a.fecha_inicio !== b.fecha_inicio
        ? a.fecha_inicio < b.fecha_inicio ? 1 : -1
        : a.id < b.id ? 1 : -1,
    );
  const activos: CreditoActivoFicha[] = prestamosActivos.map((pr) => {
    const pagos = historial.pagosPorPrestamo[pr.id] ?? [];
    const r = calcularEstadosCarton(pr, pagos, hoyCal);
    return {
      id: pr.id,
      saldo: r.falta,
      deudaVencida: r.montoVencido, // mora real: EXCLUYE la cuota de hoy (regla de oro)
      diasAtraso: r.dias.filter((d) => d.estado === "atrasado").length,
      pagados: r.dias.filter((d) => d.estado === "pagado").length,
      totalDias: pr.total_dias,
      // Cap 100% igual que cliente/cobrador: un sobre-pago no debe mostrar "103%".
      progresoPct: Math.min(100, r.progresoPct),
      proximaFecha: r.proxima?.fecha ?? null,
      dias: r.dias,
      cuota: pr.cuota_diaria,
      fechaInicio: pr.fecha_inicio,
      origen: pr.origen,
      productoNombre: pr.producto_nombre,
      renovadoDe: (pr.renovado_de as string | null | undefined) ?? null,
    };
  });

  // Historial de créditos (con lo pagado en cada uno).
  const creditos: CreditoFicha[] = await armarHistorialCreditos(db, historial);

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

  return { cliente, score, evolucionScore: evolucion, activos, creditos, pagos, notas };
}

/**
 * HISTORIAL DE CRÉDITOS de un cliente, con todo lo DERIVADO que hace falta para
 * decidir si conviene volver a prestarle: de dónde salió cada crédito
 * (renovación / venta nueva / tienda / importado), en qué vuelta de la cadena va,
 * quién se lo colocó, cuánto pagó y —el dato que faltaba— en cuántos días lo pagó
 * de verdad contra los que le tocaban.
 *
 * Nada de esto se guarda: se calcula desde `prestamos` + `pagos`. Por eso vale
 * igual para la oficina y para la calle, y no puede quedar desincronizado.
 */
export async function getHistorialCreditosCliente(
  db: SupabaseClient,
  clienteId: string,
): Promise<CreditoFicha[]> {
  const historial = await getHistorialCrediticio(db, clienteId);
  return armarHistorialCreditos(db, historial);
}

/** El armado en sí (lo comparten `getFichaCliente` y `getHistorialCreditosCliente`). */
async function armarHistorialCreditos(
  db: SupabaseClient,
  historial: Awaited<ReturnType<typeof getHistorialCrediticio>>,
): Promise<CreditoFicha[]> {
  // Nombres de quienes colocaron cada crédito (una sola consulta).
  const autoresCred = [
    ...new Set(
      historial.prestamos
        .map((p) => (p as { creado_por?: string | null }).creado_por)
        .filter((x): x is string => !!x),
    ),
  ];
  const nombreAutor = new Map<string, string>();
  if (autoresCred.length > 0) {
    const { data } = await db.from("usuarios").select("id, nombre").in("id", autoresCred);
    for (const u of data ?? []) nombreAutor.set(u.id as string, u.nombre as string);
  }

  // CADENA de renovaciones: cada crédito apunta a su padre por `renovado_de`. Se
  // sigue hacia atrás para saber en qué VUELTA va el cliente. Se corta a 50 saltos
  // por si un dato malo armara un ciclo (nunca debería, pero un bucle infinito acá
  // colgaría la ficha).
  const padreDe = new Map<string, string | null>(
    historial.prestamos.map((p) => [
      p.id,
      ((p as { renovado_de?: string | null }).renovado_de ?? null) as string | null,
    ]),
  );
  const vueltaDe = (id: string): number => {
    let n = 1;
    let cur = padreDe.get(id) ?? null;
    const visto = new Set<string>([id]);
    while (cur && !visto.has(cur) && n < 50) {
      visto.add(cur);
      n += 1;
      cur = padreDe.get(cur) ?? null;
    }
    return n;
  };

  return historial.prestamos.map((p) => {
    const pagosCred = historial.pagosPorPrestamo[p.id] ?? [];
    const renovadoDe = ((p as { renovado_de?: string | null }).renovado_de ?? null) as string | null;
    const creadoPor = ((p as { creado_por?: string | null }).creado_por ?? null) as string | null;
    const finalizadoEn = ((p as { finalizado_en?: string | null }).finalizado_en ??
      null) as string | null;
    // ⚠️ TIPO DERIVADO, no guardado. El orden importa: un crédito de tienda que
    // además vino de una renovación sigue siendo una compra para el cliente.
    const tipo: CreditoFicha["tipo"] =
      p.origen === "tienda"
        ? "tienda"
        : renovadoDe
          ? "renovacion"
          : creadoPor
            ? "venta"
            : "importado";
    // Días REALES de pago: del primer pago al último. Si no hay pagos, null.
    const fechas = pagosCred
      .map((x) => (x.registrado_en ? new Date(x.registrado_en).getTime() : NaN))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);
    // ⚠️ "Ya no está activo" NO es "terminó de pagar". Incluye `refinanciado` y
    // `cancelado`, que son créditos CORTADOS — y un crédito cortado a la mitad es,
    // por construcción, el que menos días de pago tiene, así que se llevaba la mejor
    // insignia de la lista: "👌 Pagó en 1 días · le tocaban 35" sobre un crédito de
    // $48.000 con $9.600 pagados. Medido: 294 de 317 refinanciados salían en verde,
    // más 740 finalizados con saldo sin cubrir. En la ÚNICA pantalla que existe para
    // decidir si conviene volver a prestarle, y esa decisión la toma un cobrador
    // solo, parado en la puerta. Los días se calculan solo si de verdad se pagó.
    const pagadoCred = pagosCred.reduce((s, x) => s + x.monto, 0);
    const totalCred = Math.round(p.cuota_diaria * p.total_dias);
    const seCubrio = pagadoCred >= totalCred - 1; // mismo umbral sub-peso del cartón
    const diasReales =
      p.estado === "finalizado" && seCubrio && fechas.length > 0
        ? Math.max(1, Math.round((fechas[fechas.length - 1] - fechas[0]) / 86_400_000) + 1)
        : null;
    return {
      id: p.id,
      monto: p.monto_prestado,
      cuota: p.cuota_diaria,
      totalDias: p.total_dias,
      fechaInicio: p.fecha_inicio,
      estado: p.estado,
      pagadoTotal: pagosCred.reduce((s, x) => s + x.monto, 0),
      origen: p.origen,
      productoNombre: p.producto_nombre,
      renovadoDe,
      tipo,
      colocadoPor: creadoPor ? (nombreAutor.get(creadoPor) ?? null) : null,
      creadoEn: (p as { creado_en?: string }).creado_en ?? p.fecha_inicio,
      finalizadoEn,
      totalAPagar: Math.round(p.cuota_diaria * p.total_dias),
      vueltaNro: vueltaDe(p.id),
      diasReales,
      // Plazo en días CALENDARIO que le tocaban. `total_dias` es la cantidad de
      // CUOTAS, no de días: un semanal de 4 cuotas son 28 días, no 4. Y el diario
      // no cobra domingo, así que 30 cuotas son ~35 días de calendario.
      diasDePlazo: p.estado !== "activo" ? Math.max(1, Math.round(p.total_dias * PASO_CAL[p.frecuencia ?? "diario"])) : null,
    };
  });

}

