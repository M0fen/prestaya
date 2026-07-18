// ─────────────────────────────────────────────────────────────────────────
//  conTimeout — convierte un CUELGUE en un error EXPLÍCITO.
//
//  Una promesa (típicamente un query a Supabase) que NO resuelve deja la página
//  esperando hasta que Vercel mate la función (504 lento). Con esto, LANZA a los
//  `ms` → lo toma el error.tsx del segmento → "No pudimos cargar. Reintentá." al
//  instante, en vez de un skeleton eterno.
//
//  Money-safe POR DISEÑO: LANZA, nunca devuelve un valor por defecto — así jamás
//  puede degradar a un $0 falso. El tope es GENEROSO: solo un cuelgue real lo
//  dispara; una carga legítima (1-5s) nunca lo alcanza.
//
//  NB: la promesa original sigue corriendo tras el timeout (no se puede cancelar
//  un query de Supabase); su resultado simplemente se descarta. El timer SIEMPRE
//  se limpia (no filtra el event loop ni la request).
// ─────────────────────────────────────────────────────────────────────────

export class TimeoutError extends Error {
  constructor(
    public readonly etiqueta: string,
    public readonly ms: number,
  ) {
    super(`Timeout (${ms}ms) en ${etiqueta}`);
    this.name = "TimeoutError";
  }
}

/**
 * Corre `promesa` con un tope de tiempo. Si no resuelve en `ms`, lanza
 * `TimeoutError` (no devuelve default). Si `promesa` rechaza antes, propaga ESE
 * error tal cual (no lo enmascara como timeout). El timer se limpia siempre.
 */
export function conTimeout<T>(promesa: Promise<T>, ms: number, etiqueta: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limite = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(etiqueta, ms)), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(timer)) as Promise<T>;
}
