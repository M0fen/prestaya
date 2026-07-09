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
import type { FrecuenciaPrestamo, Pago, Prestamo } from "@/types/db";
import type { DiaEstado, EstadoDia, ResultadoCarton } from "@/types/cartones";
import { aMedianoche, parseFecha, toIso } from "./format";

/** Campos del préstamo que el cálculo necesita. */
type PrestamoCalc = Pick<
  Prestamo,
  "cuota_diaria" | "total_dias" | "fecha_inicio"
> & { frecuencia?: FrecuenciaPrestamo };

/** Días entre cuotas para las frecuencias de paso fijo. */
const PASO_DIAS: Record<Exclude<FrecuenciaPrestamo, "mensual">, number> = {
  diario: 1,
  semanal: 7,
  quincenal: 15,
};

/**
 * DOMINGO no es día de cobro (verificado con la data real: <0,1% de los pagos
 * caen en domingo). El cobro es de LUNES a SÁBADO (6 días/semana). Por eso:
 *  · el cronograma DIARIO avanza de a un día HÁBIL, salteando domingos;
 *  · ninguna cuota (de cualquier frecuencia) vence en domingo: si cae domingo,
 *    se corre al lunes.
 */

/**
 * Fecha de la cuota diaria número `i` (0-based) saltando domingos. O(1): calcula
 * cuántas semanas y días hábiles hay que sumar en vez de iterar (importa: se
 * llama una vez por cuota × crédito sobre toda la cartera).
 */
function fechaDiariaHabil(inicio: Date, i: number): Date {
  const d0 = new Date(inicio);
  // Si el crédito arranca un domingo, el primer día de cobro es el lunes.
  if (d0.getDay() === 0) d0.setDate(d0.getDate() + 1);
  // Posición del día de arranque dentro de la semana hábil: Lun=0 … Sáb=5.
  const pos = (d0.getDay() + 6) % 7; // d0 nunca es domingo acá
  const slot = pos + i; // índice absoluto de día hábil
  const semanas = Math.floor(slot / 6);
  const rem = slot % 6; // 0=Lun … 5=Sáb
  const dias = semanas * 7 + (rem - pos);
  const f = new Date(d0);
  f.setDate(d0.getDate() + dias);
  return f;
}

/**
 * Fecha de la cuota número `i` (0-based) contando desde `inicio`, según la
 * frecuencia. Diario avanza por días HÁBILES (Lun–Sáb); semanal/quincenal por
 * días fijos; mensual por meses calendario (con guarda para fin de mes: 31-ene
 * + 1 mes → 28/29-feb). Ninguna cuota vence en domingo (se corre al lunes).
 */
export function fechaDeCuota(
  inicio: Date,
  i: number,
  frecuencia: FrecuenciaPrestamo = "diario",
): Date {
  if (frecuencia === "diario") return fechaDiariaHabil(inicio, i);
  const f = new Date(inicio);
  if (frecuencia === "mensual") {
    f.setMonth(inicio.getMonth() + i);
    // Si el día "se pasó" (p. ej. 31 → mes sin 31), caemos al último día real.
    if (f.getDate() !== inicio.getDate()) f.setDate(0);
  } else {
    f.setDate(inicio.getDate() + i * PASO_DIAS[frecuencia]);
  }
  // Ninguna cuota se cobra en domingo: si cae domingo, se corre al lunes.
  if (f.getDay() === 0) f.setDate(f.getDate() + 1);
  return f;
}

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
  const frecuencia = prestamo.frecuencia ?? "diario";

  // Total a pagar = cuota fija × cantidad de cuotas. El interés ya va en la cuota.
  const totalAPagar = cuota * totalDias;
  const start = parseFecha(prestamo.fecha_inicio);
  // Comparamos por día: descartamos la hora de "hoy" para que `new Date()`
  // (que trae hora) funcione igual que una fecha de medianoche.
  const hoyMid = aMedianoche(hoy);

  // Total abonado al crédito. En cobro diario cada pago cubre la cuota MÁS VIEJA
  // impaga (FIFO): la plata "llena" las cuotas desde el día 1 hacia adelante. Por
  // eso el estado de cada día se deriva del ACUMULADO pagado, NO de la fecha
  // exacta de cada abono (dato que la fuente Disapp no provee de forma fiable:
  // su "Cuota #" es un snapshot, no el índice del pago). Consecuencia natural y
  // correcta: un cliente que debe N cuotas las debe "al final" — los huecos
  // (atraso) quedan en los últimos días vencidos, no salteados en el medio.
  const totalPagado = pagos.reduce((s, p) => s + p.monto, 0);

  const dias: DiaEstado[] = [];
  let diaActual = 0;

  for (let i = 0; i < totalDias; i++) {
    // Fecha calendario de esta cuota (según la frecuencia del crédito).
    const fecha = fechaDeCuota(start, i, frecuencia);

    // Cuánto de lo abonado cae en ESTE día tras llenar los i días previos (FIFO).
    // Se satura a [0, cuota]: cada día se cubre como máximo con una cuota.
    const pagado = Math.max(0, Math.min(cuota, totalPagado - i * cuota));

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
  // Guardia: si el total fuera 0 (préstamo inválido) evitamos NaN/Infinity.
  const progresoPct =
    totalAPagar > 0 ? Math.round((totalPagado / totalAPagar) * 100) : 0;

  // Monto para ponerse al día HOY: lo que falta en cada día ya vencido o de
  // hoy (excluye los futuros, que aún no se deben). Al cubrirlo, queda al día.
  let montoParaAlDia = 0;
  for (const d of dias) {
    if (d.estado !== "futuro") {
      montoParaAlDia += Math.max(0, cuota - d.montoPagado);
    }
  }

  // Fecha de la última cuota del crédito (finalización).
  const fechaFin = toIso(fechaDeCuota(start, totalDias - 1, frecuencia));

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
