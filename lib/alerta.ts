// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — NÚCLEO de la ALERTA TEMPRANA de mora (uso interno).
//
//  Detecta clientes que se están yendo a mora ANTES del castigo, a partir del
//  cartón del crédito activo. Es PURO (sin React/IO), explicable y AJUSTABLE:
//  cambiar los pesos/umbrales de abajo cambia el modelo; los tests lo fijan.
//
//  Reutiliza el mismo núcleo del cartón (calcularEstadosCarton): la alerta ve
//  exactamente la misma verdad que el cliente y el cobrador.
//
//  ⚠️ DECIDE PRIORIDAD DE COBRO (a quién visitar hoy): no tocar sin tests.
// ─────────────────────────────────────────────────────────────────────────
import type { Pago, Prestamo } from "@/types/db";
import type {
  MotivoRiesgo,
  NivelRiesgo,
  ResultadoAlerta,
  TendenciaMora,
} from "@/types/alerta";
import { calcularEstadosCarton } from "./cartones";
import { parseFecha, aMedianoche } from "./format";

// ── Parámetros del modelo (AJUSTABLES) ─────────────────────────────────────
/** Pesos de cada señal de riesgo. Deben sumar 1. */
export const PESOS_RIESGO = {
  racha: 0.35, // días seguidos sin cubrir → momentum (lo que más importa)
  recencia: 0.3, // días desde el último abono
  atrasos: 0.2, // días vencidos acumulados
  deterioro: 0.15, // caída del cumplimiento reciente vs. global
} as const;

/** Racha de atraso que satura la señal (días seguidos sin cubrir). */
const RACHA_CRITICA = 5;
/** Días sin pagar que saturan la señal de recencia. */
const RECENCIA_CRITICA = 7;
/** Atrasos totales que saturan la señal acumulada. */
const ATRASOS_CRITICO = 8;
/** Días exigibles observados en la ventana reciente. */
const VENTANA_RECIENTE = 6;
/** Mínimo de días exigibles para confiar en la alerta. */
const MIN_DIAS_EXIGIBLES = 3;

/** Umbrales de nivel sobre el puntaje de riesgo 0..100. */
const UMBRAL_CRITICO = 70;
const UMBRAL_ALTO = 45;
const UMBRAL_MEDIO = 20;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface EntradaAlerta {
  /** Préstamo ACTIVO del cliente. */
  prestamo: Pick<Prestamo, "cuota_diaria" | "total_dias" | "fecha_inicio"> & {
    frecuencia?: Prestamo["frecuencia"];
  };
  /** Pagos vigentes (no anulados) del préstamo. */
  pagos: Pick<Pago, "dia_credito" | "monto">[];
  /** "Hoy" de referencia (en prod: hora de Uruguay). */
  hoy?: Date;
}

/**
 * Calcula el riesgo de mora de un crédito activo: puntaje 0..100, nivel,
 * tendencia, motivos legibles y acción sugerida. Todo derivado del cartón.
 */
export function calcularAlertaMora({
  prestamo,
  pagos,
  hoy = new Date(),
}: EntradaAlerta): ResultadoAlerta {
  const cuota = prestamo.cuota_diaria;
  const r = calcularEstadosCarton(prestamo, pagos, hoy);
  const hoyMid = aMedianoche(hoy);

  // Solo cuenta lo ya exigible (vencido o de hoy); los futuros no se deben.
  const exigibles = r.dias.filter((d) => d.estado !== "futuro");
  const diasExigibles = exigibles.length;
  const datosSuficientes = diasExigibles >= MIN_DIAS_EXIGIBLES;

  // ── Señales crudas ───────────────────────────────────────────────────────
  const atrasosTotales = exigibles.filter((d) => d.estado === "atrasado").length;

  // Racha = días seguidos sin cubrir la cuota, contando desde el último
  // exigible hacia atrás. HOY (aún pendiente, no vencido) no rompe ni suma.
  let rachaAtraso = 0;
  for (let i = exigibles.length - 1; i >= 0; i--) {
    const d = exigibles[i];
    if (d.esHoy && d.estado !== "atrasado") continue; // hoy todavía no vence
    if (d.montoPagado >= cuota) break; // cubrió: se corta la racha
    rachaAtraso++;
  }

  // Recencia: días calendario desde el último día con abono. Sin abonos aún,
  // se mide desde el inicio del crédito.
  const ultimoConPago = [...exigibles].reverse().find((d) => d.montoPagado > 0);
  const refUltimo = ultimoConPago
    ? parseFecha(ultimoConPago.fecha)
    : parseFecha(prestamo.fecha_inicio);
  const diasSinPagar = Math.max(
    0,
    Math.round((hoyMid.getTime() - refUltimo.getTime()) / 86400000),
  );

  const deudaVencida = r.montoParaAlDia;

  // Cumplimiento global de lo exigible.
  const exigidoTotal = diasExigibles * cuota;
  const cubiertoTotal = Math.max(0, exigidoTotal - deudaVencida);
  const cumplimiento = exigidoTotal > 0 ? cubiertoTotal / exigidoTotal : 1;

  // Cumplimiento en la ventana reciente (últimos VENTANA_RECIENTE exigibles).
  const ventana = exigibles.slice(-VENTANA_RECIENTE);
  let cubiertoRec = 0;
  let exigidoRec = 0;
  for (const d of ventana) {
    cubiertoRec += Math.min(d.montoPagado, cuota);
    exigidoRec += cuota;
  }
  const cumplimientoReciente = exigidoRec > 0 ? cubiertoRec / exigidoRec : 1;

  // Crédito EXACTAMENTE al día (nada vencido, 0 atrasos exigibles). Para un crédito
  // NO-diario (semanal/quincenal/mensual) `diasSinPagar` crece hasta el próximo
  // vencimiento aunque pague EN FECHA, así que la recencia por días calendario lo
  // marcaría "en riesgo" siendo sano. Si está al día no se puntúa recencia.
  const alDia = deudaVencida <= 0.5 && atrasosTotales === 0;

  // ── Señales normalizadas 0..1 (1 = peor) ─────────────────────────────────
  const sRacha = clamp01(rachaAtraso / RACHA_CRITICA);
  const sRecencia = alDia ? 0 : clamp01(diasSinPagar / RECENCIA_CRITICA);
  const sAtrasos = clamp01(atrasosTotales / ATRASOS_CRITICO);
  const deterioroMag = Math.max(0, cumplimiento - cumplimientoReciente);
  const sDeterioro = clamp01(deterioroMag);

  const riesgo = Math.round(
    100 *
      (PESOS_RIESGO.racha * sRacha +
        PESOS_RIESGO.recencia * sRecencia +
        PESOS_RIESGO.atrasos * sAtrasos +
        PESOS_RIESGO.deterioro * sDeterioro),
  );

  // Sin datos suficientes no se alarma: se trata como sano hasta observar más.
  const nivel: NivelRiesgo = !datosSuficientes
    ? "sano"
    : riesgo >= UMBRAL_CRITICO
      ? "critico"
      : riesgo >= UMBRAL_ALTO
        ? "alto"
        : riesgo >= UMBRAL_MEDIO
          ? "medio"
          : "sano";

  // Tendencia: cae ≥15pts → empeorando; sube ≥15pts → mejorando; si no, estable.
  const delta = cumplimientoReciente - cumplimiento;
  const tendencia: TendenciaMora =
    delta <= -0.15 ? "empeorando" : delta >= 0.15 ? "mejorando" : "estable";

  // ── Motivos legibles (los que efectivamente pesan) ───────────────────────
  const motivos: MotivoRiesgo[] = [];
  if (rachaAtraso >= 2)
    motivos.push({
      clave: "racha",
      texto: `${rachaAtraso} días seguidos sin cubrir la cuota`,
    });
  if (!alDia && diasSinPagar >= 3)
    motivos.push({
      clave: "recencia",
      texto: ultimoConPago
        ? `${diasSinPagar} días desde el último pago`
        : `${diasSinPagar} días sin registrar ningún pago`,
    });
  if (atrasosTotales >= 3)
    motivos.push({
      clave: "atrasos",
      texto: `${atrasosTotales} cuotas vencidas en el crédito`,
    });
  if (sDeterioro >= 0.25)
    motivos.push({
      clave: "deterioro",
      texto: "El cumplimiento cayó respecto al inicio del crédito",
    });

  return {
    riesgo,
    nivel,
    tendencia,
    datosSuficientes,
    motivos,
    accionSugerida: accionDe(nivel, datosSuficientes),
    senales: {
      atrasosTotales,
      rachaAtraso,
      diasSinPagar,
      deudaVencida,
      montoVencido: r.montoVencido, // deuda vencida REAL (sin hoy), para DISPLAY/recargo
      cumplimientoPct: Math.round(cumplimiento * 100),
      cumplimientoRecientePct: Math.round(cumplimientoReciente * 100),
    },
  };
}

/** Traduce el nivel en una acción concreta para el equipo de cobranza. */
function accionDe(nivel: NivelRiesgo, datosSuficientes: boolean): string {
  if (!datosSuficientes) return "Crédito nuevo: seguir de cerca.";
  switch (nivel) {
    case "critico":
      return "Visitar hoy: riesgo de castigo.";
    case "alto":
      return "Priorizar la visita esta semana.";
    case "medio":
      return "Recordar el pago; vigilar.";
    case "sano":
    default:
      return "Al día.";
  }
}
