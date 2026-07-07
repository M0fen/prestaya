// ─────────────────────────────────────────────────────────────────────────
//  Seguridad — autorización de rutas de CRON (service_role).
//  Núcleo PURO y testeable. Regla clave: FALLAR CERRADO en producción.
//  Si en prod no hay CRON_SECRET configurado, NO se deja pasar a nadie (antes
//  degradaba a abierto). En desarrollo sin secreto se permite (para probar).
// ─────────────────────────────────────────────────────────────────────────

/**
 * ¿Está autorizada una petición de cron?
 *  · prod sin secreto configurado → NO (cerrado; nunca abre por descuido).
 *  · con secreto (cualquier entorno) → exige `Authorization: Bearer <secreto>`.
 *  · dev sin secreto → sí (permisivo, para probar el cron localmente).
 */
export function cronAutorizado(
  authHeader: string | null,
  secreto: string | undefined,
  esProd: boolean,
): boolean {
  const tieneSecreto = typeof secreto === "string" && secreto.length > 0;
  if (esProd && !tieneSecreto) return false; // fallar cerrado
  if (tieneSecreto) return authHeader === `Bearer ${secreto}`;
  return true; // solo dev sin secreto
}
