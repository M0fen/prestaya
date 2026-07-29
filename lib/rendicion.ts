// ─────────────────────────────────────────────────────────────────────────
//  Núcleo PURO de la RENDICIÓN de jornada. Client-safe y testeable.
//  Regla de dinero (redondeo a peso entero, sin float):
//     esperado   = max(0, base + recaudado − gastos)  → lo que debería entregar
//     diferencia = entregado − esperado                → <0 faltante · >0 sobrante
//  `base` = efectivo de arranque que el supervisor le dio al cobrador (0105); el
//  cobrador la devuelve junto con lo cobrado. base=0 (default) → conducta previa.
//  El "faltante" es la señal anti-fuga (efectivo que no cuadra).
// ─────────────────────────────────────────────────────────────────────────

export type EstadoRendicion = "cuadra" | "faltante" | "sobrante";

export interface ResultadoRendicion {
  /** Efectivo que debería entregar (base + recaudado − gastos, nunca negativo). */
  esperado: number;
  /** entregado − esperado. Negativo = falta plata. */
  diferencia: number;
  estado: EstadoRendicion;
}

export function calcularRendicion(
  recaudado: number,
  gastos: number,
  entregado: number,
  base = 0,
): ResultadoRendicion {
  const esperado = Math.max(0, Math.round(base) + Math.round(recaudado) - Math.round(gastos));
  const diferencia = Math.round(entregado) - esperado;
  const estado: EstadoRendicion =
    diferencia === 0 ? "cuadra" : diferencia < 0 ? "faltante" : "sobrante";
  return { esperado, diferencia, estado };
}

/** Etiqueta legible del estado (para la UI). */
export const ETIQUETA_ESTADO: Record<EstadoRendicion, string> = {
  cuadra: "Cuadra ✓",
  faltante: "Faltante",
  sobrante: "Sobrante",
};
