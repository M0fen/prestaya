// ─────────────────────────────────────────────────────────────────────────
//  CANDADO ANTI DOBLE-TOQUE del cobro — el predicado, en un solo lugar.
//
//  Vivía inline en la Server Action y su "espejo" de test era una COPIA que
//  drifteó: el test fijaba la ventana de UN solo lado (todo pago posterior del
//  mismo monto contaba como gemelo, a cualquier distancia) mientras el servidor
//  ya comparaba |Δ| ≤ 10 min de DOS lados — la regla de un lado confirmaba como
//  "duplicado" plata cobrada de verdad que subía tarde de la cola offline (21
//  cobros con +10 min de atraso en una semana) y la hacía desaparecer del libro
//  en silencio. Desde la sesión de caos (15-08) pantalla, servidor y tests
//  importan ESTA función: si la regla cambia, cambia para todos o para nadie.
//
//  La ventana se mide contra la HORA SELLADA del cobro (sellarRegistroEn), no
//  contra "ahora": la cola offline puede drenar horas después y dos toques de
//  las 10:00 y 10:01 tienen que seguir siendo gemelos a las 14:00.
// ─────────────────────────────────────────────────────────────────────────

/** Ventana del candado. Los duplicados reales del piloto fueron de 40 y 50
 *  segundos; la segunda vuelta legítima más cercana, 2,26 horas (163×). */
export const VENTANA_DUPLICADO_MS = 10 * 60 * 1000;

export interface PagoPrevioCandado {
  monto: number | string;
  registrado_en?: string | null;
  anulado?: boolean | null;
  origen?: string | null;
}

/**
 * ¿Hay en `pagos` un gemelo del cobro nuevo? (mismo monto ±$0,5, |Δ| dentro de
 * la ventana, vigente y nativo). Los anulados no frenan el recobro — justamente
 * se anularon para rehacerlo — y los asientos importados (origen no-null) no
 * frenan un cobro real de la calle.
 */
export function gemeloReciente<T extends PagoPrevioCandado>(
  pagos: T[],
  monto: number,
  horaCobroMs: number,
  ventanaMs: number = VENTANA_DUPLICADO_MS,
): T | undefined {
  return pagos.find(
    (p) =>
      !p.anulado &&
      (p.origen ?? null) === null &&
      Math.abs(Number(p.monto) - monto) < 0.5 &&
      p.registrado_en != null &&
      Math.abs(new Date(p.registrado_en).getTime() - horaCobroMs) <= ventanaMs,
  );
}

// ── Pares legítimos en la cola offline ──────────────────────────────────────

export interface OpParaPares {
  id?: string;
  tipo: string;
  clienteId: string;
  prestamoId?: string | null;
  monto?: number | null;
  /** Monto de referencia cuando monto=null ("cuota completa" — la pantalla lo
   *  conocía al encolar). Sin él, cuota-null y el MISMO valor tipeado no
   *  matcheaban y el par mixto perdía el bypass (acta pre-lunes). */
  montoRef?: number | null;
  deviceTs: number;
}

/** El monto con el que se COMPARA un par (el que la pantalla conocía). */
const montoDePar = (o: OpParaPares) => o.monto ?? o.montoRef ?? null;

/**
 * ¿Esta op es parte de un PAR LEGÍTIMO — dos cobros reales del mismo monto al
 * mismo crédito, tomados con MÁS de la ventana de distancia (la segunda vuelta
 * de la ruta)?
 *
 * Por qué existe: la cola puede drenar AL DÍA SIGUIENTE (teléfono sin señal
 * toda la tarde). El sellado del día contable colapsa las dos horas a "ahora"
 * (un cobro no puede fecharse ayer), y con las horas colapsadas el candado de
 * gemelos vería |Δ| ≈ 0 y confirmaría el segundo cobro REAL como "duplicado" —
 * plata desapareciendo del libro en silencio. Pero el TELÉFONO sí conoce las
 * horas verdaderas (deviceTs): si el par está a más de la ventana, son dos
 * cobros de verdad y el drenaje los manda con el bypass explícito.
 *
 * ⚠️ El bypass NO aplica si además hay un gemelo CERCANO en la cola (doble tap
 * de verdad): ahí se deja que el servidor rechace el duplicado — y el cobro
 * legítimo lejano, que no tiene vecinos cercanos, pasa con su bypass.
 */
export function esParteDeParSeparado(
  op: OpParaPares,
  todas: OpParaPares[],
  ventanaMs: number = VENTANA_DUPLICADO_MS,
): boolean {
  const mismoCobro = (o: OpParaPares) =>
    o !== op &&
    (o.id == null || op.id == null || o.id !== op.id) &&
    o.tipo === "pago" &&
    op.tipo === "pago" &&
    o.clienteId === op.clienteId &&
    (o.prestamoId ?? null) === (op.prestamoId ?? null) &&
    montoDePar(o) === montoDePar(op);
  const pares = todas.filter(mismoCobro);
  const tieneLejano = pares.some((o) => Math.abs(o.deviceTs - op.deviceTs) > ventanaMs);
  const tieneCercano = pares.some((o) => Math.abs(o.deviceTs - op.deviceTs) <= ventanaMs);
  return tieneLejano && !tieneCercano;
}
