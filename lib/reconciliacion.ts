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

// ── INV11/INV12 — SALUD DE FORMA de los créditos activos (auditoría 08-05) ──
export interface CreditoForma {
  creditoId: string;
  /** Vino del empalme con Disapp (disapp_credit_id). */
  importado: boolean;
  capital: number;
  totalCredito: number;
  pagado: number;
}

/**
 * INVARIANTE 11 — Ningún crédito IMPORTADO debe quedar `activo` estando saldado.
 * INVARIANTE 12 — El total del crédito (cuota×días) nunca es menor que el capital.
 *
 * Las dos nacieron de la presentación del 08-05: el empalme dejó 678 créditos que
 * Disapp ya había cerrado como `activo`-saldado (una línea de diseño), y NINGUNA
 * invariante lo miraba — 915 fichas con "N créditos activos", mora inflada y
 * Renovar ofreciendo muertos. INV11 caza el saldado-activo SOLO en importados
 * (un nativo recién saldado es transitorio legítimo: espera su renovación).
 * INV12 caza el interés negativo (total < capital = el crédito PIERDE plata por
 * construcción): corrupción estática del dato, venga de donde venga.
 */
export function invFormaCreditoActivo(rows: readonly CreditoForma[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const r of rows) {
    // Tolerancia $50: Disapp trae 13 créditos con cuota×cuotas $2-12 por debajo
    // del capital (redondeo de SU lado, copiado fiel — $132 en total). Eso no es
    // el bug que INV12 caza (el real destruye MILES por crédito); alertarlo cada
    // mañana sería ruido que desgasta la señal.
    if (r.totalCredito < r.capital - 50) {
      out.push({
        invariante: "interes-negativo",
        severidad: "alto",
        creditoId: r.creditoId,
        detalle: `cuota×días = ${Math.round(r.totalCredito)} < capital prestado ${Math.round(r.capital)}: el crédito pierde plata por construcción`,
      });
    }
    if (r.importado && r.pagado >= r.totalCredito - 0.5 && r.totalCredito > 0) {
      const exceso = Math.round(r.pagado - r.totalCredito);
      out.push({
        invariante: "importado-saldado-sin-finalizar",
        severidad: "alto",
        creditoId: r.creditoId,
        detalle:
          `crédito importado SALDADO pero aún activo${exceso > 0 ? ` (sobre-cobrado $${exceso})` : ""}: ` +
          `Disapp ya lo cerró — finalizarlo (deforma fichas, mora y Renovar)`,
      });
    }
  }
  return out;
}

// ── INV13 — BASE ENTREGADA QUE NADIE VOLVIÓ A PEDIR (auditoría 10-08) ──────
export interface AperturaHuerfana {
  cobradorId: string;
  cobradorNombre: string;
  /** "YYYY-MM-DD" del día en que se le entregó la base. */
  fecha: string;
  monto: number;
  /** ¿Ese cobrador rindió ESE día o alguno posterior? */
  rindioDespues: boolean;
  /** Días que pasaron desde la entrega hasta hoy. */
  diasSinRendir: number;
}

/**
 * INVARIANTE 13 — a quien se le entregó BASE, en algún momento tiene que rendir.
 *
 * ⚠️ Es el hueco que ninguna invariante miraba. INV6 (`invBaseCaja`) revisa que la
 * base no se haya EDITADO después del cierre, y se auto-excluye justamente cuando
 * no hay cierre (`if (r.baseRendicion == null) continue`) — o sea, el caso
 * peligroso quedaba fuera por diseño.
 *
 * Medido el 10-08: se entregaron $583.054 de base a 10 cobradores (9 el 06-08, 1 el
 * 08-08) y NINGUNO rindió ese día. La base no arrastra —eso está bien, es la regla—
 * pero desaparece de todas las pantallas al día siguiente: plata que salió de la
 * caja central, está en el bolsillo de alguien, y no la reclama nadie.
 *
 * NO se marca el mismo día (el cobrador todavía está en la calle): recién a partir
 * del día siguiente es un hallazgo. Puro.
 */
export function invBaseSinRendir(rows: readonly AperturaHuerfana[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const r of rows) {
    if (r.rindioDespues || r.diasSinRendir < 1 || r.monto <= 0) continue;
    out.push({
      invariante: "base_sin_rendir",
      // Un día es olvido; tres días es plata de la empresa sin dueño declarado.
      severidad: r.diasSinRendir >= 3 ? "alto" : "medio",
      detalle:
        `${r.cobradorNombre}: se le entregó base de $${Math.round(r.monto)} el ${r.fecha} ` +
        `y no rindió ninguna jornada desde entonces (${r.diasSinRendir} día${r.diasSinRendir === 1 ? "" : "s"}). ` +
        `Esa plata salió de la caja y no la está pidiendo ninguna pantalla.`,
    });
  }
  return out;
}

// ── INV14 — GASTO APROBADO SIN SU SALIDA DE CAJA (auditoría 10-08) ─────────
export interface GastoAprobadoRecon {
  solicitudId: string;
  cobradorNombre: string;
  monto: number;
  /** "YYYY-MM-DD" en que se resolvió. */
  fecha: string;
  /** ¿Existe el movimiento de caja (egreso) que le corresponde? */
  tieneEgreso: boolean;
  /** ¿Quedó registrado en `auditoria` quién lo aprobó? */
  tieneAuditoria: boolean;
}

/**
 * INVARIANTE 14 — todo gasto APROBADO tiene su egreso en el libro de caja.
 *
 * Cierra las dos puntas de un mismo agujero:
 *  · El egreso que EXISTIÓ y no está. Medido: `movimientos_caja` tiene 0 filas pero
 *    la base registra 3 inserciones y 3 borrados; el único gasto aprobado del
 *    piloto (Valentina, $1.000 de combustible) tiene su solicitud, su fila de
 *    auditoría y su descuento en la rendición — y su egreso desapareció. Por eso
 *    /admin/caja subdeclara los gastos en exactamente $1.000. (La 0138 le puso el
 *    candado de borrado; esto lo DETECTA si vuelve a pasar por otra vía.)
 *  · El gasto que nunca fue aprobado por nadie. Antes de la 0137, un cobrador podía
 *    insertar una solicitud ya "aprobada" y firmada con el nombre del admin: se
 *    bajaba el esperado del cierre y NO aparecía en ninguna bandeja, porque las
 *    bandejas listan los pendientes. Un aprobado sin egreso ni auditoría es
 *    exactamente esa firma que nadie puso.
 * Puro.
 */
export function invGastoSinEgreso(rows: readonly GastoAprobadoRecon[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const r of rows) {
    if (r.monto <= 0) continue;
    if (!r.tieneEgreso && !r.tieneAuditoria) {
      out.push({
        invariante: "gasto_aprobado_sin_firma",
        severidad: "critico",
        detalle:
          `${r.cobradorNombre}: gasto de $${Math.round(r.monto)} del ${r.fecha} figura APROBADO ` +
          `y no tiene ni egreso de caja ni registro de quién lo aprobó. Baja el esperado del ` +
          `cierre sin que nadie lo haya autorizado.`,
      });
      continue;
    }
    if (!r.tieneEgreso) {
      out.push({
        invariante: "gasto_sin_egreso",
        severidad: "alto",
        detalle:
          `${r.cobradorNombre}: gasto de $${Math.round(r.monto)} del ${r.fecha} está aprobado y ` +
          `descontado del cierre, pero no tiene su salida en el libro de caja (la caja subdeclara ese monto).`,
      });
    }
  }
  return out;
}

// ── INV15 — EL LIBRO DE PAGOS CONTRA LA BITÁCORA (auditoría 10-08) ─────────
export interface JornadaBitacora {
  cobradorId: string;
  cobradorNombre: string;
  /** "YYYY-MM-DD" del día UY. */
  fecha: string;
  /** Cobros que la BITÁCORA de campo registró ese día (el acto físico). */
  cobrosBitacora: number;
  /** Pagos VIGENTES en el libro para esos actos. */
  pagosLibro: number;
  /** Pagos ANULADOS ese día (son legítimos: el cobrador deshizo). */
  pagosAnulados: number;
  /** Plata que la bitácora dice que se cobró y el libro no tiene. */
  montoFaltante: number;
}

/**
 * INVARIANTE 15 — cada cobro de la bitácora tiene su pago en el libro.
 *
 * ⚠️ Es la invariante que habría cazado el peor caso de trazabilidad del piloto.
 * El acta de Valentina Ramírez del 03-08 dice recaudado $220.960 en 45 cobros, y
 * hoy en la base NO hay un solo pago que la respalde: un script de limpieza abrió
 * la escotilla `permitir_borrado_pagos` el 04-08 y los borró creyendo que eran
 * pruebas. La bitácora, que es otra tabla y nadie tocó, conserva los 50 cobros de
 * esa noche menos los 4 que ella misma deshizo = exactamente 45 y $220.960.
 *
 * O sea: la bitácora y el libro son DOS testigos independientes del mismo hecho, y
 * cuando uno desaparece el otro lo delata. Ninguna pantalla comparaba los dos.
 *
 * Los ANULADOS no son un hallazgo: deshacer un cobro es una operación legítima y
 * deja su propio rastro. Lo que se busca es el pago que no está ni vigente ni
 * anulado — o sea, borrado. Puro.
 */
export function invBitacoraVsLibro(rows: readonly JornadaBitacora[]): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const r of rows) {
    const sinRastro = r.cobrosBitacora - r.pagosLibro - r.pagosAnulados;
    if (sinRastro <= 0) continue;
    out.push({
      invariante: "bitacora_sin_libro",
      severidad: "critico",
      detalle:
        `${r.cobradorNombre} (${r.fecha}): la bitácora registró ${r.cobrosBitacora} cobros y el ` +
        `libro tiene ${r.pagosLibro} vigentes + ${r.pagosAnulados} anulados. Faltan ${sinRastro} ` +
        `pagos${r.montoFaltante > 0 ? ` por $${Math.round(r.montoFaltante)}` : ""}: no fueron ` +
        `anulados, fueron BORRADOS. El cartón de esos clientes perdió su historial.`,
    });
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
