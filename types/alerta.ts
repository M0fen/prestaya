// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — tipos de la ALERTA TEMPRANA de mora (uso interno: admin/coord).
//
//  A diferencia del scoring (mira TODO el historial para decidir a quién
//  prestar), la alerta mira el crédito ACTIVO y su momentum reciente para
//  avisar ANTES de que un cliente se vuelva incobrable: a quién visitar HOY.
//  Es 100% derivada del comportamiento de pago (no dato externo), explicable.
// ─────────────────────────────────────────────────────────────────────────

/** Nivel de riesgo de mora, de menor a mayor urgencia. */
export type NivelRiesgo = "sano" | "medio" | "alto" | "critico";

/** Tendencia del cumplimiento reciente vs. el global del crédito. */
export type TendenciaMora = "mejorando" | "estable" | "empeorando";

/** Un motivo legible que empuja el riesgo (para mostrar el "porqué"). */
export interface MotivoRiesgo {
  clave: string;
  /** Texto corto para el operador, p. ej. "5 días seguidos sin cubrir". */
  texto: string;
}

/** Señales crudas de la mora, útiles para ordenar/filtrar. */
export interface SenalesMora {
  /** Días vencidos sin cubrir la cuota (total del crédito activo). */
  atrasosTotales: number;
  /** Días seguidos sin cubrir la cuota, contando desde el último exigible. */
  rachaAtraso: number;
  /** Días calendario desde el último abono (recencia). */
  diasSinPagar: number;
  /** $ para ponerse al día hoy — INCLUYE la cuota de hoy (lente de riesgo, no display). */
  deudaVencida: number;
  /** Deuda VENCIDA real: EXCLUYE la cuota de hoy (regla de oro). Para DISPLAY y recargo. */
  montoVencido: number;
  /** % de lo exigible pagado en todo el crédito (0..100). */
  cumplimientoPct: number;
  /** % de lo exigible pagado en la ventana reciente (0..100). */
  cumplimientoRecientePct: number;
}

/** Resultado de la alerta de mora para un crédito activo. */
export interface ResultadoAlerta {
  /** Puntaje de riesgo 0..100 (mayor = peor). */
  riesgo: number;
  nivel: NivelRiesgo;
  tendencia: TendenciaMora;
  /** false si el crédito es muy nuevo para juzgarlo (pocos días exigibles). */
  datosSuficientes: boolean;
  motivos: MotivoRiesgo[];
  /** Acción sugerida al equipo, p. ej. "Visitar hoy". */
  accionSugerida: string;
  senales: SenalesMora;
}
