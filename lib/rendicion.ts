// ─────────────────────────────────────────────────────────────────────────
//  Núcleo PURO de la RENDICIÓN de jornada. Client-safe y testeable.
//  Regla de dinero (redondeo a peso entero, sin float):
//     esperado   = max(0, base + recaudado − gastos − colocado)
//     diferencia = entregado − esperado                → <0 faltante · >0 sobrante
//
//  ⚠️ `colocado` = capital que el cobrador ENTREGÓ hoy al renovar o vender en la
//  calle. Esa plata sale de su bolsillo y NO puede exigírsele de vuelta. Faltaba,
//  y el día 2 dejó a JUAN JOSÉ CASTRO sin poder cerrar: base $48.733 + cobrado
//  $38.920 = $87.653, pero había colocado $30.000 en renovaciones, así que en la
//  mano tenía $57.653 — la app le pedía $87.653 y le marcaba un faltante de
//  $30.000 que no existía.
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
  colocado = 0,
): ResultadoRendicion {
  const esperado = Math.max(
    0,
    Math.round(base) + Math.round(recaudado) - Math.round(gastos) - Math.round(colocado),
  );
  const diferencia = Math.round(entregado) - esperado;
  const estado: EstadoRendicion =
    diferencia === 0 ? "cuadra" : diferencia < 0 ? "faltante" : "sobrante";
  return { esperado, diferencia, estado };
}

/**
 * CAJA FINAL de la jornada: el efectivo que le queda al cobrador en la mano
 * después de rendir. Es la cuadra del día — y la BASE con la que amanece mañana
 * (regla de Carlos, 06-08: "que la cuadra final siempre amanezca como base
 * diaria todos los días").
 *
 *   caja final = base + recaudado − gastos − entregado
 *
 * Si entrega TODO queda en 0 y mañana arranca de cero, que es la conducta de
 * siempre. Si se guarda un float para salir a prestar, eso es su base de mañana
 * y nadie tiene que acordarse de cargarla a mano.
 *
 * Nunca negativa: entregar de más es un SOBRANTE (lo dice `diferencia`), no una
 * base en contra — arrancar el día debiendo plata no es una cosa que exista.
 * Puro y sin float.
 */
export function cajaFinal(
  base: number,
  recaudado: number,
  gastos: number,
  entregado: number,
  colocado = 0,
): number {
  return Math.max(
    0,
    Math.round(base) +
      Math.round(recaudado) -
      Math.round(gastos) -
      Math.round(colocado) -
      Math.round(entregado),
  );
}

/** Etiqueta legible del estado (para la UI). */
export const ETIQUETA_ESTADO: Record<EstadoRendicion, string> = {
  cuadra: "Cuadra ✓",
  faltante: "Faltante",
  sobrante: "Sobrante",
};
