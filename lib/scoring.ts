// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — NÚCLEO del scoring crediticio (uso interno: admin/supervisor).
//
//  Scorecard TRANSPARENTE (no caja negra): puntaje 0..1000 = suma ponderada de
//  factores derivados del repago propio del cliente, + penalización por
//  castigos graves. Es PURO (sin React/IO), explicable y AJUSTABLE: cambiar
//  los pesos/constantes de abajo cambia el modelo, y los tests lo fijan.
//
//  Reutiliza el mismo núcleo del cartón (calcularEstadosCarton) para medir
//  cumplimiento/mora de cada crédito con la misma verdad que ve el cliente.
//
//  ⚠️ DECIDE DINERO (cuánto y a quién prestar): no tocar la lógica sin tests.
// ─────────────────────────────────────────────────────────────────────────
import type { Pago, Prestamo } from "@/types/db";
import type {
  BandaScore,
  FactorScore,
  RecomendacionCredito,
  ResultadoScore,
} from "@/types/scoring";
import { calcularEstadosCarton, fechaDeCuota } from "./cartones";
import { parseFecha, toIso } from "./format";

// ── Parámetros del modelo (AJUSTABLES) ────────────────────────────────────
/** Pesos de cada factor. Deben sumar 1. */
export const PESOS = {
  cumplimiento: 0.35,
  moraActual: 0.25,
  experiencia: 0.15,
  consistencia: 0.15,
  antiguedad: 0.1,
} as const;

/** Créditos finalizados para considerar "experiencia plena". */
const EXPERIENCIA_PLENA = 3;
/** Meses de relación para considerar "antigüedad plena". */
const ANTIGUEDAD_PLENA_MESES = 12;
/** Días de atraso (en el activo) que llevan el factor de mora a 0. */
const DIAS_MORA_MAX = 10;
/** Mínimo de días exigibles observados para confiar en el puntaje. */
const MIN_DIAS_EXIGIBLES = 5;

/** Umbrales de banda sobre el puntaje 0..1000. */
const UMBRAL_EXCELENTE = 800;
const UMBRAL_BUENO = 650;
const UMBRAL_REGULAR = 450;

/** Config del modelo AJUSTABLE por el admin (pesos + umbrales de banda). */
export interface ConfigScoring {
  pesos: {
    cumplimiento: number;
    moraActual: number;
    experiencia: number;
    consistencia: number;
    antiguedad: number;
  };
  umbrales: { excelente: number; bueno: number; regular: number };
}

/** Config por defecto = el modelo histórico (mismos números de siempre). */
export const CONFIG_SCORING_DEFAULT: ConfigScoring = {
  pesos: {
    cumplimiento: PESOS.cumplimiento,
    moraActual: PESOS.moraActual,
    experiencia: PESOS.experiencia,
    consistencia: PESOS.consistencia,
    antiguedad: PESOS.antiguedad,
  },
  umbrales: { excelente: UMBRAL_EXCELENTE, bueno: UMBRAL_BUENO, regular: UMBRAL_REGULAR },
};

/** Penalizaciones por castigos graves. */
const TECHO_SI_INCOBRABLE = 350; // un incobrable fuerza, como mucho, "riesgo"
const PENAL_POR_CANCELADO = 60; // resta por cada crédito cancelado…
const PENAL_CANCELADO_MAX = 150; // …con tope.

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const redondearMil = (x: number) => Math.round(x / 1000) * 1000;

/** Fecha de referencia para evaluar un crédito: hoy si está activo; si está
 *  cerrado, un día después del último día programado (todo queda "maduro"). */
function referenciaDe(p: Prestamo, hoy: Date): Date {
  if (p.estado === "activo") return hoy;
  if (p.total_dias < 1) return hoy; // crédito inválido: sin cuotas, no maduramos nada
  const start = parseFecha(p.fecha_inicio);
  // Un día DESPUÉS del ÚLTIMO día PROGRAMADO, con el MISMO calendario que el cartón
  // (días hábiles Lun–Sáb, domingos corridos; semanal/mensual por su paso). Con días
  // CALENDARIO la última semana de cuotas caía DESPUÉS de la referencia → quedaba
  // "futuro" y salía del exigible → INFLABA el cumplimiento de un crédito ya cerrado.
  const fin = fechaDeCuota(start, p.total_dias - 1, p.frecuencia ?? "diario");
  const ref = new Date(fin);
  ref.setDate(fin.getDate() + 1);
  return ref;
}

export interface EntradaScoring {
  /** Todos los préstamos del cliente (cualquier estado). */
  prestamos: Prestamo[];
  /** Pagos vigentes (no anulados) por prestamo_id. */
  pagosPorPrestamo: Record<string, Pago[]>;
  /** "Hoy" de referencia (en prod: del servidor). */
  hoy?: Date;
}

/**
 * Calcula el puntaje crediticio de un cliente a partir de su historial de
 * préstamos y pagos. Devuelve puntaje, banda, desglose explicable y una
 * recomendación de renovación con monto sugerido.
 */
export function calcularScore(
  { prestamos, pagosPorPrestamo, hoy = new Date() }: EntradaScoring,
  config: ConfigScoring = CONFIG_SCORING_DEFAULT,
): ResultadoScore {
  // Acumuladores sobre todo el historial.
  let sumExigible = 0; // $ que debió pagar a la fecha (sin contar futuros)
  let sumPagadoExigible = 0; // $ de lo exigible efectivamente cubierto
  let sumDiasExigibles = 0; // días ya vencidos o de hoy
  let sumDiasPagados = 0; // días con la cuota completa al día
  let diasAtrasoActual = 0;
  let tieneActivo = false;

  let finalizados = 0;
  let incobrables = 0;
  let cancelados = 0;

  for (const p of prestamos) {
    if (p.estado === "finalizado") finalizados++;
    else if (p.estado === "incobrable") incobrables++;
    else if (p.estado === "cancelado") cancelados++;

    const pagos = pagosPorPrestamo[p.id] ?? [];
    const r = calcularEstadosCarton(p, pagos, referenciaDe(p, hoy));

    const diasNoFuturo = r.dias.filter((d) => d.estado !== "futuro");
    const exigible = diasNoFuturo.length * p.cuota_diaria;
    // montoParaAlDia = lo que falta de lo exigible → cubierto = exigible − faltante.
    const cubierto = Math.max(0, exigible - r.montoParaAlDia);

    sumExigible += exigible;
    sumPagadoExigible += cubierto;
    sumDiasExigibles += diasNoFuturo.length;
    sumDiasPagados += r.dias.filter((d) => d.estado === "pagado").length;

    if (p.estado === "activo") {
      tieneActivo = true;
      // Con VARIOS créditos activos (0037) manda el PEOR: antes esto REASIGNABA, así que
      // ganaba el último iterado y un activo sano podía TAPAR la mora de otro atrasado.
      diasAtrasoActual = Math.max(
        diasAtrasoActual,
        r.dias.filter((d) => d.estado === "atrasado").length,
      );
    }
  }

  // ── Sub-puntajes 0..1 ────────────────────────────────────────────────────
  const cumplimiento = sumExigible > 0 ? clamp01(sumPagadoExigible / sumExigible) : 0;
  const consistencia = sumDiasExigibles > 0 ? clamp01(sumDiasPagados / sumDiasExigibles) : 0;
  const experiencia = clamp01(finalizados / EXPERIENCIA_PLENA);
  // Sin crédito activo no hay mora vigente: el factor no penaliza.
  const moraActual = tieneActivo ? clamp01(1 - diasAtrasoActual / DIAS_MORA_MAX) : 1;

  // Antigüedad: meses desde el primer préstamo.
  const inicios = prestamos.map((p) => parseFecha(p.fecha_inicio).getTime());
  const primerInicio = inicios.length ? Math.min(...inicios) : hoy.getTime();
  const mesesComoCliente = Math.max(
    0,
    (hoy.getTime() - primerInicio) / (1000 * 60 * 60 * 24 * 30.4375),
  );
  const antiguedad = clamp01(mesesComoCliente / ANTIGUEDAD_PLENA_MESES);

  // ── Puntaje base (0..1000) ───────────────────────────────────────────────
  const aporte = {
    cumplimiento: config.pesos.cumplimiento * cumplimiento * 1000,
    moraActual: config.pesos.moraActual * moraActual * 1000,
    experiencia: config.pesos.experiencia * experiencia * 1000,
    consistencia: config.pesos.consistencia * consistencia * 1000,
    antiguedad: config.pesos.antiguedad * antiguedad * 1000,
  };
  let puntaje =
    aporte.cumplimiento +
    aporte.moraActual +
    aporte.experiencia +
    aporte.consistencia +
    aporte.antiguedad;

  // ── Penalizaciones por castigos graves ───────────────────────────────────
  const penalCancelado = Math.min(cancelados * PENAL_POR_CANCELADO, PENAL_CANCELADO_MAX);
  puntaje -= penalCancelado;
  if (incobrables > 0) puntaje = Math.min(puntaje, TECHO_SI_INCOBRABLE);
  puntaje = Math.round(Math.max(0, Math.min(1000, puntaje)));

  // ── Confiabilidad y banda ────────────────────────────────────────────────
  const datosSuficientes = sumDiasExigibles >= MIN_DIAS_EXIGIBLES;
  const banda: BandaScore = !datosSuficientes
    ? "nuevo"
    : puntaje >= config.umbrales.excelente
      ? "excelente"
      : puntaje >= config.umbrales.bueno
        ? "bueno"
        : puntaje >= config.umbrales.regular
          ? "regular"
          : "riesgo";

  // ── Desglose explicable ──────────────────────────────────────────────────
  const sentidoDe = (sub: number): FactorScore["sentido"] =>
    sub >= 0.66 ? "positivo" : sub <= 0.4 ? "negativo" : "neutro";
  const pct = (x: number) => Math.round(x * 100);

  const factores: FactorScore[] = [
    {
      clave: "cumplimiento",
      etiqueta: "Cumplimiento de pago",
      detalle: `${pct(cumplimiento)}% de lo exigible pagado`,
      puntos: Math.round(aporte.cumplimiento),
      sentido: sentidoDe(cumplimiento),
    },
    {
      clave: "mora_actual",
      etiqueta: "Mora actual",
      detalle: tieneActivo
        ? diasAtrasoActual === 0
          ? "Al día en el crédito vigente"
          : `${diasAtrasoActual} día(s) de atraso`
        : "Sin crédito activo",
      puntos: Math.round(aporte.moraActual),
      sentido: sentidoDe(moraActual),
    },
    {
      clave: "experiencia",
      etiqueta: "Experiencia",
      detalle: `${finalizados} crédito(s) finalizado(s)`,
      puntos: Math.round(aporte.experiencia),
      sentido: sentidoDe(experiencia),
    },
    {
      clave: "consistencia",
      etiqueta: "Consistencia",
      detalle: `${pct(consistencia)}% de días pagados puntuales`,
      puntos: Math.round(aporte.consistencia),
      sentido: sentidoDe(consistencia),
    },
    {
      clave: "antiguedad",
      etiqueta: "Antigüedad",
      detalle: `${Math.round(mesesComoCliente)} mes(es) como cliente`,
      puntos: Math.round(aporte.antiguedad),
      sentido: sentidoDe(antiguedad),
    },
  ];
  if (penalCancelado > 0) {
    factores.push({
      clave: "penal_cancelado",
      etiqueta: "Créditos cancelados",
      detalle: `${cancelados} cancelado(s)`,
      puntos: -penalCancelado,
      sentido: "negativo",
    });
  }
  if (incobrables > 0) {
    factores.push({
      clave: "penal_incobrable",
      etiqueta: "Crédito incobrable",
      detalle: `${incobrables} castigo(s): puntaje limitado`,
      puntos: 0,
      sentido: "negativo",
    });
  }

  // ── Recomendación ─────────────────────────────────────────────────────────
  const ultimoMonto = montoUltimoPrestamo(prestamos);
  const recomendacion = recomendar(banda, datosSuficientes, ultimoMonto);

  return {
    puntaje,
    banda,
    datosSuficientes,
    factores,
    recomendacion,
    metricas: {
      creditosTotales: prestamos.length,
      creditosFinalizados: finalizados,
      incobrables,
      cancelados,
      cumplimientoPct: pct(cumplimiento),
      puntualidadPct: pct(consistencia),
      diasAtrasoActual,
      tienePrestamoActivo: tieneActivo,
      mesesComoCliente: Math.round(mesesComoCliente),
    },
  };
}

// ── Evolución del score en el tiempo ──────────────────────────────────────
export interface PuntoEvolucion {
  fecha: string;
  puntaje: number;
  banda: BandaScore;
}

/**
 * Serie histórica del puntaje: recomputa el score a checkpoints MENSUALES,
 * mirando SOLO los créditos ya iniciados y los pagos ya registrados a esa
 * fecha. No guarda nada: es una derivación pura del mismo historial (mismo
 * núcleo que `calcularScore`), así la evolución nunca "miente".
 */
export function evolucionScore(
  { prestamos, pagosPorPrestamo, hoy = new Date() }: EntradaScoring,
  opts?: { puntos?: number; config?: ConfigScoring },
): PuntoEvolucion[] {
  if (prestamos.length === 0) return [];
  const maxPuntos = opts?.puntos ?? 12;

  // Checkpoints: fin de cada mes desde el primer crédito hasta hoy (hoy incluido).
  const primer = new Date(Math.min(...prestamos.map((p) => parseFecha(p.fecha_inicio).getTime())));
  const checks: Date[] = [];
  let y = primer.getFullYear();
  let m = primer.getMonth();
  const finY = hoy.getFullYear();
  const finM = hoy.getMonth();
  while (y < finY || (y === finY && m <= finM)) {
    const esMesActual = y === finY && m === finM;
    // Fin de mes (día 0 del mes siguiente) o "hoy" si es el mes en curso.
    checks.push(esMesActual ? new Date(finY, finM, hoy.getDate()) : new Date(y, m + 1, 0));
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }

  return checks.slice(-maxPuntos).map((c) => {
    const corte = new Date(c.getFullYear(), c.getMonth(), c.getDate(), 23, 59, 59).getTime();
    const prestamosHasta = prestamos.filter((p) => parseFecha(p.fecha_inicio).getTime() <= corte);
    const pagosHasta: Record<string, Pago[]> = {};
    for (const p of prestamosHasta) {
      pagosHasta[p.id] = (pagosPorPrestamo[p.id] ?? []).filter(
        (pago) => Date.parse(pago.registrado_en) <= corte,
      );
    }
    const r = calcularScore(
      { prestamos: prestamosHasta, pagosPorPrestamo: pagosHasta, hoy: c },
      opts?.config ?? CONFIG_SCORING_DEFAULT,
    );
    return { fecha: toIso(c), puntaje: r.puntaje, banda: r.banda };
  });
}

/** Monto del préstamo más reciente (por fecha de inicio), o null si no hay. */
function montoUltimoPrestamo(prestamos: Prestamo[]): number | null {
  if (prestamos.length === 0) return null;
  const ordenados = [...prestamos].sort(
    (a, b) => parseFecha(b.fecha_inicio).getTime() - parseFecha(a.fecha_inicio).getTime(),
  );
  return ordenados[0].monto_prestado;
}

/** Traduce la banda en una acción concreta de renovación + monto sugerido. */
function recomendar(
  banda: BandaScore,
  datosSuficientes: boolean,
  ultimoMonto: number | null,
): RecomendacionCredito {
  if (!datosSuficientes) {
    return {
      accion: "manual",
      montoSugerido: ultimoMonto,
      resumen: "Historial insuficiente: evaluar manualmente.",
    };
  }
  const sugerido = (factor: number): number | null =>
    ultimoMonto == null ? null : redondearMil(ultimoMonto * factor);

  switch (banda) {
    case "excelente":
      return {
        accion: "preaprobado",
        montoSugerido: sugerido(1.3),
        resumen: "Excelente pagador: renovación pre-aprobada, puede subir el monto.",
      };
    case "bueno":
      return {
        accion: "preaprobado",
        montoSugerido: sugerido(1.15),
        resumen: "Buen pagador: renovación pre-aprobada.",
      };
    case "regular":
      return {
        accion: "revisar",
        montoSugerido: sugerido(1),
        resumen: "Revisar antes de renovar; mantener el monto.",
      };
    case "riesgo":
      return {
        accion: "no_recomendado",
        montoSugerido: sugerido(0.5),
        resumen: "Riesgo alto: no renovar, o reducir y pedir garantía.",
      };
    case "nuevo":
    default:
      return {
        accion: "manual",
        montoSugerido: ultimoMonto,
        resumen: "Cliente nuevo: evaluar manualmente.",
      };
  }
}
