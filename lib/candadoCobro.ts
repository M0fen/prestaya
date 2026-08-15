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
