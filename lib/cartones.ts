// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — NÚCLEO del cálculo del cartón.
//
//  Portado FIEL desde la función renderVals() del diseño original, ahora
//  operando sobre los tipos REALES de la base de datos (Prestamo + Pago[]).
//  Es PURO: sin React, sin estilos, sin formato. Devuelve datos planos.
//  Se reutiliza igual en las tres interfaces (cliente, cobrador, admin).
//
//  ⚠️ MANEJA DINERO: no cambiar el orden de evaluación de estados sin tests.
// ─────────────────────────────────────────────────────────────────────────
import type { Pago, Prestamo } from "@/types/db";
import type { DiaEstado, EstadoDia, ResultadoCarton } from "@/types/cartones";
import { aMedianoche, parseFecha, toIso } from "./format";

/** Campos del préstamo que el cálculo necesita. */
type PrestamoCalc = Pick<
  Prestamo,
  "cuota_diaria" | "total_dias" | "fecha_inicio"
>;

/** Campos del pago que el cálculo necesita (ya filtrados: solo vigentes). */
type PagoCalc = Pick<Pago, "dia_credito" | "monto">;

/**
 * Calcula el estado de cada día del crédito y los derivados (totales,
 * progreso, próxima cuota), a partir del préstamo y sus pagos vigentes.
 *
 * @param prestamo  condiciones del crédito (cuota, días, fecha de inicio).
 * @param pagos     pagos NO anulados (un día puede tener varios → se suman).
 * @param hoy       fecha de referencia "hoy" (en prod: del servidor). Se
 *                  normaliza a medianoche para comparar solo por día.
 */
export function calcularEstadosCarton(
  prestamo: PrestamoCalc,
  pagos: PagoCalc[],
  hoy: Date,
): ResultadoCarton {
  const cuota = prestamo.cuota_diaria;
  const totalDias = prestamo.total_dias;

  // Total a pagar = cuota fija × días. El interés ya va dentro de la cuota.
  const totalAPagar = cuota * totalDias;
  const start = parseFecha(prestamo.fecha_inicio);
  // Comparamos por día: descartamos la hora de "hoy" para que `new Date()`
  // (que trae hora) funcione igual que una fecha de medianoche.
  const hoyMid = aMedianoche(hoy);

  // Suma de abonos por día (un día puede recibir varios pagos).
  const pagosPorDia: Record<number, number> = {};
  for (const p of pagos) {
    pagosPorDia[p.dia_credito] = (pagosPorDia[p.dia_credito] || 0) + p.monto;
  }

  const dias: DiaEstado[] = [];
  let totalPagado = 0;
  let diaActual = 0;

  for (let i = 0; i < totalDias; i++) {
    // Fecha calendario de este día del crédito.
    const fecha = new Date(start);
    fecha.setDate(start.getDate() + i);

    const pagado = pagosPorDia[i + 1] || 0;
    totalPagado += pagado;

    const esFuturo = fecha.getTime() > hoyMid.getTime();
    const esHoy = fecha.getTime() === hoyMid.getTime();
    if (esHoy) diaActual = i + 1;

    // Orden de evaluación CRÍTICO (no reordenar):
    //  1. fecha futura            → futuro
    //  2. pagó la cuota completa  → pagado
    //  3. pagó algo (parcial)     → pendiente (abono parcial)
    //  4. es hoy y no completó    → pendiente (HOY nunca es atrasado)
    //  5. día pasado sin pago     → atrasado
    let estado: EstadoDia;
    if (esFuturo) estado = "futuro";
    else if (pagado >= cuota) estado = "pagado";
    else if (pagado > 0) estado = "pendiente";
    else if (esHoy) estado = "pendiente";
    else estado = "atrasado";

    dias.push({
      dia: i + 1,
      fecha: toIso(fecha),
      estado,
      esHoy,
      montoPagado: pagado,
    });
  }

  // Lo que falta nunca es negativo (si pagó de más, falta = 0).
  const falta = Math.max(0, totalAPagar - totalPagado);
  const progresoPct = Math.round((totalPagado / totalAPagar) * 100);

  // Monto para ponerse al día HOY: lo que falta en cada día ya vencido o de
  // hoy (excluye los futuros, que aún no se deben). Al cubrirlo, queda al día.
  let montoParaAlDia = 0;
  for (const d of dias) {
    if (d.estado !== "futuro") {
      montoParaAlDia += Math.max(0, cuota - d.montoPagado);
    }
  }

  // Fecha del último día del crédito (finalización).
  const fin = new Date(start);
  fin.setDate(start.getDate() + (totalDias - 1));
  const fechaFin = toIso(fin);

  // Cualquier día atrasado o pendiente rompe el "al día".
  const hayPendiente = dias.some(
    (d) => d.estado === "atrasado" || d.estado === "pendiente",
  );

  // Mejor racha = corrida más larga de días pagados completos consecutivos.
  let mejorRacha = 0;
  let rachaActual = 0;
  for (const d of dias) {
    if (d.estado === "pagado") {
      rachaActual += 1;
      if (rachaActual > mejorRacha) mejorRacha = rachaActual;
    } else {
      rachaActual = 0;
    }
  }

  // Próxima cuota = primer día futuro.
  const prox = dias.find((d) => d.estado === "futuro");
  const proxima = prox
    ? {
        dia: prox.dia,
        fecha: prox.fecha,
        diasRestantes: Math.round(
          (parseFecha(prox.fecha).getTime() - hoyMid.getTime()) / 86400000,
        ),
      }
    : null;

  return {
    dias,
    totalAPagar,
    totalPagado,
    falta,
    progresoPct,
    diaActual,
    hayPendiente,
    montoParaAlDia,
    fechaFin,
    mejorRacha,
    proxima,
  };
}
