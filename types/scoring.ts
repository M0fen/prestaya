// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — tipos del SCORING crediticio (uso interno: admin/supervisor).
//
//  El puntaje NO se le muestra al cliente. Es una herramienta de decisión:
//  a quién renovar, cuánto prestar, a quién revisar. Se calcula con el dato
//  de repago propio (lib/scoring.ts), es 100% explicable y ajustable.
// ─────────────────────────────────────────────────────────────────────────

/** Banda del puntaje. Coincide 1:1 con `Calificacion` para reusar colores/UX. */
export type BandaScore = "nuevo" | "excelente" | "bueno" | "regular" | "riesgo";

/** Acción sugerida para el próximo crédito del cliente. */
export type AccionRenovacion =
  | "preaprobado"
  | "revisar"
  | "no_recomendado"
  | "manual";

/** Un factor del puntaje, con su aporte en puntos (para mostrar el desglose). */
export interface FactorScore {
  /** Clave estable, p. ej. "cumplimiento". */
  clave: string;
  /** Etiqueta para la UI, p. ej. "Cumplimiento de pago". */
  etiqueta: string;
  /** Detalle legible, p. ej. "96% de lo exigible pagado". */
  detalle: string;
  /** Aporte al puntaje, en puntos (puede ser negativo). */
  puntos: number;
  sentido: "positivo" | "negativo" | "neutro";
}

/** Recomendación de crédito derivada de la banda. */
export interface RecomendacionCredito {
  accion: AccionRenovacion;
  /** Monto sugerido para el próximo crédito (UYU), o null si no hay base. */
  montoSugerido: number | null;
  /** Texto breve para el operador. */
  resumen: string;
}

/** Métricas crudas, útiles para ordenar/filtrar la tabla del panel. */
export interface MetricasScore {
  creditosTotales: number;
  creditosFinalizados: number;
  incobrables: number;
  cancelados: number;
  /** % de lo exigible que pagó (0..100). */
  cumplimientoPct: number;
  /** % de días pagados completos y puntuales (0..100). */
  puntualidadPct: number;
  /** Días de atraso en el crédito activo (0 si está al día o no tiene). */
  diasAtrasoActual: number;
  tienePrestamoActivo: boolean;
  mesesComoCliente: number;
}

/** Resultado completo del scoring de un cliente. */
export interface ResultadoScore {
  /** Puntaje 0..1000. */
  puntaje: number;
  banda: BandaScore;
  /** false si hay poca historia: el puntaje es poco confiable (tratar como nuevo). */
  datosSuficientes: boolean;
  /** Desglose explicable (para mostrar el "porqué" al admin/supervisor). */
  factores: FactorScore[];
  recomendacion: RecomendacionCredito;
  metricas: MetricasScore;
}
