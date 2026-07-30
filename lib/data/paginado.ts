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
 * ⚠️ OBLIGATORIO: la consulta DEBE ordenar por una columna ÚNICA y estable
 * (normalmente `.order("id")`) ANTES del `.range()`. Sin un orden total estable,
 * PostgREST puede repetir o saltear filas entre páginas → totales inflados o
 * faltantes (esto es DINERO). Ordenar por una columna no única no alcanza: los
 * empates rompen igual; agregá `id` como desempate.
 *
 * ⚠️ ALCANCE de la garantía: el orden único evita repetir/saltear filas sobre un
 * SNAPSHOT estático. Es paginación por OFFSET (`.range`), NO por cursor: un INSERT
 * o una anulación que caiga ANTES del cursor durante el barrido puede correr las
 * filas y duplicar/saltear una de borde (off-by-uno). Es aceptable para LECTURAS
 * derivadas que se recalculan (mora/compromisos/capital), no para invariantes
 * estrictos bajo alta concurrencia — para eso haría falta keyset (`id > $ultimo`).
 * (Además asume `db-max-rows` de PostgREST ≥ `tam`; si fuera menor, cortaría de más.)
 *
 * Ej:
 *   const filas = await traerTodo<Fila>((d, h) =>
 *     db.from("pagos").select("monto").eq("anulado", false)
 *       .order("id", { ascending: true }).range(d, h));
 */
export async function traerTodo<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<Respuesta>,
  tam = 1000,
  // Tope defensivo OPCIONAL de filas. Por defecto SIN tope (conducta previa: los
  // barridos de plata deben traer TODO para no subestimar). Se usa solo en caminos
  // DEGRADADOS/emergencia (p.ej. fallback sin RPC) para no reventar la instancia
  // con millones de filas; ahí un corte acotado es preferible a un OOM.
  maxFilas?: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += tam) {
    const { data, error } = await consulta(desde, desde + tam - 1);
    if (error) throw error;
    const filas = (data ?? []) as T[];
    out.push(...filas);
    if (filas.length < tam) break; // última página
    if (maxFilas !== undefined && out.length >= maxFilas) break; // tope de emergencia
  }
  return out;
}
