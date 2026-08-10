// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — NÚCLEO puro de la RENOVACIÓN (cálculo de la nueva cuota).
//  Client-safe: sin React, sin IO, sin Supabase — se usa igual en el servidor
//  (alta real) y en el navegador (preview del gestor), así ambos muestran y
//  guardan EXACTAMENTE lo mismo. El cliente no puede alterar el dinero: el
//  servidor recalcula con esta misma función.
//
//  ⚠️ MANEJA DINERO: la cuota del nuevo crédito arrastra la tasa del anterior.
// ─────────────────────────────────────────────────────────────────────────

/** Términos del crédito anterior necesarios para arrastrar la tasa. */
export interface TerminosAnterior {
  /** Capital entregado (UYU). */
  monto: number;
  /** Cuota diaria (UYU). */
  cuota: number;
  totalDias: number;
}

/**
 * Tasa implícita del crédito anterior = total a pagar / capital.
 * Ej.: prestó 10.000 y devuelve 12.000 → factor 1.2.
 */
export function tasaImplicita(anterior: TerminosAnterior): number {
  if (!(anterior.monto > 0)) return 0;
  return (anterior.cuota * anterior.totalDias) / anterior.monto;
}

/**
 * Cuota diaria del nuevo crédito, arrastrando la tasa del anterior:
 *   cuota = round( monto × tasa / días ).
 * Devuelve 0 si algún término es inválido (el llamador valida > 0).
 */
export function calcularCuotaRenovacion(
  anterior: TerminosAnterior,
  montoNuevo: number,
  diasNuevo: number,
): number {
  if (!(montoNuevo > 0) || !(diasNuevo > 0)) return 0;
  const factor = tasaImplicita(anterior);
  return Math.round((montoNuevo * factor) / diasNuevo);
}

// ── Tope de AUMENTO por tramo + CAP total (money-critical) ─────────────────
//  Regla de negocio: el aumento MÁXIMO al renovar depende del monto del crédito
//  ANTERIOR, y ningún crédito puede superar el CAP total:
//    · anterior ≤ $30.000        → hasta +20%
//    · anterior $30.001–$60.000  → hasta +15%
//    · anterior $60.001–$90.000  → hasta +10%
//    · anterior > $90.000        → sin aumento (ya está cerca del cap)
//    · CAP TOTAL: ningún crédito supera $100.000.
//  El % del tramo es DURO para cobrador/supervisor; el ADMIN puede excederlo
//  (autorización directa). El CAP de $100.000 es DURO para TODOS (incl. admin).
//  Renovar por el mismo monto o por menos siempre es auto-aprobable.
export const RENOVACION_CAP_TOTAL = 100_000;

// ── Cómo se renueva (regla de Carlos, 06-08) ───────────────────────────────
//  **El crédito se REPITE EXACTAMENTE como estaba el recién terminado.** Si
//  terminó en $60.000, se renueva en $60.000 — mismo capital, mismos términos, y
//  la cuota arrastra su misma tasa (el "20%" del negocio es el INTERÉS que el
//  crédito ya trae, no un aumento del capital: 88,4% de la cartera está al 20%).
//
//  ⚠️ Yo mismo lo entendí mal el 06-08 y puse el capital +20%: a GABRIELA
//  OTONELLI, que terminó $60.000, la app le ofrecía $72.000. Repetir el crédito
//  es la conducta correcta; subirlo es una decisión de quien presta, caso por caso.
//
//  Ese aumento SÍ existe, pero como TECHO de lo que se puede subir sin pedir
//  permiso: hasta +20% lo coloca el cobrador solo, y por encima lo aprueba el admin.
export const RENOVACION_AUMENTO_PCT = 20;

/**
 * Monto que se PROPONE al renovar: **el mismo del crédito anterior**. Es la regla
 * en estado puro — la usan igual el form de la oficina y la lista de la calle, así
 * las dos muestran el mismo número. Editable en los dos lados. Puro.
 */
export function montoRenovacionSugerido(montoAnterior: number): number {
  const base = Math.round(Number(montoAnterior) || 0);
  if (!(base > 0)) return 0;
  // ⚠️ NO se recorta al CAP. Repetir un crédito heredado de $120.000 proponiendo
  // $100.000 sería REBAJARLE el capital al cliente en silencio, y "se repite tal
  // cual" es la regla. El CAP acota el capital NUEVO, no la continuidad de una
  // exposición que ya existe.
  return base;
}

/**
 * TECHO que un COBRADOR puede colocar solo, sin pedir permiso: hasta +20% sobre
 * el crédito anterior, y nunca por encima del CAP.
 *
 * OJO: NO es lo que se propone (eso es `montoRenovacionSugerido` = el mismo
 * monto). Es hasta dónde puede llegar si decide subirlo. Sin este techo, la calle
 * ofrecería un monto que el propio servidor rechaza después — justo la promesa
 * que la lista no puede romper. Puro.
 */
export function montoRenovacionAutoAprobable(montoAnterior: number): number {
  const base = Math.round(Number(montoAnterior) || 0);
  if (!(base > 0)) return 0;
  const conAumento = Math.round(base * (1 + RENOVACION_AUMENTO_PCT / 100));
  // ⚠️ REPETIR EL MISMO MONTO SIEMPRE SE APRUEBA SOLO (regla de Carlos, 07-08:
  // "la renovación va sola; solo requiere aprobación cuando sobrepasa el 20% de
  // aumento"). El `max(base, …)` es lo que lo garantiza: sin él, un crédito
  // heredado de $120.000 tenía techo $100.000 (el CAP) y renovarlo POR EL MISMO
  // MONTO se iba a la cola del admin — el cliente esperaba días por repetir lo
  // que ya tenía. El CAP sigue acotando el AUMENTO, que es para lo que está.
  return Math.max(base, Math.min(RENOVACION_CAP_TOTAL, conAumento));
}

/**
 * TECHO de una VENTA NUEVA que el cobrador coloca solo: +20% sobre el último
 * crédito del cliente, y nunca por encima del CAP.
 *
 * ⚠️ NO lleva el `max(base, …)` de `montoRenovacionAutoAprobable`: esa excepción
 * existe para la CONTINUIDAD (repetir tal cual un heredado de $120.000), no para
 * capital nuevo — el CAP acota lo que se pone en la calle de cero.
 *
 * Es la MISMA función que usan la lista de la calle (para dibujar "podés darle
 * hasta $X") y el servidor (para aceptarlo). Antes la pantalla calculaba
 * `min(CAP, round(base×1,2))` y el servidor comparaba el PORCENTAJE
 * (`aumentoPct > 20`): cuando `base×1,2` cae en …,6 o …,8 el redondeo sube un
 * peso y ese peso da 20,004% → la pantalla ofrecía exactamente el número que el
 * servidor rechazaba en rojo, delante del cliente. Una sola función, un solo
 * número. Puro.
 */
export function techoVentaNueva(montoAnterior: number): number {
  const base = Math.round(Number(montoAnterior) || 0);
  if (!(base > 0)) return 0;
  // `floor`, no `round`: el techo es una PROMESA ("podés darle hasta $X") y
  // redondeando hacia arriba se pasaba del 20% que la promesa dice. Sobre una base
  // de $8.403 el `round` ofrecía $10.084 = +20,0047%, y contra el tope del 20% eso
  // se rechaza. Un peso menos, en la dirección conservadora, y el número es exacto.
  return Math.min(RENOVACION_CAP_TOTAL, Math.floor(base * (1 + RENOVACION_AUMENTO_PCT / 100)));
}

/**
 * Monto que se PIDE cuando la renovación no se puede aprobar sola y va a la
 * oficina: el aumento que le corresponde al tramo, SIN recortar al CAP.
 *
 * Existe por los créditos heredados que ya vienen por encima del tope (135
 * activos, hasta $1.750.000): recortarlos al CAP convertiría la renovación en
 * una REBAJA silenciosa del capital del cliente. Como el tramo de esos montos no
 * admite aumento, en la práctica se piden por el MISMO monto — que es lo
 * conservador. Quien lo autoriza es el admin. Puro.
 */
export function montoRenovacionPedido(montoAnterior: number): number {
  return Math.max(0, Math.round(Number(montoAnterior) || 0));
}

/**
 * ¿Esta renovación necesita que la apruebe el admin? True cuando el monto que
 * corresponde pedir se pasa del CAP — o sea, cuando nadie puede darla de alta
 * solo. Decisión de Carlos (06-08): eso NO es un callejón sin salida, se manda a
 * la oficina. Puro.
 */
export function requiereAprobacionAdmin(montoAnterior: number): boolean {
  return montoRenovacionPedido(montoAnterior) > RENOVACION_CAP_TOTAL;
}

/**
 * TECHO ABSOLUTO de una renovación: ni el admin aprobando puede pasarlo.
 *
 * Es el candado que impide que un cero de más se convierta en un crédito. Al
 * abrir el camino de "lo que no se aprueba solo va al admin", el sobre-CAP dejó
 * de ser un rechazo duro y pasó a generar una solicitud cuyo monto lo escribe una
 * persona a mano; si además la aprobación apaga el tope de la base, no queda
 * NADIE mirando el número. La regla que lo cierra: **el CAP solo se puede pasar
 * si el crédito ANTERIOR ya lo pasaba, y nunca por encima de él** — renovar no
 * sube un crédito que ya está sobre el tope (su tramo da 0% de aumento igual).
 *
 * Para un crédito normal el techo sigue siendo $100.000, así que la solicitud
 * sobre-tramo —que es su razón de ser— funciona igual que siempre. Puro.
 */
export function techoRenovacion(montoAnterior: number): number {
  return Math.max(RENOVACION_CAP_TOTAL, montoRenovacionPedido(montoAnterior));
}

/**
 * Tope de aumento (%) al renovar: **20% para todos**.
 *
 * ⚠️ Antes esto era un escalonado por monto (20/15/10/0%) que CONTRADECÍA la regla
 * del negocio. Se vio en la calle el 06-08 con GABRIELA OTONELLI: terminó un
 * crédito de $60.000 y la app le ofrecía renovar por **$69.000** (+15%, su tramo)
 * en vez de los **$72.000** del +20%. Dos topes conviviendo y ninguno explicado.
 *
 * Manda la regla de Carlos: "siempre es 20% para renovación". El techo real sigue
 * existiendo y es el CAP de $100.000, que acota la exposición por crédito; lo que
 * se pasa de ahí va a la aprobación del admin, no a un rechazo. Puro.
 */
export function topeAumentoPct(_montoAnterior: number): number {
  return RENOVACION_AUMENTO_PCT;
}

export interface EvaluacionRenovacion {
  /** true = dentro del tope del tramo Y del cap → se aprueba sola. */
  autoAprobable: boolean;
  /** Aumento en pesos (nuevo − anterior); negativo si renueva por menos. */
  aumento: number;
  /** Aumento en % sobre el anterior. */
  aumentoPct: number;
  /** Tope de aumento (%) del tramo del monto anterior. */
  topePct: number;
  /** El aumento supera el tope del tramo (DURO para no-admin; el admin puede). */
  excedePct: boolean;
  /** El monto nuevo supera el cap total $100.000 (DURO para TODOS). */
  superaCap: boolean;
  /** Por qué no es auto-aprobable (null si lo es). */
  motivo: string | null;
}

/** Evalúa una renovación contra el tope del tramo y el cap total. Puro. */
export function evaluarRenovacion(
  montoAnterior: number,
  montoNuevo: number,
): EvaluacionRenovacion {
  const aumento = montoNuevo - montoAnterior;
  const aumentoPct =
    montoAnterior > 0 ? (aumento / montoAnterior) * 100 : montoNuevo > 0 ? Infinity : 0;
  const topePct = topeAumentoPct(montoAnterior);
  // Tolerancia mínima para no rechazar por redondeo (ej. 20.0000001%).
  const excedePct = aumentoPct > topePct + 1e-6;
  const superaCap = montoNuevo > RENOVACION_CAP_TOTAL + 1e-6;
  const autoAprobable = !excedePct && !superaCap;

  const pes = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;
  let motivo: string | null = null;
  if (superaCap) motivo = `El crédito no puede superar ${pes(RENOVACION_CAP_TOTAL)} (tope máximo).`;
  else if (excedePct)
    motivo =
      topePct > 0
        ? `El aumento de ${aumentoPct.toFixed(0)}% supera el máximo de ${topePct}% para créditos de ${pes(montoAnterior)}.`
        : `Un crédito de ${pes(montoAnterior)} ya no admite aumento (tope ${pes(RENOVACION_CAP_TOTAL)}).`;

  return { autoAprobable, aumento, aumentoPct, topePct, excedePct, superaCap, motivo };
}
