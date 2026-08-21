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
 * ⚠️ PISO DE LA TASA. Un crédito no puede devolver MENOS de lo que prestó.
 *
 * Medido el 10-08 sobre la cartera viva: hay 192 créditos activos con tasa 0%
 * ($72.113.554 de capital) y 24 con tasa NEGATIVA — casi todos heredados de Disapp,
 * donde `cuota × días` da exactamente el capital. JOSE RODRÍGUEZ tiene SEIS
 * seguidos así: $18.000 con cuota $600 × 30 = $18.000, 0%.
 *
 * Como la renovación ARRASTRA la tasa del crédito anterior, esa cartera se
 * reproducía sola: al ofrecerle un crédito nuevo de $5.000 en 24 cuotas, la app
 * calculaba cuota $208 y "Paga en total $4.992" — un crédito que devuelve MENOS de
 * lo que se entregó. El negocio perdía capital en cada renovación de esos clientes.
 *
 * La regla de Carlos: el 20% se PRESERVA. Una tasa heredada de 0% o negativa no es
 * "la tasa del cliente", es un dato roto: se cae al interés del negocio. Las tasas
 * REALES distintas del 20% que conviven en la cartera (3%, 3,5%, 10-19%) son > 0 y
 * se respetan tal cual — el piso solo actúa donde el crédito perdía plata.
 */
/**
 * Umbral del dato ROTO: por debajo del 1% de interés no hay tasa real, hay basura
 * del import. Medido contra la cartera viva (10-08): 82 créditos activos entre 0 y
 * 1% ($7.764.720) — artefactos de redondeo de Disapp como GUSTAVO FERRAGUT,
 * $94.500 al 0,03% — y CERO créditos entre 1% y 3%. La tasa real más baja del
 * negocio es 3%. O sea: el umbral del 1% corta exactamente la basura y no toca ni
 * un crédito legítimo. Si algún día existiera una tasa real menor al 1%, esto es
 * lo que hay que revisar (decisión de negocio, no técnica).
 */
const FACTOR_MINIMO_REAL = 1.01;

export function factorConPiso(anterior: TerminosAnterior): number {
  const f = tasaImplicita(anterior);
  return f >= FACTOR_MINIMO_REAL ? f : 1 + RENOVACION_AUMENTO_PCT / 100;
}

/**
 * Cuota diaria del nuevo crédito, arrastrando la tasa del anterior:
 *   cuota = round( monto × tasa / días ).
 * Devuelve 0 si algún término es inválido (el llamador valida > 0).
 *
 * ⚠️ El redondeo a peso entero hace que `cuota × días` no siempre dé el total
 * exacto: $7.000 al 20% son $8.400, pero en 17 cuotas la cuota exacta es 494,12 y
 * 494 × 17 = $8.398 (se pierden $2). Con una cuota diaria FIJA y entera —que es lo
 * que el cobrador cobra en la mano— no se puede tener a la vez el total exacto y
 * cualquier cantidad de cuotas: hay que elegir. Por eso la pantalla muestra SIEMPRE
 * el total real y el % real (`interesEfectivo`), y avisa cuándo un número de cuotas
 * cercano da justo. Medido: solo 2 créditos vivos tienen esa diferencia, de $2.
 */
export function calcularCuotaRenovacion(
  anterior: TerminosAnterior,
  montoNuevo: number,
  diasNuevo: number,
): number {
  if (!(montoNuevo > 0) || !(diasNuevo > 0)) return 0;
  return Math.round((montoNuevo * factorConPiso(anterior)) / diasNuevo);
}

/**
 * El interés REAL que va a quedar guardado, ya con el redondeo de la cuota adentro:
 *   (cuota × días / capital − 1) × 100
 * Es el número que hay que MOSTRAR, no el nominal: si se pide 20% y la cuota
 * redondeada da 19,97%, el que aprueba tiene que ver 19,97%. Una décima. Puro.
 */
export function interesEfectivo(monto: number, cuota: number, dias: number): number {
  if (!(monto > 0) || !(cuota > 0) || !(dias > 0)) return 0;
  return Math.round(((cuota * dias) / monto - 1) * 1000) / 10;
}

/**
 * La cantidad de cuotas MÁS CERCANA a la pedida que da el total exacto (sin perder
 * ni cobrar de más). `null` si no hay ninguna en ±6. Es lo que convierte el aviso
 * "te quedó en 19,97%" en algo accionable: "con 20 cuotas queda justo".
 */
export function cuotasQueDanJusto(monto: number, interesPct: number, dias: number): number | null {
  if (!(monto > 0) || !(dias > 0)) return null;
  const total = Math.round(monto * (1 + Math.max(0, interesPct) / 100));
  for (let d = 1; d <= 6; d++) {
    for (const cand of [dias - d, dias + d]) {
      if (cand >= 1 && cand <= 366 && total % cand === 0) return cand;
    }
  }
  return null;
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

/** Tope de cuotas para lo que se TECLEA (un dedazo de 4.000 cuotas pulveriza la
 *  cuota y deja el total por debajo del capital). 366 cubre de sobra el crédito
 *  diario más largo del negocio. */
export const TOPE_CUOTAS = 366;

/**
 * ¿La cantidad de cuotas es válida? El tope vale SOLO para lo tecleado: hay
 * créditos heredados de Disapp con plazos más largos (PAOLA VANESSA CASTRO,
 * $1.110.000 en 555 cuotas) y repetirlos TAL CUAL es continuidad de una
 * exposición que ya existe — rebotarlos mostraba un rojo sobre un campo que la
 * pantalla ni tiene. Una sola función para calle, oficina y pantalla: un
 * refactor que cambie `> 366` por `>= 366` acá rompe los tests, no la ruta.
 */
export function cuotasValidas(totalDias: number, tecleadas: boolean): boolean {
  return Number.isInteger(totalDias) && totalDias > 0 && (!tecleadas || totalDias <= TOPE_CUOTAS);
}

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
 * TECHO ABSOLUTO de una renovación — lo que un GESTOR (admin/supervisor) puede
 * autorizar como máximo. Es el candado contra el CERO DE MÁS: al abrir "lo que
 * no se aprueba solo va a la oficina", el sobre-CAP dejó de ser rechazo duro y
 * el monto lo escribe una persona a mano; si nadie mira el número, $20.000
 * tipeado como $200.000 se vuelve un crédito.
 *
 * ⚠️ REGLA DE CARLOS (16-08, queja del admin "todavía no deja hacer créditos con
 * más del 20%"): **más del +20% SE PUEDE, con aprobación de supervisor o
 * admin**. La versión anterior de esta función decía "el CAP solo se pasa si el
 * anterior ya lo pasaba, y NUNCA por encima de él" — o sea que un heredado de
 * $120.000 no se podía subir ni un peso, y un cliente de $90.000 no podía pasar
 * de $100.000 ni con la firma del dueño. Eso contradecía la regla: en la base
 * viva hay 135 activos > $100k y 89 entre $60-100k que chocaban con ese muro
 * cada vez que la oficina intentaba subirles el crédito.
 *
 * El techo del GESTOR es entonces **el +20% sobre el anterior** (la misma
 * regla que para el cobrador, pero el gestor la AUTORIZA en vez de pedirla),
 * con un piso en el CAP para que un crédito chico pueda crecer hasta ahí:
 *   · anterior $30.000  → gestor autoriza hasta $100.000 (el CAP)
 *   · anterior $90.000  → hasta $108.000 (+20%; ya no lo frena el CAP)
 *   · anterior $120.000 → hasta $144.000 (heredado: también sube +20%)
 * Más de +20% en UNA renovación no lo autoriza nadie: ese es el candado que
 * queda contra el dedazo (subir 5× de un toque no es una renovación). Puro.
 */
export function techoRenovacion(montoAnterior: number): number {
  const base = Math.max(0, Math.round(Number(montoAnterior) || 0));
  return Math.max(RENOVACION_CAP_TOTAL, Math.floor(base * (1 + RENOVACION_AUMENTO_PCT / 100)));
}

/**
 * TECHO ABSOLUTO de una VENTA NUEVA con historial — lo que el GESTOR puede
 * autorizar (la solicitud tipo 'venta' que el cobrador manda por sobre su techo).
 * Misma regla que `techoRenovacion`: hasta +20% del último crédito, con piso en
 * el CAP. Sin esto, la solicitud de venta > $100.000 se rechazaba con "no lo
 * puede aprobar nadie" — el muro que el admin reportó (16-08). Puro.
 */
export function techoVentaGestor(montoAnterior: number | null | undefined): number {
  const base = Math.max(0, Math.round(Number(montoAnterior) || 0));
  return Math.max(RENOVACION_CAP_TOTAL, Math.floor(base * (1 + RENOVACION_AUMENTO_PCT / 100)));
}

/**
 * POR QUÉ ese máximo, dicho sin mentir. Los mensajes explicaban el techo del
 * gestor siempre como "(+20% sobre $X)", pero para TODO anterior < $83.334 (la
 * enorme mayoría de la cartera) el máximo es el PISO del CAP: "hasta $100.000
 * (+20% sobre $10.000)" era una cuenta que no cierra y enseñaba mal la regla.
 * Cuando gana el ×1,2 se dice el +20%; cuando gana el piso, "el tope general".
 * Puro y compartido: el servidor y las pantallas arman el rótulo con ESTA
 * función, nunca a mano.
 */
export function explicaTecho(montoAnterior: number, maximo: number): string {
  const pes = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");
  return maximo > RENOVACION_CAP_TOTAL
    ? `(+20% sobre ${pes(montoAnterior)})`
    : `(el tope general de ${pes(RENOVACION_CAP_TOTAL)})`;
}

/**
 * Rótulo del TECHO PROPIO del cobrador (montoRenovacionAutoAprobable), dicho
 * sin mentir — misma motivación que `explicaTecho` pero para el otro número:
 *   · gana el ×1,2 → "(+20%)"
 *   · lo frenó el CAP (anterior $90.000 → techo $100.000 = +11%) → "(tope general)"
 *   · heredado ≥ CAP: el techo ES repetir el monto, no hay margen propio → null
 *     (la pantalla no debe decir "subilo hasta $120.000" sobre $120.000).
 * ⚠️ Usa el MISMO Math.round que `montoRenovacionAutoAprobable`: con floor, en
 * montos donde base×1,2 cae en ,5+ el rótulo diría "(tope general)" para un
 * techo que sí es el +20% redondeado. Puro.
 */
export function rotuloTechoPropio(montoAnterior: number, techo: number): string | null {
  const base = Math.round(Number(montoAnterior) || 0);
  if (!(base > 0) || techo <= base) return null;
  const conAumento = Math.round(base * (1 + RENOVACION_AUMENTO_PCT / 100));
  return techo >= conAumento ? "(+20%)" : "(tope general)";
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
  // El CAP acota lo que se aprueba SOLO; el gestor autoriza hasta techoRenovacion
  // (+20% con piso en el CAP — regla de Carlos 16-08). El motivo lo dice así: el
  // texto viejo "no puede superar $100.000 (tope máximo)" era falso para el gestor
  // y aparecía debajo de "podés autorizar hasta $108.000" (auditoría 16-08).
  if (superaCap && montoNuevo > techoRenovacion(montoAnterior)) {
    // Con explicaTecho: "(techo) = +20% sobre X" era una cuenta FALSA cuando el
    // techo es el piso del CAP (+20% de $50.000 es $60.000, no $100.000).
    const techo = techoRenovacion(montoAnterior);
    motivo = `Supera lo que se puede autorizar en una renovación: hasta ${pes(techo)} ${explicaTecho(montoAnterior, techo)}.`;
  }
  else if (superaCap)
    motivo = `Pasa el tope de ${pes(RENOVACION_CAP_TOTAL)} que se aprueba solo: hasta ${pes(techoRenovacion(montoAnterior))} lo autoriza un gestor.`;
  else if (excedePct)
    motivo =
      topePct > 0
        ? `El aumento de ${aumentoPct.toFixed(0)}% supera el máximo de ${topePct}% para créditos de ${pes(montoAnterior)}.`
        : `Un crédito de ${pes(montoAnterior)} ya no admite aumento (tope ${pes(RENOVACION_CAP_TOTAL)}).`;

  return { autoAprobable, aumento, aumentoPct, topePct, excedePct, superaCap, motivo };
}
