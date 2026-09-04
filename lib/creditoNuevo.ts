// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — NÚCLEO puro del ALTA de un crédito NUEVO.
//
//  El caso que cubre: un cliente que HOY no tiene crédito activo y vuelve a
//  pedir. Hasta ahora la ÚNICA forma de colocar capital era `renovarCredito`,
//  que exige un crédito anterior en estado 'activo' y saldado — así que quien
//  terminaba de pagar y volvía días después quedaba fuera del sistema (el mismo
//  síntoma reportado en Disapp: "termina el crédito, vuelve a los pocos días y
//  no lo deja").
//
//  ⚠️ MANEJA DINERO. Client-safe (sin React/IO): el navegador previsualiza con
//  estas funciones y el servidor RECALCULA con las MISMAS, así el formulario no
//  puede alterar la cuota. Sin float: todo pasa por Math.round.
// ─────────────────────────────────────────────────────────────────────────
import {
  calcularCuotaRenovacion,
  tasaImplicita,
  DIAS_POR_FRECUENCIA,
  type TerminosAnterior,
} from "./renovacion";

/** Interés total (%) por defecto cuando el cliente NO tiene historial de crédito.
 *  Sale de la cartera real: 2.086 de los 2.300 créditos activos están al 20%. */
export const INTERES_DEFECTO_PCT = 20;

/**
 * Interés total (%) implícito en los términos de un crédito previo, para mostrarlo
 * y pre-cargarlo. `null` si no hay base de la que derivarlo.
 * Ej.: prestó 10.000 y devuelve 12.000 → 20%.
 */
export function interesDeBase(base: TerminosAnterior | null): number | null {
  if (!base || !(base.monto > 0) || !(base.cuota > 0) || !(base.totalDias > 0)) return null;
  const pct = (tasaImplicita(base) - 1) * 100;
  // ⚠️ Una tasa por DEBAJO del 1% no es la tasa del cliente: es un dato roto. Hay
  // 192 créditos activos al 0% ($72.113.554) más 82 entre 0 y 1% ($7.764.720),
  // todos heredados de Disapp — y CERO créditos entre 1% y 3%: la tasa real más
  // baja del negocio es 3%. Devolver estas micro-tasas hacía que la app propusiera
  // créditos que no ganan nada o que pierden (JOSE RODRÍGUEZ: $5.000 → "paga en
  // total $4.992"; GUSTAVO FERRAGUT: $94.500 al 0,03% → $25 de ganancia por ciclo
  // en vez de ~$18.900). Se cae al interés del negocio; las tasas reales (3%,
  // 3,5%, 10-19%, 20%) quedan por encima del umbral y se respetan tal cual.
  if (!Number.isFinite(pct) || pct < 1) return null;
  return Math.round(pct * 10) / 10; // una decimal: la tasa histórica rara vez es entera
}

/**
 * Cuota del crédito nuevo:
 *  · CON historial → arrastra la tasa del último crédito del cliente (misma
 *    fórmula exacta que la renovación: el que vuelve no estrena condiciones).
 *  · SIN historial → interés explícito que carga el gestor:
 *      cuota = round( monto × (1 + interés/100) / cuotas ).
 * Devuelve 0 si algún término es inválido (el llamador valida > 0).
 */
export function calcularCuotaCreditoNuevo(
  base: TerminosAnterior | null,
  monto: number,
  cuotas: number,
  interesPct: number,
): number {
  if (!(monto > 0) || !(cuotas > 0)) return 0;
  // ⚠️ Solo se arrastra la tasa del anterior si es una tasa DE VERDAD (> 0). Con la
  // base rota de Disapp (0%), esta rama devolvía una cuota que hacía que el crédito
  // nuevo devolviera menos que el capital. `calcularCuotaRenovacion` tiene su propio
  // piso, pero acá se decide ANTES cuál de las dos fórmulas manda, y con una base
  // de 0% la correcta es la del interés explícito.
  if (base && base.monto > 0 && base.cuota > 0 && base.totalDias > 0 && interesDeBase(base) != null) {
    return calcularCuotaRenovacion(base, monto, cuotas);
  }
  const i = Number.isFinite(interesPct) ? Math.max(0, interesPct) : 0;
  return Math.round((monto * (1 + i / 100)) / cuotas);
}

// ── DESHACER una venta (pedido de Carlos, 08-14) ───────────────────────────
//  El dedazo existe: un monto equivocado, el cliente que se arrepiente en la
//  vereda. Los créditos NO se borran (P0403, el libro es la verdad), así que
//  deshacer = pasarlo a estado 'cancelado' — y solo cuando NO pasó nada todavía.
//
//  La regla vive ACÁ, pura, porque la usan las dos puntas: el botón (para
//  decidir si se muestra y cuánto tiempo queda) y la Server Action (la verdad).
//  Pantalla y servidor con la MISMA función — la regla de hierro del proyecto.

// ─────────────────────────────────────────────────────────────────────────
//  ¿EL FORMATO ELEGIDO SE BANCA ESA CUOTA? (aviso, no candado)
//
//  El caso real: en "Nueva venta" no se podía elegir el formato y el crédito
//  nacía "diario". Una cobradora que trabaja SEMANAL cargaba $9.000 en 5 cuotas
//  de $2.160 y el sistema las programaba para 5 días seguidos: al sexto día el
//  cartón daba todo por vencido y el cliente —que venía al día— figuraba moroso.
//
//  La señal es la CUOTA como porcentaje del capital. Con el 20% de interés del
//  negocio, la cuota es ≈ 1,2 / cantidad de cuotas del capital: en 24-30 cuotas
//  diarias da 4-5%. Una cuota del 20% o más significa que el crédito se liquida
//  en 5 pagos o menos — eso no es cobro diario, es un plan semanal (o más largo).
//
//  ⚠️ AVISA, NO BLOQUEA. Hay créditos legítimos así (un préstamo a un solo pago),
//  y el cobrador es el que tiene al cliente enfrente: se le muestra la cuenta y
//  decide él. Puro y compartido pantalla=servidor.
// ─────────────────────────────────────────────────────────────────────────
import type { FrecuenciaPrestamo } from "@/types/db";

/** Desde qué peso de la cuota (sobre el capital) se considera "no es diario". */
export const CUOTA_PESADA_PCT = 20;
/** Hasta cuántas cuotas tiene sentido mirar: más que eso ya es un plan largo. */
export const CUOTAS_PLAN_CORTO = 8;

/**
 * Cuántos DÍAS DE COBRO puede durar un plan antes de que "se liquida en nada"
 * sea sospechoso. Es el umbral CALIBRADO CONTRA LA CARTERA VIVA (04-09).
 *
 * La señal correcta no es la cuota sobre el capital a secas —eso depende del
 * formato— sino la DURACIÓN del plan: cuotas × días de cobro por cuota. Así la
 * regla vale para los cuatro formatos con un solo número, porque el formato ya
 * está adentro de la cuenta.
 *
 * Medido sobre 3.133 activos (2.350 diarios, 709 semanales, 56 quincenales, 18
 * mensuales):
 *   · con este umbral disparan 11 créditos, de los cuales solo 2 nacieron en la
 *     app (el resto es cartera importada de Disapp, que no se toca desde acá);
 *   · sobre los 709 SEMANALES dispara CERO — que es el requisito duro: un
 *     semanal largo de capital grande (35 cuotas de $40.000 sobre $1.400.000)
 *     es un producto normal, y una versión anterior de esta regla gritaba sobre
 *     126 créditos legítimos por $67,5M. Un aviso que grita sobre cartera sana
 *     enseña a ignorarlo, y entonces tampoco se lee el que sí importa.
 */
export const DURACION_SOSPECHOSA_DIAS = 8;

export interface AvisoFormato {
  /** Texto para el cobrador, en criollo. */
  texto: string;
  /** Qué formato parece el correcto (para ofrecerlo de un toque). */
  sugerido: FrecuenciaPrestamo;
}

/**
 * Devuelve un aviso si la cuota no se condice con el formato elegido, o null si
 * está todo bien. `monto` y `cuota` en pesos enteros.
 */
export function avisoCoherenciaFormato(
  monto: number,
  cuota: number,
  cuotas: number,
  frecuencia: FrecuenciaPrestamo | null,
): AvisoFormato | null {
  const capital = Math.round(Number(monto) || 0);
  const c = Math.round(Number(cuota) || 0);
  const n = Math.round(Number(cuotas) || 0);
  if (!(capital > 0) || !(c > 0) || !(n > 0) || !frecuencia) return null;

  const pct = (c / capital) * 100;

  // ⚠️ EL PRÉSTAMO A UN PAGO NO SE TOCA. Con UNA sola cuota el formato apenas
  // decide qué día vence, y es un producto real del negocio: 7 créditos activos
  // hoy, varios clientes lo toman repetido (SANDRA PULERI lleva 7, LEONARDO
  // VOLPE 13). Avisarles sería acusar a la cartera sana.
  if (n < 2) return null;

  // ── La señal, AJUSTADA POR FORMATO ──────────────────────────────────────
  // Cuánto dura el plan en días de cobro. El formato entra por acá, así que un
  // solo umbral sirve para los cuatro: 5 cuotas diarias duran 5 días (raro), y
  // las mismas 5 cuotas semanales duran 30 (normal).
  const duracion = n * DIAS_POR_FRECUENCIA[frecuencia];

  // Dos condiciones a la vez, y las dos hacen falta:
  //  · el plan se liquida en un puñado de días de cobro, Y
  //  · la cuota se come una tajada del capital que no es de cobro fraccionado.
  // Con una sola, la regla barre cartera sana: por duración pelada caerían los
  // préstamos cortos legítimos; por cuota/capital pelada, los 126 semanales de
  // capital grande que ya se midieron ($67,5M).
  if (duracion <= DURACION_SOSPECHOSA_DIAS && pct >= CUOTA_PESADA_PCT) {
    // Qué formato haría que ese mismo plan tenga un plazo razonable: se busca el
    // más chico que llegue a ~un mes de cobro, para no proponer un salto brusco.
    const sugerido: FrecuenciaPrestamo =
      frecuencia === "diario" ? "semanal" : frecuencia === "semanal" ? "quincenal" : "mensual";
    const u = frecuencia === "diario" ? "día" : "cuota";
    return {
      texto:
        `Con cuota de ${pesos(c)} sobre ${pesos(capital)} (${Math.round(pct)}% del capital), ` +
        `en ${frecuencia.toUpperCase()} este crédito se termina de pagar en ${n} ${u}${n === 1 ? "" : "s"} ` +
        `(${duracion} día${duracion === 1 ? "" : "s"} de cobro). ` +
        `¿No es ${sugerido}?`,
      sugerido,
    };
  }

  // ⚠️ NO HAY CASO INVERSO. Lo hubo ("un plan largo de cuotas chicas marcado
  // semanal, ¿no es diario?") y se sacó el 04-09: medido contra la cartera viva,
  // disparaba en 126 créditos activos LEGÍTIMOS ($67,5 M) — los semanales largos
  // de capital grande son un producto normal (35 cuotas de $40.000 sobre
  // $1.400.000 = 2,9%). Un aviso que grita sobre cartera sana enseña a
  // ignorarlo, y entonces tampoco se lee el que sí importa.
  return null;
}

const pesos = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");

/** Ventana para deshacer: la misma HORA que tiene el "Deshacer" de un cobro. */
export const DESHACER_VENTA_MS = 60 * 60 * 1000;

export interface VentaParaDeshacer {
  estado: string;
  /** prestamos.origen ("credito" | "tienda" | "disapp_import" | null). */
  origen: string | null;
  /** Linaje de renovación: si existe, deshacerla reabriría el crédito anterior. */
  renovadoDe: string | null;
  creadoPor: string | null;
  /** ISO de creado_en. */
  creadoEn: string;
  tienePagos: boolean;
}

export type VeredictoDeshacer =
  | { ok: true; quedanMs: number }
  | { ok: false; motivo: string };

/**
 * ¿Este crédito se puede deshacer, y por qué no? Cada rechazo dice la salida
 * (nunca un callejón). Orden de chequeo: del más definitivo al más temporal.
 */
export function puedeDeshacerVenta(
  v: VentaParaDeshacer,
  yoId: string,
  ahoraMs: number,
): VeredictoDeshacer {
  if (v.creadoPor !== yoId)
    return { ok: false, motivo: "Este crédito lo colocó otra persona: que lo deshaga quien lo creó, o la oficina." };
  if ((v.origen ?? "credito") !== "credito")
    return { ok: false, motivo: "Este crédito no es de efectivo de la calle. Avisá a la oficina." };
  if (v.renovadoDe != null)
    return {
      ok: false,
      motivo:
        "Es una RENOVACIÓN: deshacerla tendría que reabrir el crédito anterior, y eso lo hace la oficina. Avisale a tu supervisor.",
    };
  if (v.estado !== "activo")
    return { ok: false, motivo: "Este crédito ya no está activo." };
  if (v.tienePagos)
    return {
      ok: false,
      motivo: "El cliente ya pagó una cuota de este crédito: ya no se puede deshacer. Avisá a la oficina.",
    };
  const edad = ahoraMs - new Date(v.creadoEn).getTime();
  if (!Number.isFinite(edad) || edad < 0)
    return { ok: false, motivo: "No se pudo verificar la hora del crédito. Avisá a la oficina." };
  if (edad > DESHACER_VENTA_MS)
    return {
      ok: false,
      motivo: "Pasó más de una hora desde que lo colocaste: ya no se deshace solo. Avisá a la oficina.",
    };
  return { ok: true, quedanMs: DESHACER_VENTA_MS - edad };
}

// ── CANCELAR una venta desde el PANEL (queja del admin 16-08: "poder eliminar
//    ventas que se hagan malas") ─────────────────────────────────────────────
//  Los créditos NUNCA se borran (P0403): una venta mala se CANCELA (estado
//  "cancelado" — el colocado, el arrastre de caja y el informe ya lo excluyen).
//  La regla del cobrador (1 h, propio, sin pagos) es la de la calle; la del
//  GESTOR es más ancha (cualquier crédito de su alcance, sin ventana de tiempo)
//  y con las mismas dos verdades de fondo: sin pagos vigentes (si hay, se
//  ANULAN primero, uno por uno con motivo — el libro no se toca en silencio) y
//  nunca la cartera importada (esa se corrige por empalme). Puro: pantalla y
//  servidor usan ESTA función.

export interface VentaParaCancelar {
  estado: string;
  origen: string | null;
  renovadoDe: string | null;
  /** Pagos NO anulados que apuntan a este crédito. */
  pagosVigentes: number;
  /** Suma de esos pagos (para decir la salida en pesos). */
  pagadoVigente: number;
}

export type VeredictoCancelar =
  | { ok: true; reabreAnterior: boolean; yaEstaba: boolean }
  | { ok: false; motivo: string };

export function puedeCancelarVentaPanel(
  v: VentaParaCancelar,
  actor: { rol: string; enAlcance: boolean },
): VeredictoCancelar {
  if (actor.rol !== "admin" && actor.rol !== "supervisor")
    return { ok: false, motivo: "Cancelar una venta lo hace la oficina (supervisor o administrador)." };
  if (!actor.enAlcance)
    return { ok: false, motivo: "Ese cliente no es de tu zona." };
  if (v.origen === "disapp_import")
    return { ok: false, motivo: "Es cartera importada de Disapp: se corrige por el empalme, no se cancela desde acá." };
  if (v.origen === "tienda" && actor.rol !== "admin")
    return { ok: false, motivo: "Las ventas de la tienda las cancela el administrador (devuelve el stock y cierra el pedido)." };
  if (v.estado === "cancelado")
    return { ok: true, reabreAnterior: false, yaEstaba: true };
  if (v.estado !== "activo")
    return { ok: false, motivo: `Este crédito ya no está activo (está ${v.estado}): no hay nada que cancelar.` };
  if (v.pagosVigentes > 0)
    return {
      ok: false,
      motivo: `Este crédito tiene ${v.pagosVigentes} pago${v.pagosVigentes === 1 ? "" : "s"} vigente${v.pagosVigentes === 1 ? "" : "s"} por $${v.pagadoVigente.toLocaleString("es-UY")}. Anulalos primero desde el historial (cada uno con su motivo) y volvé a cancelar.`,
    };
  return { ok: true, reabreAnterior: v.renovadoDe != null, yaEstaba: false };
}
