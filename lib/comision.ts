// ─────────────────────────────────────────────────────────────────────────
//  Núcleo PURO de COMISIONES. Client-safe y testeable.
//  comisión = recaudado × pct/100, redondeada a peso entero (sin float).
//  pct se acota a [0, 100].
// ─────────────────────────────────────────────────────────────────────────

export function calcularComision(recaudado: number, pct: number): number {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return Math.round((Number(recaudado) || 0) * (p / 100));
}
