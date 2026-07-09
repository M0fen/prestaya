// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — tipos del cálculo del cartón.
//
//  Dos capas bien separadas:
//   · NÚCLEO (lib/cartones.ts): calcula estados/totales en DATOS PLANOS,
//     sin estilos ni formato. Reutilizable en cliente, cobrador y admin.
//   · PRESENTACIÓN (lib/vistaCliente.ts): envuelve el núcleo y arma la
//     vista lista para pintar (strings formateados + estilos).
// ─────────────────────────────────────────────────────────────────────────
import type { CSSProperties } from "react";

/** Estado de un día del cartón. */
export type EstadoDia = "pagado" | "pendiente" | "atrasado" | "futuro";

// ── Salida del NÚCLEO (datos planos) ──────────────────────────────────────

/** Estado calculado de un día del crédito (sin presentación). */
export interface DiaEstado {
  /** Número de día del crédito (1..total_dias). */
  dia: number;
  /** Fecha calendario del día, ISO "YYYY-MM-DD". */
  fecha: string;
  estado: EstadoDia;
  esHoy: boolean;
  /** Monto abonado a ese día (suma de pagos vigentes). */
  montoPagado: number;
}

/** Información de la próxima cuota (primer día futuro). */
export interface ProximaCuotaInfo {
  dia: number;
  /** Fecha ISO "YYYY-MM-DD". */
  fecha: string;
  /** Días desde hoy hasta esa fecha (0 = hoy, 1 = mañana, …). */
  diasRestantes: number;
}

/** Resultado completo del cálculo del cartón, en datos planos. */
export interface ResultadoCarton {
  dias: DiaEstado[];
  /** cuota_diaria × total_dias. */
  totalAPagar: number;
  totalPagado: number;
  /** max(0, totalAPagar − totalPagado). */
  falta: number;
  /** Porcentaje entero 0..100. */
  progresoPct: number;
  /** Día que coincide con hoy (0 si hoy queda fuera del crédito). */
  diaActual: number;
  /** true si hay algún día atrasado o pendiente. */
  hayPendiente: boolean;
  /**
   * Monto que el cliente debe pagar HOY para quedar al día: la suma de lo que
   * falta en cada día ya vencido o de hoy. Si es 0, está al día.
   */
  montoParaAlDia: number;
  /** Fecha del último día del crédito, ISO "YYYY-MM-DD". */
  fechaFin: string;
  /** Racha más larga de días consecutivos pagados completos. */
  mejorRacha: number;
  /** Próxima cuota, o null si no quedan días futuros. */
  proxima: ProximaCuotaInfo | null;
}

// ── Tipos de PRESENTACIÓN (vista del cliente) ─────────────────────────────

/** Etiquetas de la unidad de la cuota según la frecuencia del crédito. Así el
 *  cliente ve "Pago semana a semana" / "Semana 3 de 10" en un crédito semanal,
 *  no "día" (el cálculo del cartón ya respeta la frecuencia). */
export interface UnidadFrecuencia {
  /** "día" / "semana" / "quincena" / "mes". */
  singular: string;
  /** "días" / "semanas" / … */
  plural: string;
  /** "día por día" / "semana a semana" / … (para el título del cartón). */
  cada: string;
  /** "Día" / "Semana" / … (para "Semana 5"). */
  ord: string;
}

/** Datos de contacto del negocio prestamista (config fija, pie de página). */
export interface Negocio {
  nombre: string;
  direccion: string;
  telefono: string;
  horario: string;
}

/** Una casilla del cartón, lista para pintar (con datos para el detalle al tocar). */
export interface DiaCarton {
  dia: number;
  estado: EstadoDia;
  esHoy: boolean;
  style: CSSProperties;
  /** Fecha larga del día, p. ej. "sábado, 14 de junio". */
  fechaLarga: string;
  /** Día de la semana (0=domingo … 6=sábado), para alinear la grilla Lun–Sáb. */
  diaSemana: number;
  /** Monto abonado ese día, formateado ("" si no hubo pago). */
  montoPagado: string;
  /** Hito visual: múltiplos de 5 y el último día (meta). */
  esHito: boolean;
  /** Es el último día del crédito (bandera de meta). */
  esMeta: boolean;
  /** Recibos del día (hora + monto), para el detalle al tocar la casilla. */
  pagos: ReciboPago[];
}

/** Un pago individual dentro del comprobante de un día. */
export interface ReciboPago {
  /** Hora del pago "HH:mm". */
  hora: string;
  /** Monto formateado en pesos. */
  monto: string;
  /** Quién registró el cobro (nombre del cobrador), o null si no consta. */
  quien?: string | null;
}

/** Un ítem del historial de pagos, listo para pintar. */
export interface HistorialItem {
  dia: number;
  /** Fecha corta en español, p. ej. "14 de junio". */
  fecha: string;
  /** Fecha larga para el comprobante, p. ej. "sábado, 14 de junio". */
  fechaLarga: string;
  /** Monto total del día, formateado, p. ej. "$20.000". */
  monto: string;
  estadoLabel: string;
  chipStyle: CSSProperties;
  /** % de la cuota del día que cubrió lo pagado (0..100, tope 100). */
  pctCuota: number;
  /** true si cubrió la cuota completa; false si fue abono parcial. */
  completa: boolean;
  /** Descuento aplicado a ese día (texto), o null si no hubo. Hoy siempre null:
   *  el modelo de pagos no registra descuentos (solo existe el recargo por mora). */
  descuento: string | null;
  /** Pagos individuales del día (comprobante). */
  pagos: ReciboPago[];
}

/** Todo lo que la vista del cliente necesita, ya formateado y con estilos. */
export interface VistaCredito {
  nombre: string;
  inicial: string;
  negocio: Negocio;
  montoPrestado: string;
  totalAPagar: string;
  totalPagado: string;
  falta: string;
  progresoTexto: string;
  progresoPct: number;
  cuotaDiaria: string;
  totalDias: number;
  diaActual: number;
  /** Etiquetas de la unidad según la frecuencia (día/semana/quincena/mes). */
  unidad: UnidadFrecuencia;
  estadoGeneral: string;
  estadoDotStyle: CSSProperties;
  barFillStyle: CSSProperties;
  proxFechaLarga: string;
  proxRelativo: string;
  /** Monto formateado para ponerse al día hoy (p. ej. "$30.000"). */
  montoParaAlDia: string;
  /** true si hay un monto vencido/de hoy por cubrir (montoParaAlDia > 0). */
  necesitaPonerseAlDia: boolean;
  /** Fecha de finalización en español, p. ej. "jueves, 2 de julio". */
  fechaFinLarga: string;
  /** true si no hay días atrasados ni pendientes. */
  alDia: boolean;
  /** true si el crédito está 100% pagado (falta 0). */
  creditoCompletado: boolean;
  /** Racha más larga de días pagados al hilo (para celebrar). */
  mejorRacha: number;
  /** Mensaje de aliento positivo, según el estado del crédito. */
  mensajeAliento: string;
  dias: DiaCarton[];
  historial: HistorialItem[];
}
