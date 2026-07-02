// ─────────────────────────────────────────────────────────────────────────
//  Núcleo PURO del RECARGO por mora (configurable). Client-safe y testeable.
//  NO altera el cartón (que es cuota×días inmutable): calcula un cargo APARTE
//  sobre la deuda vencida, que el equipo decide cobrar. Redondeo a peso.
//
//  Modos (frecuencia-agnósticos, en términos de "cuotas vencidas"):
//   · off  → 0
//   · fijo → `valor` $ por cada cuota vencida que exceda la gracia
//   · pct  → `valor` % de la deuda vencida (si supera la gracia)
//  Siempre acotado por `topePct` % de la deuda vencida (freno de usura).
// ─────────────────────────────────────────────────────────────────────────

export type ModoMora = "off" | "fijo" | "pct";

export interface ConfigMora {
  modo: ModoMora;
  /** $ por cuota vencida (fijo) o % de la deuda vencida (pct). */
  valor: number;
  /** Cuotas vencidas toleradas antes de aplicar recargo. */
  cuotasGracia: number;
  /** Tope del recargo como % de la deuda vencida (0 = sin tope). */
  topePct: number;
}

export const CONFIG_MORA_DEFAULT: ConfigMora = {
  modo: "off",
  valor: 0,
  cuotasGracia: 1,
  topePct: 30,
};

/**
 * Recargo por mora para un crédito, dado su monto vencido y cuántas cuotas
 * lleva vencidas. Determinista; nunca negativo; respeta gracia y tope.
 */
export function calcularRecargoMora(
  deudaVencida: number,
  cuotasVencidas: number,
  cfg: ConfigMora,
): number {
  if (cfg.modo === "off" || deudaVencida <= 0) return 0;
  const exceso = Math.max(0, Math.floor(cuotasVencidas) - Math.max(0, Math.floor(cfg.cuotasGracia)));
  if (exceso <= 0) return 0;

  let recargo = cfg.modo === "fijo" ? cfg.valor * exceso : deudaVencida * (cfg.valor / 100);
  recargo = Math.round(recargo);

  if (cfg.topePct > 0) {
    recargo = Math.min(recargo, Math.round(deudaVencida * (cfg.topePct / 100)));
  }
  return Math.max(0, recargo);
}

/** Descripción legible de la política (para la UI). */
export function describirMora(cfg: ConfigMora): string {
  if (cfg.modo === "off") return "Sin recargo por mora";
  const base =
    cfg.modo === "fijo"
      ? `$${cfg.valor.toLocaleString("es-UY")} por cuota vencida`
      : `${cfg.valor}% de la deuda vencida`;
  const gracia = cfg.cuotasGracia > 0 ? `, tras ${cfg.cuotasGracia} cuota(s) de gracia` : "";
  const tope = cfg.topePct > 0 ? ` (tope ${cfg.topePct}%)` : "";
  return `${base}${gracia}${tope}`;
}
