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
  // ⚠️ NUNCA tragar un error de COLUMNA acá. El respaldo por mensaje (`does not
  // exist`) matcheaba también "column x.y does not exist" (42703), y ese caso NO
  // es "la migración todavía no corrió": es un nombre de columna mal escrito, o
  // sea un bug. Lo caro es que quien llama a este helper DEGRADA EN SILENCIO —
  // devuelve vacío y sigue— así que un typo se comía la función entera sin dejar
  // ni una línea en Sentry. Le pasó a INV13 el 10-08: pedía `monto` sobre
  // `aperturas_caja` (la columna es `base`), y el vigilante de las bases sin
  // devolver quedó CIEGO Y MUDO desde el día que se escribió, con $497.801 en 8
  // bolsillos que nadie estaba reclamando. Los 1.022 tests seguían verdes porque
  // los tests prueban la función pura, no la consulta.
  if (columnaFaltante(e)) return false;
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
