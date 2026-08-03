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

/** Rendición de un día YA CERRADO vs el libro de pagos de ese día (por cobrador). */
export interface RendicionRecon {
  cobradorId: string;
  /** Día UY "YYYY-MM-DD" al que corresponde. */
  fecha: string;
  /** `recaudado` congelado en la rendición, o null si ese día NO rindió. */
  recaudadoRendicion: number | null;
  /** Σ pagos VIGENTES (no anulados) que registró ese día (recalculado del libro). */
  pagosSuma: number;
}

/**
 * INVARIANTE 8 — Rendición histórica == libro. Re-mira un día YA CERRADO (ayer):
 *  · rindió pero el libro difiere → cobró DESPUÉS de rendir (efectivo sin sello de
 *    entrega) o se ANULÓ un pago después (rendición congelada descuadrada). Alto.
 *  · recaudó y NO rindió → la plata quedó en la calle sin rendición; al día
 *    siguiente desaparecía de todas las pantallas de cierre. Alto.
 * Sin esto, todo lo que pasa después del cierre muere a medianoche sin detector.
 */
export function invRendicionVsLibro(rows: readonly RendicionRecon[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const r of rows) {
    const libro = Math.round(r.pagosSuma);
    if (r.recaudadoRendicion == null) {
      if (libro >= DRIFT_TOL) {
        out.push({
          invariante: "rendicion-existe",
          severidad: "alto",
          detalle: `cobrador ${r.cobradorId} (${r.fecha}): recaudó ${libro} y NO rindió (efectivo sin entregar)`,
        });
      }
      continue;
    }
    const delta = libro - Math.round(r.recaudadoRendicion);
    if (Math.abs(delta) >= DRIFT_TOL) {
      out.push({
        invariante: "rendicion==libro",
        severidad: "alto",
        detalle:
          `cobrador ${r.cobradorId} (${r.fecha}): rendición ${Math.round(r.recaudadoRendicion)} ≠ libro ${libro} ` +
          `(Δ ${delta}: ${delta > 0 ? "cobró DESPUÉS de rendir — efectivo sin sello" : "se anuló un pago tras rendir — histórico descuadrado"})`,
      });
    }
  }
  return out;
}

/** Gastos que una rendición descontó vs el respaldo real (aprobado) de ese día. */
export interface GastosRecon {
  cobradorId: string;
  fecha: string;
  /** `gastos` congelados en la rendición (lo que redujo el esperado). */
  gastosRendicion: number;
  /** Σ solicitudes APROBADAS con solicitado_en de ese día. */
  gastosAprobados: number;
  /** Σ solicitudes aún PENDIENTES de ese día (sin resolver). */
  gastosPendientes: number;
}

/**
 * INVARIANTE 9 — Gastos de la rendición respaldados por APROBADOS (D+1). El cierre
 * admite pendientes en el tope (a propósito: no castigar al honesto cuyo supervisor
 * aprueba tarde); esta invariante re-mira AYER, cuando ya hubo tiempo de resolver:
 *  · gastos > aprobados y el hueco NO lo cubren pendientes → el gasto se RECHAZÓ
 *    después del cierre: la rendición descontó plata que no existió (faltante
 *    invisible). Alto.
 *  · gastos > aprobados pero hay pendientes que lo cubren → falta RESOLVER la
 *    solicitud que respaldó una rendición. Medio (perseguir al aprobador).
 */
export function invGastosRendicion(rows: readonly GastosRecon[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const r of rows) {
    const gastos = Math.round(r.gastosRendicion);
    const aprobados = Math.round(r.gastosAprobados);
    const pendientes = Math.round(r.gastosPendientes);
    const exceso = gastos - aprobados;
    if (exceso < DRIFT_TOL) continue;
    if (pendientes >= exceso) {
      out.push({
        invariante: "gastos-respaldados",
        severidad: "medio",
        detalle: `cobrador ${r.cobradorId} (${r.fecha}): la rendición descontó ${gastos} con ${pendientes} aún PENDIENTES de aprobar — resolver la solicitud`,
      });
    } else {
      out.push({
        invariante: "gastos-respaldados",
        severidad: "alto",
        detalle: `cobrador ${r.cobradorId} (${r.fecha}): la rendición descontó ${gastos} pero lo aprobado es ${aprobados} (hueco ${exceso} sin respaldo — ¿gasto rechazado tras el cierre?)`,
      });
    }
  }
  return out;
}

/** Un crédito ACTIVO y a quién le toca cobrarlo, según cada una de las dos fuentes. */
export interface RutaRecon {
  creditoId: string;
  /** Saldo pendiente (lo que falta cobrar). Dimensiona la gravedad. */
  saldo: number;
  /** ¿El cliente tiene ALGUNA asignación activa? false = no está en ninguna ruta. */
  tieneRuta: boolean;
  /** `clientes.activo`. Un cliente archivado desaparece de la ruta del cobrador
   *  (getRutaDelDia filtra activo=true) pero su deuda sigue contando en la cartera
   *  del admin (app_cartera_activa no filtra) → nadie lo cobra y el capital "existe". */
  clienteActivo: boolean;
  /** `prestamos.cobrador_id` — de acá salen las COMISIONES. */
  duenoCredito: string | null;
  /** Cobradores con asignación activa sobre el cliente — de acá sale la RUTA real. */
  cobradoresEnRuta: readonly string[];
}

/**
 * INVARIANTE 10 — Todo crédito ACTIVO tiene ruta, y su dueño es quien lo cobra.
 *
 * Dos fuentes describen "de quién es" un crédito: `asignaciones` arma la ruta que
 * ve el cobrador, y `prestamos.cobrador_id` decide la COMISIÓN. Nada las ataba:
 *  · sin asignación activa → plata en la calle que NO aparece en la ruta de nadie
 *    (el "cliente fantasma"). Nadie lo visita, nadie lo reclama, y ninguna pantalla
 *    lo lista: se descubrió recién en una auditoría manual (46 créditos / $634.666).
 *    Crítico: es cartera que se pierde en silencio.
 *  · con ruta pero dueño distinto → el que camina la calle cobra y la comisión se
 *    le paga a otro. Alto: no se pierde capital, pero sí sale plata mal dirigida.
 * Un crédito cuyo dueño es UNO de varios cobradores en ruta es legítimo (0038).
 */
export function invRutaCredito(rows: readonly RutaRecon[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const r of rows) {
    // Cliente ARCHIVADO con crédito vivo: el otro sabor de fantasma. Sale de la
    // ruta del cobrador (que filtra clientes.activo) pero su saldo sigue sumando
    // en la cartera del admin → deuda que nadie va a cobrar nunca.
    if (!r.clienteActivo) {
      out.push({
        invariante: "credito-de-cliente-archivado",
        severidad: "critico",
        creditoId: r.creditoId,
        detalle: `crédito ACTIVO con saldo ${Math.round(r.saldo)} de un cliente ARCHIVADO: no aparece en ninguna ruta pero sigue contando en la cartera`,
      });
      continue;
    }
    if (!r.tieneRuta || r.cobradoresEnRuta.length === 0) {
      out.push({
        invariante: "credito-sin-ruta",
        severidad: "critico",
        creditoId: r.creditoId,
        detalle: `crédito ACTIVO con saldo ${Math.round(r.saldo)} sin asignación: no está en la ruta de ningún cobrador`,
      });
      continue;
    }
    if (r.duenoCredito && !r.cobradoresEnRuta.includes(r.duenoCredito)) {
      out.push({
        invariante: "comision-desalineada",
        severidad: "alto",
        creditoId: r.creditoId,
        detalle: `la comisión va a ${r.duenoCredito} pero lo cobra ${r.cobradoresEnRuta.join("/")}`,
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
