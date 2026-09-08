// ─────────────────────────────────────────────────────────────────────────
//  Series por DÍA (UY) para el panel del piloto — funciones puras, sin base.
//  Un día sin datos vale 0 (no se salta): la barra vacía ES la información.
// ─────────────────────────────────────────────────────────────────────────

export interface PuntoDia {
  dia: string; // YYYY-MM-DD (UY)
  valor: number;
}

/** Los últimos `n` días hasta `hoyYmd` inclusive, ascendentes. */
export function ultimosDias(hoyYmd: string, n: number): string[] {
  const [y, m, d] = hoyYmd.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** Arma la serie sobre `dias` a partir de un mapa día → valor (0 donde falta). */
export function serieDe(dias: string[], porDia: Map<string, number>): PuntoDia[] {
  return dias.map((dia) => ({ dia, valor: porDia.get(dia) ?? 0 }));
}

/** Suma `valor` en el mapa bajo `dia` (para agrupar filas). */
export function acumular(porDia: Map<string, number>, dia: string, valor = 1): void {
  porDia.set(dia, (porDia.get(dia) ?? 0) + valor);
}

/** Domingo en UY: no se cobra (las barras se pintan tenues). */
export function esDomingo(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

/** "lun 7", "mar 8"… para el eje. */
export function etiquetaDia(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${d}`;
}

/** Total y promedio de los días hábiles (sin domingos) de la serie. */
export function resumenSerie(s: PuntoDia[]): { total: number; promedioHabil: number; max: number } {
  const total = s.reduce((a, p) => a + p.valor, 0);
  const habiles = s.filter((p) => !esDomingo(p.dia));
  const promedioHabil = habiles.length ? total / habiles.length : 0;
  const max = s.reduce((a, p) => Math.max(a, p.valor), 0);
  return { total, promedioHabil, max };
}
