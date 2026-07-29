// ─────────────────────────────────────────────────────────────────────────
//  NÚCLEO de RECONCILIACIÓN DE DINERO (puro, sin DB → testeable).
//
//  "Una fintech seria no verifica que la plata cuadra UNA vez en la demo: lo
//  verifica cada día como monitoreo permanente, y trata cada divergencia como un
//  incidente." (patrón de la industria: Formance/Stripe reconciliation.)
//
//  Este módulo define las INVARIANTES de dinero de Presta Ya y las evalúa sobre
//  datos ya traídos. El job/endpoint/script que lo usa hace el fetch; acá vive la
//  lógica, aislada y con tests. Todo el dinero es ENTERO (centavos ya redondeados),
//  así que la tolerancia de drift es 0: cualquier diferencia es un hallazgo.
// ─────────────────────────────────────────────────────────────────────────

export type Severidad = "critico" | "alto" | "medio";

export interface Hallazgo {
  /** Nombre corto de la invariante violada. */
  invariante: string;
  severidad: Severidad;
  /** Crédito afectado (si aplica). */
  creditoId?: string;
  detalle: string;
}

/** Un crédito con lo mínimo para las invariantes de saldo. */
export interface CreditoRecon {
  id: string;
  estado: string;
  /** Saldo pagado DENORMALIZADO (trigger 0063). */
  pagadoAcum: number;
  /** Σ de pagos VIGENTES (no anulados) RECALCULADO desde el libro. */
  pagosSuma: number;
  /** Monto total a pagar = cuota_diaria × total_dias. */
  totalAPagar: number;
  /** Cuota diaria — para dimensionar la severidad de un sobre-cobro (un exceso
   *  menor a una cuota suele ser redondeo del último pago; ≥ una cuota es real). */
  cuotaDiaria: number;
}

// Dinero entero: cualquier diferencia ≥ 1 es real (no hay decimales legítimos).
const DRIFT_TOL = 1;

/**
 * INVARIANTE 1 — `pagado_acum` (denormalizado) == Σ pagos (recalculado).
 * Si difieren, el trigger de denormalización se rompió o alguien tocó el campo a
 * mano → los saldos, la mora y la cartera que muestra la app MIENTEN. Crítico.
 */
export function invPagadoAcum(creditos: readonly CreditoRecon[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const c of creditos) {
    const drift = c.pagadoAcum - c.pagosSuma;
    if (Math.abs(drift) >= DRIFT_TOL) {
      out.push({
        invariante: "pagado_acum==Σpagos",
        severidad: "critico",
        creditoId: c.id,
        detalle: `denormalizado ${c.pagadoAcum} ≠ recalculado ${c.pagosSuma} (drift ${drift})`,
      });
    }
  }
  return out;
}

/**
 * INVARIANTE 2 — Ningún crédito puede tener pagado > total a pagar.
 * Un sobre-cobro es plata cobrada de más a un deudor (o un pago mal imputado).
 * Money-critical: nunca debería pasar (la app lo evita, esto lo detecta si falla).
 */
export function invSobrecobro(creditos: readonly CreditoRecon[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const c of creditos) {
    const exceso = c.pagosSuma - c.totalAPagar;
    if (exceso >= DRIFT_TOL) {
      // MATERIAL (se cobró de más de verdad) si el exceso es ≥ una cuota diaria O
      // ≥ 5% del total. Si no, es redondeo del último pago (ruido de baseline). Se
      // usan las DOS medidas porque un crédito de pocas cuotas grandes tiene la
      // cuota enorme (el % lo cacha) y uno de muchas cuotas chicas al revés.
      const material =
        (c.cuotaDiaria > 0 && exceso >= c.cuotaDiaria) ||
        (c.totalAPagar > 0 && exceso >= c.totalAPagar * 0.05);
      out.push({
        invariante: "no-sobrecobro",
        severidad: material ? "critico" : "medio",
        creditoId: c.id,
        detalle: `pagado ${c.pagosSuma} > total ${c.totalAPagar} (exceso ${exceso}${material ? ", MATERIAL" : ", redondeo"})`,
      });
    }
  }
  return out;
}

/**
 * INVARIANTE 3 — Consistencia del RECAUDO del día entre sus tres vistas: el libro
 * de pagos, el arqueo de caja y el dashboard deben coincidir. La divergencia
 * "recaudo dashboard ≠ caja" fue un bug histórico: era una invariante rota sin
 * monitoreo. Devuelve un hallazgo si dos fuentes no cuadran.
 */
export function invRecaudoDia(fuentes: {
  pagos: number;
  caja?: number | null;
  dashboard?: number | null;
}): Hallazgo[] {
  const out: Hallazgo[] = [];
  const comparar = (nombre: string, valor: number | null | undefined) => {
    if (valor == null) return;
    const drift = valor - fuentes.pagos;
    if (Math.abs(drift) >= DRIFT_TOL) {
      out.push({
        invariante: "recaudo-consistente",
        severidad: "alto",
        detalle: `${nombre} ${valor} ≠ libro de pagos ${fuentes.pagos} (drift ${drift})`,
      });
    }
  };
  comparar("caja", fuentes.caja);
  comparar("dashboard", fuentes.dashboard);
  return out;
}

/**
 * INVARIANTE 4 — Cero pagos HUÉRFANOS (pago cuyo crédito no existe). El script
 * pasa el conteo ya calculado (es una consulta, no lógica). Un huérfano es plata
 * en el libro que no cuelga de ningún crédito → imposible de conciliar.
 */
export function invHuerfanos(cantidad: number): Hallazgo[] {
  if (cantidad <= 0) return [];
  return [
    {
      invariante: "sin-huerfanos",
      severidad: "critico",
      detalle: `${cantidad} pago(s) sin crédito asociado`,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────
//  INVARIANTES de lo NUEVO (07-29): estrellas, base de caja, ventas de tienda.
//  Son dinero-adyacentes y hasta hoy no tenían monitoreo. Puras y testeables.
// ─────────────────────────────────────────────────────────────────────────

/** Estrellas ganadas (derivadas de pagos) vs redimidas (aprobadas) por cliente. */
export interface EstrellasRecon {
  clienteId: string;
  estrellasGanadas: number;
  estrellasRedimidas: number;
}

/**
 * INVARIANTE 5 — Estrellas: nadie redimió MÁS estrellas de las que ganó
 * (redención "fantasma"). El saldo se DERIVA de los pagos vigentes; una
 * redención aprobada por encima de lo ganado es un beneficio entregado sin
 * respaldo (el TOCTOU diferido de la auditoría). Crítico si aparece.
 */
export function invEstrellasFantasma(rows: readonly EstrellasRecon[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const r of rows) {
    const g = Math.round(r.estrellasGanadas);
    const red = Math.round(r.estrellasRedimidas);
    if (red > g) {
      out.push({
        invariante: "estrellas-no-fantasma",
        severidad: "critico",
        creditoId: r.clienteId,
        detalle: `cliente redimió ${red} estrella(s) pero ganó ${g}`,
      });
    }
  }
  return out;
}

/** Base declarada en la apertura vs base usada en el cierre (rendición) del día. */
export interface BaseCajaRecon {
  cobradorId: string;
  fecha: string;
  baseApertura: number;
  /** null si el cobrador aún no rindió (no aplica el chequeo). */
  baseRendicion: number | null;
}

/**
 * INVARIANTE 6 — Base de caja consistente: la base con la que se CERRÓ la jornada
 * es la MISMA que se declaró en la apertura. Una base editada DESPUÉS del cierre
 * cambia el "esperado = base + recaudado − gastos" a posteriori y puede
 * enmascarar un faltante. Alto (operativo, no corrompe el libro).
 */
export function invBaseCaja(rows: readonly BaseCajaRecon[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const r of rows) {
    if (r.baseRendicion == null) continue; // aún no rindió → no aplica
    if (Math.abs(Math.round(r.baseApertura) - Math.round(r.baseRendicion)) >= DRIFT_TOL) {
      out.push({
        invariante: "base-caja-consistente",
        severidad: "alto",
        detalle: `cobrador ${r.cobradorId} (${r.fecha}): base apertura ${r.baseApertura} ≠ base cierre ${r.baseRendicion}`,
      });
    }
  }
  return out;
}

/** Un lead de tienda con su estado y el crédito al que dice apuntar. */
export interface LeadRecon {
  leadId: string;
  estado: string;
  prestamoId: string | null;
  /** ¿Existe ese crédito en la base? */
  prestamoExiste: boolean;
  /** origen del crédito apuntado ('tienda' esperado), o null. */
  prestamoOrigen: string | null;
}

/**
 * INVARIANTE 7 — Tienda lead→crédito: todo lead 'convertida' apunta a UN crédito
 * existente de origen 'tienda'. Detecta una conversión rota (lead marcado
 * convertido sin crédito real, o apuntando a un préstamo que no es de venta) →
 * deuda de tienda mal trazada. Crítico si no hay crédito; alto si el origen no cuadra.
 */
export function invLeadConvertido(rows: readonly LeadRecon[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const r of rows) {
    if (r.estado !== "convertida") continue;
    if (!r.prestamoId || !r.prestamoExiste) {
      out.push({
        invariante: "lead-convertido-consistente",
        severidad: "critico",
        detalle: `lead ${r.leadId} marcado 'convertida' sin crédito válido`,
      });
    } else if (r.prestamoOrigen !== "tienda") {
      out.push({
        invariante: "lead-convertido-consistente",
        severidad: "alto",
        detalle: `lead ${r.leadId} apunta a un crédito de origen '${r.prestamoOrigen}' (esperado 'tienda')`,
      });
    }
  }
  return out;
}

export interface ResumenReconciliacion {
  ok: boolean;
  totalCreditos: number;
  hallazgos: Hallazgo[];
  /** Conteo de hallazgos por invariante (para el resumen/alerta). */
  porInvariante: Record<string, number>;
  /** El peor nivel de severidad presente (o null si todo cuadra). */
  peorSeveridad: Severidad | null;
}

const ORDEN_SEV: Record<Severidad, number> = { critico: 3, alto: 2, medio: 1 };

/**
 * Corre TODAS las invariantes de saldo por-crédito + las extra ya computadas
 * (recaudo del día, huérfanos) y arma el resumen. `ok` = la plata cuadra.
 */
export function reconciliar(
  creditos: readonly CreditoRecon[],
  extra: readonly Hallazgo[] = [],
): ResumenReconciliacion {
  const hallazgos: Hallazgo[] = [
    ...invPagadoAcum(creditos),
    ...invSobrecobro(creditos),
    ...extra,
  ];
  const porInvariante: Record<string, number> = {};
  let peor: Severidad | null = null;
  for (const h of hallazgos) {
    porInvariante[h.invariante] = (porInvariante[h.invariante] ?? 0) + 1;
    if (!peor || ORDEN_SEV[h.severidad] > ORDEN_SEV[peor]) peor = h.severidad;
  }
  return {
    ok: hallazgos.length === 0,
    totalCreditos: creditos.length,
    hallazgos,
    porInvariante,
    peorSeveridad: peor,
  };
}
