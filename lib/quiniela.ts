// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — QUINIELA (juego PROMOCIONAL). Núcleo PURO (sin React, sin IO).
//
//  ⚠️ RESTRICCIÓN LEGAL INNEGOCIABLE: la quiniela por DINERO la regula el Estado
//  uruguayo (Dirección de Loterías y Quinielas). Esta feature es ESTRICTAMENTE
//  promocional: el cliente elige un número por estar AL DÍA (no apuesta plata),
//  y el premio es un BENEFICIO simbólico del préstamo, NUNCA dinero en efectivo.
//  Si el diseño derivara a apuesta/pago en dinero: PARAR (requiere licencia).
//
//  El sorteo/resultado lo carga el admin; el sistema solo calcula ganadores.
// ─────────────────────────────────────────────────────────────────────────

export interface RangoQuiniela {
  min: number;
  max: number;
}

/** Valida que el número elegido esté dentro del rango de la quiniela. */
export function numeroValido(numero: number, rango: RangoQuiniela): boolean {
  return (
    Number.isInteger(numero) && numero >= rango.min && numero <= rango.max
  );
}

/** Normaliza (redondea y acota) un número al rango; útil antes de guardar. */
export function normalizarNumero(numero: number, rango: RangoQuiniela): number {
  const n = Math.round(Number(numero) || 0);
  return Math.min(rango.max, Math.max(rango.min, n));
}

export interface ParticipacionMin {
  clienteId: string;
  numero: number;
}

/** Devuelve los clientes ganadores (los que eligieron el número sorteado). */
export function ganadores(
  participaciones: ParticipacionMin[],
  numeroGanador: number,
): string[] {
  return participaciones
    .filter((p) => p.numero === numeroGanador)
    .map((p) => p.clienteId);
}
