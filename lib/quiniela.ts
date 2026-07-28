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

/** El número de la suerte es de 3 dígitos: 000 a 999. Rango fijo de la quiniela. */
export const RANGO_SUERTE: RangoQuiniela = { min: 0, max: 999 };

/**
 * Número de la suerte del cliente = los ÚLTIMOS 3 dígitos de su número de
 * registro (000–999). Asignado, NO elegido. Devuelve null si no tiene registro.
 */
export function numeroSuerte(numeroRegistro: number | null | undefined): number | null {
  if (numeroRegistro == null) return null;
  const n = Number(numeroRegistro);
  if (!Number.isFinite(n)) return null;
  return Math.abs(Math.trunc(n)) % 1000;
}

/** Formatea el número de la suerte a 3 dígitos con ceros a la izquierda ("42" → "042"). */
export function formatearSuerte(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return String(Math.abs(Math.trunc(Number(n))) % 1000).padStart(3, "0");
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

/**
 * Sortea AL AZAR el número ganador ENTRE LOS PARTICIPANTES REALES (no en todo el
 * 000–999). Así siempre hay al menos un ganador: sortear en el espacio completo,
 * con pocos participantes, casi siempre caía en un número que nadie tenía →
 * "sin ganadores", lo que confunde a quien cierra la quiniela.
 *
 * Cada PERSONA tiene la misma chance (elige un participante al azar y usa su
 * número); si varios comparten ese número, ganan todos (es lo esperado).
 * Devuelve null si no hay participantes. `aleatorio` se inyecta para testear.
 */
export function numeroGanadorAlAzar(
  numeros: readonly number[],
  aleatorio: () => number = Math.random,
): number | null {
  if (numeros.length === 0) return null;
  const i = Math.floor(aleatorio() * numeros.length);
  // Acotar el índice por si `aleatorio()` devuelve exactamente 1 (defensivo).
  return numeros[Math.min(i, numeros.length - 1)];
}
