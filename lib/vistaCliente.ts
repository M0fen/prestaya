// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — capa de PRESENTACIÓN de la vista del cliente.
//  Envuelve el núcleo (lib/cartones.ts) y arma la VistaCredito lista para
//  pintar: textos formateados en pesos, fechas en español y estilos inline
//  fieles al diseño original. Aquí vive TODO lo visual; el núcleo no.
// ─────────────────────────────────────────────────────────────────────────
import type { CSSProperties } from "react";
import type { Cliente, Pago, Prestamo } from "@/types/db";
import type {
  DiaCarton,
  EstadoDia,
  HistorialItem,
  Negocio,
  UnidadFrecuencia,
  VistaCredito,
} from "@/types/cartones";
import type { FrecuenciaPrestamo } from "@/types/db";
import { calcularEstadosCarton } from "./cartones";
import { UYU, diasSemana, horaDe, meses, parseFecha } from "./format";

// Etiquetas de la unidad por frecuencia (el cálculo del cartón ya la respeta).
const UNIDADES: Record<FrecuenciaPrestamo, UnidadFrecuencia> = {
  diario: { singular: "día", plural: "días", cada: "día por día", ord: "Día" },
  semanal: { singular: "semana", plural: "semanas", cada: "semana a semana", ord: "Semana" },
  quincenal: { singular: "quincena", plural: "quincenas", cada: "quincena a quincena", ord: "Quincena" },
  mensual: { singular: "mes", plural: "meses", cada: "mes a mes", ord: "Mes" },
};

// Colores de fondo/texto por estado. Tono AMABLE para la vista de cliente:
// el día vencido sin pago usa un rojo suave (#E06A6A), no el rojo de alarma.
const COLORS: Record<EstadoDia, { bg: string; text: string }> = {
  pagado: { bg: "#1FA971", text: "#FFFFFF" },
  pendiente: { bg: "#E8A317", text: "#FFFFFF" },
  atrasado: { bg: "#E06A6A", text: "#FFFFFF" },
  futuro: { bg: "#EEF1F8", text: "#9AA3BC" },
};

// Etiquetas legibles por estado. Sin culpa: el día vencido es "Pendiente",
// no "No pagado" (ver regla de tono amable en el SKILL).
const LABELS: Record<EstadoDia, string> = {
  pagado: "Pagado",
  pendiente: "Abono parcial",
  atrasado: "Pendiente",
  futuro: "Próximo",
};

/** Estilo de una celda del cartón según su estado. */
function celdaStyle(estado: EstadoDia, esHoy: boolean): CSSProperties {
  const col = COLORS[estado];
  return {
    aspectRatio: "1 / 1",
    borderRadius: "14px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: col.bg,
    color: col.text,
    fontVariantNumeric: "tabular-nums",
    position: "relative",
    border: estado === "futuro" ? "1px solid #E4E8F4" : "none",
    // Día de hoy: doble anillo (blanco + color del estado) para destacarlo.
    boxShadow: esHoy
      ? "0 0 0 3px #FFFFFF, 0 0 0 6px " + col.bg
      : estado === "futuro"
        ? "none"
        : "0 1px 2px rgba(15,27,61,0.07)",
  };
}

/** Estilo del chip de estado en el historial. */
function chipStyle(estado: EstadoDia): CSSProperties {
  return {
    fontSize: "11.5px",
    fontWeight: "700",
    padding: "5px 11px",
    borderRadius: "999px",
    whiteSpace: "nowrap",
    // Chip verde si quedó pagado, ámbar para abono parcial.
    background: estado === "pagado" ? "#E7F6EF" : "#FBF1DC",
    color: estado === "pagado" ? "#157A50" : "#9A6A0E",
  };
}

/** Fecha ISO "YYYY-MM-DD" → "14 de junio". */
function fechaCorta(iso: string): string {
  const f = parseFecha(iso);
  return f.getDate() + " de " + meses[f.getMonth()];
}

/** Fecha ISO "YYYY-MM-DD" → "sábado, 14 de junio". */
function fechaLargaDe(iso: string): string {
  const f = parseFecha(iso);
  return (
    diasSemana[f.getDay()] + ", " + f.getDate() + " de " + meses[f.getMonth()]
  );
}

/**
 * Construye la vista completa del crédito para el cliente.
 * Llama al núcleo (cálculo puro) y le añade formato y estilos.
 */
export function construirVistaCliente(params: {
  cliente: Pick<Cliente, "nombre">;
  prestamo: Prestamo;
  pagos: Pago[];
  negocio: Negocio;
  hoy: Date;
  /** Nombre del cobrador por usuarios.id (para mostrar "quién cobró"). */
  nombresCobrador?: Record<string, string>;
}): VistaCredito {
  const { cliente, prestamo, pagos, negocio, hoy, nombresCobrador = {} } = params;

  const r = calcularEstadosCarton(prestamo, pagos, hoy);

  // Pagos individuales por día, para el comprobante (recibo).
  const pagosPorDia: Record<number, typeof pagos> = {};
  for (const p of pagos) {
    (pagosPorDia[p.dia_credito] ??= []).push(p);
  }
  const recibosDia = (dia: number) =>
    (pagosPorDia[dia] ?? [])
      .slice()
      .sort((a, b) => a.registrado_en.localeCompare(b.registrado_en))
      .map((p) => ({
        hora: horaDe(p.registrado_en),
        monto: UYU(p.monto),
        quien: p.registrado_por ? (nombresCobrador[p.registrado_por] ?? null) : null,
      }));

  // Casillas del cartón con su estilo + datos para el detalle al tocar.
  const dias: DiaCarton[] = r.dias.map((d) => ({
    dia: d.dia,
    estado: d.estado,
    esHoy: d.esHoy,
    style: celdaStyle(d.estado, d.esHoy),
    fechaLarga: fechaLargaDe(d.fecha),
    montoPagado: d.montoPagado > 0 ? UYU(d.montoPagado) : "",
    esHito: d.dia % 5 === 0 || d.dia === prestamo.total_dias,
    esMeta: d.dia === prestamo.total_dias,
    pagos: recibosDia(d.dia),
  }));

  // Historial: días con pago, del más reciente al más antiguo.
  const historial: HistorialItem[] = r.dias
    .filter((d) => d.montoPagado > 0)
    .reverse()
    .map((d) => ({
      dia: d.dia,
      fecha: fechaCorta(d.fecha),
      fechaLarga: fechaLargaDe(d.fecha),
      monto: UYU(d.montoPagado),
      estadoLabel: LABELS[d.estado],
      chipStyle: chipStyle(d.estado),
      // Recibos: cada pago del día (hora, monto y quién cobró).
      pagos: recibosDia(d.dia),
    }));

  // Próxima cuota: fecha larga y texto relativo.
  let proxFechaLarga = "";
  let proxRelativo = "";
  if (r.proxima) {
    const f = parseFecha(r.proxima.fecha);
    proxFechaLarga =
      diasSemana[f.getDay()] + ", " + f.getDate() + " de " + meses[f.getMonth()];
    const diff = r.proxima.diasRestantes;
    proxRelativo =
      diff <= 0 ? "Hoy" : diff === 1 ? "Mañana" : "En " + diff + " días";
  }

  // Fecha de finalización en español ("jueves, 2 de julio").
  const fFin = parseFecha(r.fechaFin);
  const fechaFinLarga =
    diasSemana[fFin.getDay()] +
    ", " +
    fFin.getDate() +
    " de " +
    meses[fFin.getMonth()];

  const inicial = (cliente.nombre.trim().charAt(0) || "").toUpperCase();
  const alDia = !r.hayPendiente;
  const estadoGeneral = alDia ? "Estás al día" : "Tienes pagos pendientes";
  const estadoDot = alDia ? "#34E0A1" : "#FFC24B";

  // Mensaje de aliento: framing positivo, anclado a un logro (nunca culpa).
  let mensajeAliento: string;
  if (alDia) {
    mensajeAliento = "¡Vas excelente! Estás al día 🎉";
  } else if (r.progresoPct >= 50) {
    mensajeAliento = `¡Ya vas ${r.progresoPct}% de tu meta! Sigamos al día 💪`;
  } else {
    mensajeAliento = "Vas por buen camino, pongámonos al día juntos 💪";
  }

  return {
    nombre: cliente.nombre,
    inicial,
    negocio,
    montoPrestado: UYU(prestamo.monto_prestado),
    totalAPagar: UYU(r.totalAPagar),
    totalPagado: UYU(r.totalPagado),
    falta: UYU(r.falta),
    progresoTexto: r.progresoPct + "%",
    progresoPct: r.progresoPct,
    cuotaDiaria: UYU(prestamo.cuota_diaria),
    totalDias: prestamo.total_dias,
    diaActual: r.diaActual,
    unidad: UNIDADES[prestamo.frecuencia] ?? UNIDADES.diario,
    estadoGeneral,
    estadoDotStyle: {
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      display: "block",
      flexShrink: 0,
      background: estadoDot,
    },
    barFillStyle: {
      width: r.progresoPct + "%",
      height: "100%",
      borderRadius: "999px",
      background: "linear-gradient(90deg,#34E0A1,#1FA971)",
    },
    proxFechaLarga,
    proxRelativo,
    montoParaAlDia: UYU(r.montoParaAlDia),
    necesitaPonerseAlDia: r.montoParaAlDia > 0,
    fechaFinLarga,
    alDia,
    creditoCompletado: r.falta === 0,
    mejorRacha: r.mejorRacha,
    mensajeAliento,
    dias,
    historial,
  };
}
