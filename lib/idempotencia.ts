// ─────────────────────────────────────────────────────────────────────────
//  Idempotencia — op_id DETERMINISTA para las escrituras de plata.
//
//  Genera un uuid v5-like ESTABLE a partir de sus partes: el MISMO evento de plata
//  (ej. "comision|<cobradorId>|<periodoKey>", "gasto|<solicitudId>") produce SIEMPRE
//  el mismo op_id. Así, si una escritura commitea pero se pierde la respuesta (timeout
//  de la función serverless / 504 del gateway / corte de red), el REINTENTO colisiona
//  en el índice único `op_id` (23505) y se trata como éxito idempotente, en vez de
//  crear un segundo egreso. Núcleo compartido por caja/comisiones/gastos (migración 0074).
// ─────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";

/** Código de error de Postgres para violación de índice/constraint único. */
export const PG_UNIQUE_VIOLATION = "23505";

/** ¿La excepción es una violación de unicidad (op_id ya existe)? Robusto ante el
 *  envoltorio de postgrest-js (que expone `.code`). */
export function esViolacionUnica(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === PG_UNIQUE_VIOLATION;
}

/** ¿Es un uuid con formato válido (para aceptar un nonce del cliente)? */
export function esUuid(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-fA-F-]{36}$/.test(s);
}

/**
 * op_id determinista (uuid v5-like) a partir de `partes`. Estable: mismas partes →
 * mismo uuid. Se usa como clave de idempotencia de una escritura de plata para que
 * el reintento del MISMO evento colisione en el índice único.
 */
export function opIdDeterminista(...partes: (string | number | null | undefined)[]): string {
  const b = createHash("sha1").update(partes.map((p) => p ?? "").join("|")).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // versión 5
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const x = b.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
