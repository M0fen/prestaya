// ─────────────────────────────────────────────────────────────────────────
//  Seguridad — autorización de rutas de CRON (service_role).
//  Núcleo PURO y testeable. Regla clave: FALLAR CERRADO en producción.
//  Si en prod no hay CRON_SECRET configurado, NO se deja pasar a nadie (antes
//  degradaba a abierto). En desarrollo sin secreto se permite (para probar).
// ─────────────────────────────────────────────────────────────────────────
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Comparación en TIEMPO CONSTANTE de dos strings. Comparar el secreto con `===`
 * corta en el primer byte distinto y filtra, por diferencias de tiempo, cuántos
 * caracteres acertó un atacante. Hasheamos ambos lados a un largo fijo (32 bytes)
 * y comparamos con `timingSafeEqual`, que no corta temprano.
 */
export function comparaSegura(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * ¿Está autorizada una petición de cron?
 *  · prod sin secreto configurado → NO (cerrado; nunca abre por descuido).
 *  · con secreto (cualquier entorno) → exige `Authorization: Bearer <secreto>`
 *    con comparación en tiempo constante.
 *  · dev sin secreto → sí (permisivo, para probar el cron localmente).
 */
export function cronAutorizado(
  authHeader: string | null,
  secreto: string | undefined,
  esProd: boolean,
): boolean {
  const tieneSecreto = typeof secreto === "string" && secreto.length > 0;
  if (esProd && !tieneSecreto) return false; // fallar cerrado
  if (tieneSecreto) return typeof authHeader === "string" && comparaSegura(authHeader, `Bearer ${secreto}`);
  return true; // solo dev sin secreto
}
