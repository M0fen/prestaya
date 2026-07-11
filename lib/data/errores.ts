// ─────────────────────────────────────────────────────────────────────────
//  Helpers de errores de la capa de datos (Supabase / PostgREST).
// ─────────────────────────────────────────────────────────────────────────

/**
 * true si el error significa "la tabla no existe todavía" (migración sin
 * aplicar). Cubre el código de Postgres (42P01) y el de PostgREST cuando la
 * tabla no está en el schema cache (PGRST205), más un respaldo por mensaje.
 * Lo usan las capas que degradan a vacío/valores por defecto.
 */
export function tablaFaltante(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  const code = err?.code;
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = err?.message ?? "";
  return /schema cache|does not exist|could not find the table/i.test(msg);
}

/**
 * true si el error significa "la columna no existe todavía" (migración de
 * ALTER TABLE sin aplicar). Cubre el código de Postgres (42703) y PostgREST
 * (PGRST204: columna no encontrada en el schema cache). Lo usan las capas que
 * degradan cuando una columna nueva aún no fue creada.
 */
export function columnaFaltante(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === "42703" || err?.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(err?.message ?? "");
}

/**
 * true si el error significa "la función/RPC no existe todavía" (migración sin
 * aplicar). Cubre Postgres (42883: undefined_function) y PostgREST (PGRST202:
 * función no encontrada en el schema cache). Lo usan las capas que degradan a un
 * fallback cuando una RPC nueva aún no fue creada.
 */
export function funcionFaltante(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === "42883" || err?.code === "PGRST202") return true;
  return /could not find the function|function .* does not exist/i.test(err?.message ?? "");
}
