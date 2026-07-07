// ─────────────────────────────────────────────────────────────────────────
//  Generación de tokens de acceso del cliente (link de solo lectura).
//  Mismo formato que el default de la base (encode(gen_random_bytes(24),'hex')):
//  48 caracteres hex. Se usa al ROTAR el token si un link se filtra (Fase 6).
// ─────────────────────────────────────────────────────────────────────────
import { randomBytes } from "node:crypto";

/** Nuevo token aleatorio de 48 hex (24 bytes). Imprevisible (CSPRNG). */
export function nuevoToken(): string {
  return randomBytes(24).toString("hex");
}
