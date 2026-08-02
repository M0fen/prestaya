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

/**
 * ¿El PLAZO del crédito ya venció? True si HOY es posterior a la fecha de la
 * ÚLTIMA cuota programada. Un crédito así con saldo impago es CARTERA VENCIDA
 * (deuda de gestión/castigo), NO "mora del día": si se lo contara como mora
 * seguiría sumando cuotas vencidas sin tope e infla el número. Respeta el
 * calendario hábil (Lun–Sáb), igual que el cartón. O(1).
 */
export function plazoVencido(prestamo: PrestamoCalc, hoy: Date): boolean {
  if (prestamo.total_dias < 1) return false;
  const fin = fechaDeCuota(
    parseFecha(prestamo.fecha_inicio),
    prestamo.total_dias - 1,
    prestamo.frecuencia ?? "diario",
  );
  return aMedianoche(hoy).getTime() > aMedianoche(fin).getTime();
}

/**
 * Cuántas cuotas del crédito tienen su fecha PROGRAMADA <= `hoy` (0..total_dias),
 * respetando la frecuencia (Lun–Sáb, domingos corridos). Sirve para saber cuánto
 * DEBERÍA estar pago a hoy SIN recalcular el cartón completo (barato, O(cuotas
 * vencidas) por el corte temprano: las fechas son crecientes). Clave para que la
 * RUTA no trate la cuota de un crédito NO-diario como si venciera todos los días.
 */
export function cuotasDebidasHasta(prestamo: PrestamoCalc, hoy: Date): number {
  const total = prestamo.total_dias;
  if (total < 1) return 0;
  const inicio = parseFecha(prestamo.fecha_inicio);
  const frec = prestamo.frecuencia ?? "diario";
  const hoyMid = aMedianoche(hoy).getTime();
  let n = 0;
  for (let i = 0; i < total; i++) {
    if (aMedianoche(fechaDeCuota(inicio, i, frec)).getTime() <= hoyMid) n++;
    else break; // fechas crecientes → una vez que la cuota es futura, corto
  }
  return n;
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
/** Total a pagar de un crédito = cuota × cantidad de cuotas (el interés ya va en la
 *  cuota). Fórmula canónica, antes reescrita a mano en varios módulos (deuda #9). */
export const totalCredito = (cuotaDiaria: number, totalDias: number): number =>
  cuotaDiaria * totalDias;

/** Saldo pendiente = max(0, total − pagado). El caller elige la fuente de `pagado`
 *  (Σ pagos vigentes o la columna denormalizada `pagado_acum`) y aplica su propio
 *  redondeo si lo necesita: este helper NO redondea. Canónico (deuda #9). */
export const saldoCredito = (cuotaDiaria: number, totalDias: number, pagado: number): number =>
  Math.max(0, totalCredito(cuotaDiaria, totalDias) - pagado);

export function calcularEstadosCarton(
  prestamo: PrestamoCalc,
  pagos: PagoCalc[],
  hoy: Date,
): ResultadoCarton {
  const cuota = prestamo.cuota_diaria;
  const totalDias = prestamo.total_dias;
  const frecuencia = prestamo.frecuencia ?? "diario";

  // Total a pagar = cuota fija × cantidad de cuotas. El interés ya va en la cuota.
  const totalAPagar = totalCredito(cuota, totalDias);
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
  // Día "en curso" para el AVANCE que se muestra ("Día X/Y"): el último día cuya
  // fecha ya llegó (fecha ≤ hoy). A diferencia de diaActual (que es 0 si HOY no es
  // día de cobro, p. ej. domingo, o si el plazo venció), este refleja el progreso
  // real: sube de a uno y se queda quieto los domingos, y llega a total_dias al
  // vencer. Evita el confuso "Día 0/30".
  let diaEnCurso = 0;

  for (let i = 0; i < totalDias; i++) {
    // Fecha calendario de esta cuota (según la frecuencia del crédito).
    const fecha = fechaDeCuota(start, i, frecuencia);

    // Cuánto de lo abonado cae en ESTE día tras llenar los i días previos (FIFO).
    // Se satura a [0, cuota]: cada día se cubre como máximo con una cuota.
    const pagado = Math.max(0, Math.min(cuota, totalPagado - i * cuota));

    const esFuturo = fecha.getTime() > hoyMid.getTime();
    const esHoy = fecha.getTime() === hoyMid.getTime();
    if (esHoy) diaActual = i + 1;
    if (!esFuturo) diaEnCurso = i + 1; // última cuota cuya fecha ya llegó

    // Orden de evaluación CRÍTICO (no reordenar):
    //  1. fecha futura            → futuro
    //  2. pagó la cuota completa  → pagado
    //  3. pagó algo (parcial)     → pendiente (abono parcial)
    //  4. es hoy y no completó    → pendiente (HOY nunca es atrasado)
    //  5. día pasado sin pago     → atrasado
    let estado: EstadoDia;
    if (esFuturo) estado = "futuro";
    // `cuota > 0`: un crédito mal cargado con cuota 0 daría `0 >= 0` y pintaría TODOS
    // los días como "pagado" (parecería saldado/al día). Con la guarda cae a pendiente.
    // Tolerancia sub-peso: la cuota puede ser FRACCIONARIA (ej. 8425/24 = 351,04) pero
    // los pagos se registran ENTEROS (351) → sin esto la casilla nunca llega a "pagado"
    // y el crédito no cierra JAMÁS. El margen (<1 peso) no deja pasar un abono parcial real.
    else if (cuota > 0 && pagado >= cuota - 0.5) estado = "pagado";
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
  const falta = saldoCredito(cuota, totalDias, totalPagado);
  // Guardia: si el total fuera 0 (préstamo inválido) evitamos NaN/Infinity.
  const progresoPct =
    totalAPagar > 0 ? Math.round((totalPagado / totalAPagar) * 100) : 0;

  // Monto para ponerse al día HOY: lo que falta en cada día ya vencido o de
  // hoy (excluye los futuros, que aún no se deben). Al cubrirlo, queda al día.
  let montoParaAlDia = 0;
  // Deuda VENCIDA (mora real): igual que la anterior pero EXCLUYE la cuota de HOY
  // (regla de oro: hoy jamás está vencido). Es lo que debe mostrarse como "deuda
  // vencida" en admin/ficha/asesor — no incluir hoy, que aún no se debe.
  let montoVencido = 0;
  for (const d of dias) {
    if (d.estado !== "futuro") {
      const faltaDia = Math.max(0, cuota - d.montoPagado);
      montoParaAlDia += faltaDia;
      if (!d.esHoy) montoVencido += faltaDia;
    }
  }

  // Fecha de la última cuota del crédito (finalización). Guarda para total_dias=0
  // (crédito inválido): fechaDeCuota(start, -1) daría una fecha basura ANTES del
  // inicio → se usa el propio inicio.
  const fechaFin =
    totalDias > 0 ? toIso(fechaDeCuota(start, totalDias - 1, frecuencia)) : toIso(start);

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

  // Próxima cuota = primer día futuro AÚN NO cubierto. Si el cliente pagó por
  // adelantado, el excedente FIFO "llena" cuotas futuras (montoPagado>0 en días
  // "futuro"); saltear las ya cubiertas evita pedirle pagar de nuevo una cuota que
  // ya abonó. Misma tolerancia sub-peso que el estado "pagado".
  const prox = dias.find((d) => d.estado === "futuro" && d.montoPagado < cuota - 0.5);
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
    diaEnCurso,
    hayPendiente,
    montoParaAlDia,
    montoVencido,
    fechaFin,
    mejorRacha,
    proxima,
  };
}
