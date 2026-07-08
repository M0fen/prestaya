// ─────────────────────────────────────────────────────────────────────────
//  Helper de PAGINADO para escalar el panel a datos reales (miles de filas).
//  PostgREST devuelve como MÁXIMO 1000 filas por consulta: si una función trae
//  "todo a memoria" sin paginar, arriba de 1000 filas los números salen MAL en
//  silencio (cartera/mora/recaudo truncados). `traerTodo` recorre por páginas
//  con `.range()` hasta agotar, sin tope. Se usa `count: "exact"` no; se detecta
//  el fin cuando una página vuelve incompleta.
// ─────────────────────────────────────────────────────────────────────────

/** Resultado mínimo de una consulta PostgREST (data + error). */
type Respuesta = { data: unknown; error: unknown };

/**
 * Trae TODAS las filas de una consulta, paginando de a `tam` (default 1000, el
 * tope de PostgREST). `consulta(desde, hasta)` debe construir una consulta NUEVA
 * y aplicarle `.range(desde, hasta)`. Lanza si alguna página da error.
 *
 * Ej:
 *   const filas = await traerTodo<Fila>((d, h) =>
 *     db.from("pagos").select("monto").eq("anulado", false).range(d, h));
 */
export async function traerTodo<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<Respuesta>,
  tam = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += tam) {
    const { data, error } = await consulta(desde, desde + tam - 1);
    if (error) throw error;
    const filas = (data ?? []) as T[];
    out.push(...filas);
    if (filas.length < tam) break; // última página
  }
  return out;
}
