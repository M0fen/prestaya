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

/**
 * ¿La oficina le debe plata AL COBRADOR? Pasa cuando el capital que puso en la
 * calle supera lo que tenía (base + cobrado − gastos): salió de su propio bolsillo.
 *
 * ⚠️ Sin esto, el `max(0, …)` del esperado se comía la diferencia y el cierre le
 * decía "Cuadra ✓" entregando $0. Caso real del 07-08: VÍCTOR MORALEZ cobró
 * $26.980 y colocó $56.000 en 3 renovaciones → puso $29.020 de más y el acta,
 * que es inmutable, no lo iba a registrar en ningún lado.
 */
export function aFavorDelCobrador(
  recaudado: number,
  gastos: number,
  base = 0,
  colocado = 0,
): number {
  const neto =
    Math.round(base) + Math.round(recaudado) - Math.round(gastos) - Math.round(colocado);
  return neto < 0 ? -neto : 0;
}

export interface ResultadoRendicion {
  /** Efectivo que debería entregar (base + recaudado − gastos − colocado, nunca
   *  negativo). Si da negativo es porque puso capital de su bolsillo → `aFavor`. */
  esperado: number;
  /** entregado − esperado. Negativo = falta plata. */
  diferencia: number;
  estado: EstadoRendicion;
  /** Plata que la OFICINA le debe a ÉL: colocó más capital del que tenía encima.
   *  0 en el caso normal. No es un sobrante ni un faltante: es al revés. */
  aFavor: number;
}

/**
 * `retenido` (16-08, regla de Carlos: "la caja final debe aparecer TAL CUAL como
 * caja inicial del otro día"): la plata que el cobrador DECLARA que se guarda
 * para arrancar mañana. NO es faltante: es su caja de mañana. Cuadra cuando
 * entregado + retenido = esperado. Sin declararlo (retenido=0), todo lo no
 * entregado sigue siendo faltante — la señal anti-fuga no se afloja: la
 * diferencia es que ahora existe la palabra para decir "esto me lo quedo".
 */
export function calcularRendicion(
  recaudado: number,
  gastos: number,
  entregado: number,
  base = 0,
  colocado = 0,
  retenido = 0,
): ResultadoRendicion {
  const esperado = Math.max(
    0,
    Math.round(base) + Math.round(recaudado) - Math.round(gastos) - Math.round(colocado),
  );
  const diferencia = Math.round(entregado) + Math.max(0, Math.round(retenido)) - esperado;
  const estado: EstadoRendicion =
    diferencia === 0 ? "cuadra" : diferencia < 0 ? "faltante" : "sobrante";
  return { esperado, diferencia, estado, aFavor: aFavorDelCobrador(recaudado, gastos, base, colocado) };
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

/**
 * RETENIDO derivado del ACTA (la tabla no tiene columna; la nota lo cuenta en
 * criollo, este número lo reconstruye para la máquina): con esperado =
 * base+recaudado−gastos−colocado y diferencia = entregado + retenido − esperado,
 * entonces retenido = diferencia + esperado − entregado. Nunca negativo. Un
 * acta ANTERIOR al modelo (sin retenido) da 0 cuando cuadraba o −faltante,
 * que se clampa a 0 — coherente. Puro.
 */
export function retenidoDesdeActa(acta: {
  base: number;
  recaudado: number;
  gastos: number;
  entregado: number;
  colocado: number;
  diferencia: number;
}): number {
  const esperado = Math.max(
    0,
    Math.round(acta.base) + Math.round(acta.recaudado) - Math.round(acta.gastos) - Math.round(acta.colocado),
  );
  return Math.max(0, Math.round(acta.diferencia) + esperado - Math.round(acta.entregado));
}

/**
 * BASE DE MAÑANA a partir del ACTA de hoy = lo DECLARADO, no "lo que no
 * entregó" (auditoría 16-08). `cajaFinal` incluye tanto lo retenido a
 * conciencia ("me quedo para mañana", diferencia = 0) como un FALTANTE
 * (diferencia < 0). Si el faltante volviera como base, al día siguiente el
 * cierre lo prellenaría en "Me quedo" y quien se guardó plata sin declararla
 * cuadraría para siempre — la fuga anti-fraude exacta. Restar min(0, dif) deja
 * SOLO lo declarado: el faltante sigue siendo faltante (alerta viva), no base.
 * Puro y sin float.
 */
export function baseDeMananaDesdeActa(acta: {
  base: number;
  recaudado: number;
  gastos: number;
  entregado: number;
  colocado: number;
  diferencia: number;
}): number {
  return Math.max(
    0,
    cajaFinal(acta.base, acta.recaudado, acta.gastos, acta.entregado, acta.colocado) +
      Math.min(0, Math.round(acta.diferencia)),
  );
}

// ── ENTREGA DIFERIDA: qué días puede sellar la oficina ──────────────────────
//  El supervisor cierra jornadas que quedaron abiertas de días ANTERIORES.
//  Extraída a función pura (Fase 2 QA, 08-14) para que la pantalla y la Server
//  Action decidan con la MISMA regla, y para poder sellar los bordes con tests:
//   · HOY no: el cierre de hoy lo hace el cobrador desde su teléfono — dejarlo
//     acá permitiría cerrarle el día a alguien que sigue cobrando en la calle.
//   · Más de 30 días atrás no: eso ya no es operación, es arqueología — y un
//     acta fechada meses atrás mueve comisiones ya liquidadas.

export const ENTREGA_DIFERIDA_VENTANA_DIAS = 30;

export type VeredictoEntregaDiferida = { ok: true } | { ok: false; motivo: string };

/** ¿Se puede sellar la jornada de `fecha` ("YYYY-MM-DD") parados en `fechaHoy`?
 *  Comparación lexicográfica de YMD (válida para el formato ISO). Puro. */
export function puedeEntregaDiferida(
  fecha: string,
  fechaHoy: string,
  limiteYmd: string,
): VeredictoEntregaDiferida {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, motivo: "Fecha inválida." };
  if (fecha >= fechaHoy)
    return {
      ok: false,
      motivo:
        "La jornada de hoy la cierra el cobrador desde su teléfono. Acá se registran las que quedaron abiertas de días anteriores.",
    };
  if (fecha < limiteYmd)
    return { ok: false, motivo: "Esa jornada tiene más de 30 días. Resolvela con la oficina." };
  return { ok: true };
}

/** Etiqueta legible del estado (para la UI). */
export const ETIQUETA_ESTADO: Record<EstadoRendicion, string> = {
  cuadra: "Cuadra ✓",
  faltante: "Faltante",
  sobrante: "Sobrante",
};
