// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RUTA del cobrador y ARQUEO del día.
//  Junta clientes asignados (RLS), su préstamo activo y el estado de HOY
//  (pagado / no pago / pendiente) desde pagos y visitas. Corte de día en UY.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cliente, FrecuenciaPrestamo } from "@/types/db";
import { mapCliente } from "./clientes";
import { inicioDiaUYIso, hoyUY } from "@/lib/fecha";
import { plazoVencido, cuotasDebidasHasta, totalCredito } from "@/lib/cartones";

// "abono" = pagó HOY pero menos que la cuota (abono parcial). Regla del negocio:
// un abono parcial NO cubre el día → no es "pagado", queda como pendiente-visto.
export type EstadoHoy = "pagado" | "abono" | "no_pago" | "pendiente" | "sin_credito";

export interface ItemRuta {
  cliente: Cliente;
  prestamoId: string | null;
  /** Lo COBRABLE hoy: cuota que vence + atraso arrastrado (tope una cuota). */
  cuota: number;
  /** De `cuota`, cuánto es ATRASO de días anteriores (no cuota de hoy). >0 con
   *  `cuota === atraso` = no le vence nada hoy pero debe: el cobrador pasa igual,
   *  y no cuenta en la meta del día. */
  atraso: number;
  estadoHoy: EstadoHoy;
  pagadoHoy: number;
  /** Posición en el recorrido que el cobrador se armó (asignaciones.orden, 0132).
   *  null = sin ordenar (va al final, por nombre). */
  orden: number | null;
  /** Semanal/quincenal AL DÍA sin cuota que venza hoy: se muestra "Hoy no toca"
   *  (no "Cobrado") y queda fuera de las cuentas del día. */
  sinCuotaHoy: boolean;
  /** Cliente cuyos créditos activos están TODOS de plazo vencido (cartera vencida):
   *  visible para recuperar, pero fuera del target del día (no infla "Falta $"). */
  plazoVencido: boolean;
  /** Plata RECUPERADA hoy sobre un cliente de cartera vencida (0 si no aplica). Se
   *  muestra en la tarjeta para que el cobrador NO vuelva a pasar y cobre de nuevo:
   *  su cobro no cuenta en la cuota del día, así que sin esto quedaba invisible. */
  recuperadoHoy: number;
}

export interface Arqueo {
  /** META del día: suma de las cuotas que VENCEN hoy. */
  esperado: number;
  /** ATRASO a recuperar hoy (cuotas de días anteriores impagas). Va aparte de la
   *  meta —la cuota de un semanal no vence 6 veces por semana— pero es plata real
   *  para cobrar: sin mostrarlo, la ruta decía "Completo ✓" con la calle llena. */
  atrasoEsperado: number;
  /** De ese atraso, lo que YA se recuperó hoy. */
  atrasoRecuperado: number;
  /** Todo lo cobrado hoy en la ruta (incluye recuperaciones de créditos vencidos). */
  recaudado: number;
  /** Cobrado hoy SOLO sobre cuotas EN TÉRMINO — para el % de avance y "Falta $X"
   *  (si se usara `recaudado`, una recuperación de deuda vieja mostraría "Completo ✓"
   *  con cuotas de hoy aún sin cobrar). */
  recaudadoRuta: number;
  cobrados: number;
  /** Clientes con abono PARCIAL hoy (pagó algo, no cubrió la cuota). */
  abonos: number;
  pendientes: number;
  noPagos: number;
  clientes: number;
}

export interface Ruta {
  items: ItemRuta[];
  arqueo: Arqueo;
}

const ARQUEO_VACIO: Arqueo = {
  esperado: 0,
  atrasoEsperado: 0,
  atrasoRecuperado: 0,
  recaudado: 0,
  recaudadoRuta: 0,
  cobrados: 0,
  abonos: 0,
  pendientes: 0,
  noPagos: 0,
  clientes: 0,
};

/**
 * Estado del cliente HOY según la CAJA COBRADA HOY (no el cartón). Mide "¿cuánto
 * me pagó hoy este cliente?": >= cuota → "pagado", 0<x<cuota → "abono" parcial,
 * 0 → pendiente/no-pago. Sirve para que el cobrador sepa a quién ya visitó/cobró.
 * OJO: NO es lo mismo que la celda de HOY del cartón (lib/cartones.ts), que aplica
 * el pago por FIFO a la cuota vencida más vieja — un cliente atrasado que paga 1
 * cuota queda "pagado" acá (cobró hoy) pero su cartón puede seguir con HOY pendiente.
 * Pura y testeable — fuente de verdad de los chips de la ruta y del arqueo.
 */
export function estadoHoyDe(
  pagadoHoy: number,
  cuota: number,
  esNoPago: boolean,
): EstadoHoy {
  // Tolerancia sub-peso (espejo del cartón, cartones.ts): la cuota importada de
  // Disapp puede ser fraccionaria (351,04) y el pago se asienta entero (351). Sin
  // el −0,5 un cobro COMPLETO se vería "abono" y la ruta nunca mostraría "Ruta
  // completa 🎉" ni cuadraría el arqueo del cobrador.
  if (cuota > 0 && pagadoHoy >= cuota - 0.5) return "pagado";
  if (pagadoHoy > 0) return "abono"; // pagó algo pero no cubrió la cuota
  if (esNoPago) return "no_pago";
  return "pendiente";
}

/**
 * Cuota-OBJETIVO de HOY de un crédito (lo que el cobrador debería cobrarle hoy):
 * lo que falta para estar AL DÍA según el cronograma, topeado a UNA cuota. Es 0
 * en los días sin cuota vencida, así el crédito no figura "Pendiente" ni suma al
 * "esperado" (hallazgo #5).
 *
 * ⚠️ Antes DIARIO tenía un atajo —`return c.cuota` sin mirar el calendario— porque
 * es el 80% de la cartera y "todos los días vence una cuota". No es cierto, y se
 * pagaba caro en tres casos REALES:
 *   · DOMINGO: no es día de cobro y ninguna cuota vence (lib/cartones.ts corre al
 *     lunes las que caen domingo). Con el atajo, el domingo la ruta le pedía la
 *     cuota entera a TODOS los clientes diarios al día: el "esperado" abría con la
 *     cartera completa, nadie podía llegar a "Ruta completa" y el arqueo del día
 *     nacía con un faltante que no existe.
 *   · TRAMO FINAL: a un crédito al que le quedan $200 le pedía la cuota entera de
 *     $750 — le cobraba de más al cliente e inflaba la meta del cobrador.
 *   · CRÉDITO QUE AÚN NO ARRANCÓ (fecha_inicio futura): pedía cuota desde antes
 *     del primer día.
 * La rama NO-DIARIO ya calculaba bien las tres cosas, así que ahora es UNA sola
 * fórmula para todas las frecuencias. Un cliente ATRASADO sigue viendo una cuota
 * (el `min` de abajo lo topea), que es la conducta de siempre.
 * Pura y testeable.
 */
export interface ObjetivoDelDia {
  /** Cuota PROGRAMADA que vence HOY (0 si hoy no le toca a este crédito). Es lo
   *  único que entra a la META del día. */
  cuotaHoy: number;
  /** Deuda ARRASTRADA de cuotas anteriores impagas (topeada a una cuota). Se le
   *  puede cobrar hoy, pero NO es meta de hoy. */
  mora: number;
}

/**
 * Parte el objetivo del día en LO QUE VENCE HOY y LO QUE VIENE ATRASADO.
 *
 * ⚠️ Regla de plata que costó el reporte de campo del día 2 ("los créditos
 * semanales siguen saliendo para pagar todos los días"): a un crédito SEMANAL le
 * vence UNA cuota por semana. Si no la paga el lunes, la deuda sigue viva de
 * martes a sábado — pero eso es MORA, no "la cuota de hoy". Sumarla a la meta
 * diaria hacía que:
 *   · al cliente se le pidiera la cuota entera los 6 días hábiles, como si
 *     debiera 6 cuotas en la semana en vez de una;
 *   · el cobrador persiguiera una meta imposible y nunca llegara a "Ruta completa".
 * Medido sobre la cartera viva el 07-08-2026: la app pedía $6.516.878 cuando lo
 * que vencía ese día eran $1.216.586 — el 81% era mora arrastrada, y solo en
 * semanales eran 544 créditos / $3.960.742.
 *
 * DOMINGO: ninguna cuota vence (fechaDeCuota corre al lunes las que caerían en
 * domingo) → `cuotaHoy` da 0 para TODOS. Antes el domingo la ruta abría pidiendo
 * $6.676.111 de una cartera en la que no vencía un solo peso.
 *
 * El cliente atrasado NO se esconde: la mora viaja aparte para poder mostrarla y
 * cobrarla. Lo único que cambia es que deja de contarse como cuota del día.
 * Pura y testeable.
 */
export function objetivoDelDia(
  c: { cuota: number; totalDias: number; fechaInicio: string; frecuencia: FrecuenciaPrestamo; pagadoAcum: number },
  hoy: Date,
): ObjetivoDelDia {
  const totalCred = c.cuota * c.totalDias;
  const calc = {
    cuota_diaria: c.cuota,
    total_dias: c.totalDias,
    fecha_inicio: c.fechaInicio,
    frecuencia: c.frecuencia ?? "diario",
  };
  const debidasHoy = cuotasDebidasHasta(calc, hoy);
  // Cuotas que ya vencían AYER: la diferencia con hoy es lo que vence HOY.
  const ayer = new Date(hoy);
  ayer.setDate(ayer.getDate() - 1);
  const debidasAyer = cuotasDebidasHasta(calc, ayer);

  // ⚠️ `pagadoAcum` debe ser lo pagado ANTES de hoy (el llamador resta el cobro de
  // hoy): el trigger 0063 lo actualiza en el insert, y si acá se restara el pago de
  // hoy, `estadoHoyDe`/`recaudadoRuta` lo descontarían DOS veces (cobro a medias se
  // vería "Cobrado" y el cobrador no iría por el resto).
  // Lo pagado se imputa a las cuotas MÁS VIEJAS primero, así que la deuda hasta
  // ayer es la MORA y lo que sobra hasta hoy es la cuota del día.
  const deudaHastaHoy = Math.max(0, Math.min(debidasHoy * c.cuota, totalCred) - c.pagadoAcum);
  const deudaHastaAyer = Math.max(0, Math.min(debidasAyer * c.cuota, totalCred) - c.pagadoAcum);

  // Tolerancia sub-peso (espejo del cartón): cuota fraccionaria + pagos enteros
  // dejan un residuo de centavos → sin esto el crédito no llega nunca a 0 (al día).
  const cuotaHoy = deudaHastaHoy - deudaHastaAyer;
  return {
    cuotaHoy: cuotaHoy < 0.5 ? 0 : Math.min(c.cuota, cuotaHoy),
    // La mora se topea a UNA cuota, igual que siempre: nunca se le pide al cliente
    // varias cuotas juntas de golpe.
    mora: deudaHastaAyer < 0.5 ? 0 : Math.min(c.cuota, deudaHastaAyer),
  };
}

/**
 * Lo que se le PIDE hoy al crédito: la cuota que vence hoy + lo que viene
 * atrasado, topeado a una cuota (el cliente nunca ve que se le pidan dos juntas).
 * Es el número del botón de cobro; la META del día usa solo `cuotaHoy`.
 */
export function cuotaObjetivoHoy(
  c: { cuota: number; totalDias: number; fechaInicio: string; frecuencia: FrecuenciaPrestamo; pagadoAcum: number },
  hoy: Date,
): number {
  const { cuotaHoy, mora } = objetivoDelDia(c, hoy);
  const total = cuotaHoy + mora;
  return total < 0.5 ? 0 : Math.min(c.cuota, total);
}

/** Un crédito activo del cliente: su cuota-OBJETIVO de hoy, lo cobrado HOY en él y
 *  si su PLAZO ya venció. `alDia`: crédito REAL (cuota_diaria>0) en término sin cuota
 *  vencida hoy (no-diario al día) → distingue "nada que cobrar" de "dato roto". */
export interface CreditoRuta {
  /** Lo que se le PIDE hoy (cuota que vence + mora arrastrada, tope una cuota). */
  cuota: number;
  pagadoHoy: number;
  plazoVencido: boolean;
  alDia?: boolean;
  /** Solo la cuota PROGRAMADA de hoy. Es lo que entra a la META del día: la mora
   *  de un semanal no puede contarse como cuota los 6 días de la semana. */
  cuotaProgramada?: number;
}

export interface ClaseClienteRuta {
  /** Suma de la cuota que VENCE HOY en los créditos EN TÉRMINO (la meta del día). */
  cuotaEnTermino: number;
  /** Atraso arrastrado que se le puede cobrar hoy PERO no es meta de hoy (la cuota
   *  de un semanal no vence 6 veces por semana). Visible, cobrable, fuera de la meta. */
  moraEnTermino: number;
  /** Cobrado HOY en créditos EN TÉRMINO (para el ESTADO del cliente y el chip "Abonó"). */
  pagadoHoyEnTermino: number;
  /** Cobrado HOY en TODOS los créditos (para el recaudo — la plata es plata). */
  pagadoHoyTotal: number;
  /** Tiene créditos activos pero TODOS de plazo vencido (cartera vencida pura). */
  soloVencido: boolean;
  estadoHoy: EstadoHoy;
  /** Cuenta para el denominador/target del día (los vencidos puros NO). */
  cuentaEnRuta: boolean;
  /** "Al día POR CRONOGRAMA sin cobro hoy" (semanal/quincenal sin cuota que
   *  venza): el estado interno es "pagado" (nada que cobrarle), pero mostrarlo
   *  como "Cobrado" a las 7 AM mentía — la ruta arrancaba "Cobrados 14/68" sin
   *  un peso cobrado (QA 08-05). La UI lo muestra "Hoy no toca" y las cuentas
   *  del día lo excluyen. */
  alDiaCronograma: boolean;
}

/**
 * Reparte los créditos ACTIVOS de un cliente entre "en término" (tienen cuota que
 * vence hoy → target del día y arqueo) y "vencidos" (cartera vencida: el plazo ya
 * terminó). Los vencidos puros quedan VISIBLES para recuperar, pero FUERA del
 * target del día: si se contaran, inflarían "Falta $X" y la "Ruta completa 🎉"
 * nunca llegaría (el cobrador persigue una cuota que ya no está programada).
 *
 * ⚠️ El ESTADO del cliente ("¿le cobré la cuota de HOY?") se deriva SOLO del cobro
 * sobre créditos EN TÉRMINO: si no, una RECUPERACIÓN sobre un crédito vencido (deuda
 * vieja) marcaría al cliente como "pagado" y el cobrador se saltaría la cuota de hoy
 * de su crédito vigente → cobro del día perdido. El recaudo (`pagadoHoyTotal`) SÍ
 * suma todo, porque la plata cobrada es plata.
 */
export function clasificarClienteRuta(
  creditos: CreditoRuta[],
  esNoPago: boolean,
): ClaseClienteRuta {
  const enTermino = creditos.filter((c) => !c.plazoVencido);
  // ⚠️ La META del día es lo que VENCE hoy, no lo que se le puede pedir. La mora
  // arrastrada de un semanal se cobra si el cliente puede, pero contarla como
  // cuota los 6 días hábiles le inventaba al cobrador una meta 5× la real.
  const cuotaEnTermino = enTermino.reduce((s, c) => s + (c.cuotaProgramada ?? c.cuota), 0);
  /** Atraso a recuperar hoy: lo que se le puede pedir por encima de la cuota del día. */
  const moraEnTermino = enTermino.reduce(
    (s, c) => s + Math.max(0, c.cuota - (c.cuotaProgramada ?? c.cuota)),
    0,
  );
  const pagadoHoyEnTermino = enTermino.reduce((s, c) => s + c.pagadoHoy, 0);
  const pagadoHoyTotal = creditos.reduce((s, c) => s + c.pagadoHoy, 0);
  // "Cartera vencida pura" = NO tiene ningún crédito EN TÉRMINO (todos con plazo
  // vencido). Antes se detectaba por `cuotaEnTermino === 0`, pero ahora un crédito
  // NO-diario AL DÍA (sin cuota hoy) también da cuota 0 sin estar vencido → se
  // confundía con cartera vencida. Con `enTermino.length` se distingue bien.
  const soloVencido = creditos.length > 0 && enTermino.length === 0;
  // AL DÍA hoy: TODOS sus créditos en término están al día por cronograma (no-diario
  // sin cuota vencida hoy) → "pagado" (nada que cobrar), no "pendiente". Se exige el
  // flag `alDia` (crédito real, cuota_diaria>0) para NO enmascarar un crédito roto
  // (cuota_diaria 0), que debe seguir visible como pendiente (igual que el cartón).
  const alDiaHoy = enTermino.length > 0 && enTermino.every((c) => c.alDia === true);
  // ⚠️ El ESTADO se mide contra lo COBRABLE (cuota de hoy + atraso), NO contra la
  // meta. Medirlo contra la meta sola tenía dos efectos feos:
  //   · el cliente MIXTO (un diario que vence hoy $750 + un semanal en mora $6.000)
  //     pagaba $750 y quedaba "Cobrado" en verde, con la tarjeta diciendo $6.750;
  //   · el que SOLO tenía mora (cuota de hoy 0) quedaba en "Abonó" para siempre por
  //     más que pagara todo, porque `estadoHoyDe` exige `cuota > 0` para dar "pagado".
  // La META sigue siendo solo `cuotaEnTermino`: eso no cambia.
  const cobrable = cuotaEnTermino + moraEnTermino;
  return {
    cuotaEnTermino,
    moraEnTermino,
    pagadoHoyEnTermino,
    pagadoHoyTotal,
    soloVencido,
    estadoHoy: alDiaHoy ? "pagado" : estadoHoyDe(pagadoHoyEnTermino, cobrable, esNoPago),
    cuentaEnRuta: !soloVencido,
    // Solo cuenta como "al día por cronograma" si NO hubo cobro hoy (si cobró,
    // es un "Cobrado" de verdad y las cuentas del día lo incluyen).
    // ⚠️ Con MORA viva NO es "hoy no toca": el cobrador tiene que pasar igual. Se
    // muestra como atraso a recuperar, fuera de la meta pero dentro de la ruta.
    alDiaCronograma: alDiaHoy && pagadoHoyEnTermino <= 0 && moraEnTermino <= 0.5,
  };
}

/** Ruta del cobrador logueado + arqueo del día (todo scopeado por RLS).
 *
 *  `cobradorId`: dueño de los créditos que se van a cobrar. Un cliente puede
 *  tener créditos de DOS cobradores distintos (regla del negocio) y estar en las
 *  dos rutas; sin este filtro cada uno veía la cuota de TODOS los créditos del
 *  cliente —los suyos y los del compañero— y salían los dos a cobrar el total
 *  (SONIA TELIS: $6.550 mostrados a ambos cuando a uno le tocaban $1.200).
 *  Si no se pasa, se conserva la conducta previa (sumar todos): los tests y
 *  cualquier llamador viejo siguen funcionando igual. */
export async function getRutaCobrador(
  db: SupabaseClient,
  hoy: Date = new Date(),
  cobradorId?: string | null,
): Promise<Ruta> {
  // Clientes del cobrador SCOPEADOS por sus asignaciones (RLS = suyas, indexado
  // por cobrador_id → devuelve ~decenas). Antes se hacía `select * from clientes`
  // dependiendo del RLS, que con 13k clientes evaluaba la política fila-por-fila
  // → statement timeout. Con `.in(ids)` el RLS solo se evalúa sobre esos ids.
  const { data: asigRaw, error: e0 } = await db
    .from("asignaciones")
    .select("cliente_id, orden")
    .eq("activo", true);
  if (e0) throw e0;
  const cliIds = [...new Set((asigRaw ?? []).map((a) => a.cliente_id as string))];
  if (cliIds.length === 0) return { items: [], arqueo: ARQUEO_VACIO };
  // Recorrido preestablecido (0132): posición elegida por el cobrador. Si el
  // cliente tiene varias asignaciones activas, gana la menor (más arriba).
  const ordenDe = new Map<string, number>();
  for (const a of asigRaw ?? []) {
    const o = a.orden == null ? null : Number(a.orden);
    if (o == null || !Number.isFinite(o)) continue;
    const prev = ordenDe.get(a.cliente_id as string);
    if (prev === undefined || o < prev) ordenDe.set(a.cliente_id as string, o);
  }

  // clientes + créditos activos: ambos dependen solo de cliIds → EN PARALELO.
  // (Un cliente puede tener VARIOS créditos [0037]: se acumulan TODOS — la cuota
  // del día y lo cobrado hoy suman los de todos, si no el arqueo subestima.)
  const [cliRes, presRes] = await Promise.all([
    db.from("clientes").select("*").in("id", cliIds).eq("activo", true).order("nombre", { ascending: true }),
    // Se traen TODOS los créditos activos de sus clientes (sin filtrar por dueño)
    // y el reparto se hace abajo. Hace falta el crédito AJENO para poder distinguir
    // dos cosas que se veían iguales: el cliente que no tiene crédito con NADIE
    // (candidato a venta, va al final de la ruta) y el que SÍ lo tiene pero con
    // otro cobrador — ése no es suyo y no tiene por qué ocuparle una parada.
    db
      .from("prestamos")
      .select("id, cliente_id, cobrador_id, cuota_diaria, total_dias, fecha_inicio, frecuencia, pagado_acum")
      .eq("estado", "activo")
      .in("cliente_id", cliIds),
  ]);
  if (cliRes.error) throw cliRes.error;
  if (presRes.error) throw presRes.error;
  const clientes = (cliRes.data ?? []).map(mapCliente);
  if (clientes.length === 0) return { items: [], arqueo: ARQUEO_VACIO };
  const presRaw = presRes.data;
  // Día UY para evaluar el plazo (mismo criterio hábil Lun–Sáb que el cartón).
  const hoyMid = hoyUY(hoy);
  // Por crédito guardamos su id (para cruzar con lo cobrado hoy), cuota y si venció.
  // Campos CRUDOS del crédito: la cuota-objetivo de hoy se calcula MÁS ABAJO, cuando
  // ya sabemos lo cobrado HOY por crédito (para restarlo de pagado_acum, que el
  // trigger 0063 ya lo incluye → si no, el pago de hoy se descontaría dos veces).
  type CredInterno = {
    id: string; cuotaDiaria: number; totalDias: number; fechaInicio: string;
    frecuencia: FrecuenciaPrestamo; pagadoAcum: number; plazoVencido: boolean;
  };
  const creditosDe = new Map<string, { creditos: CredInterno[]; principalId: string }>();
  // Clientes cuyo crédito activo es de OTRO cobrador: no son parada de esta ruta.
  const conCreditoAjeno = new Set<string>();
  for (const p of presRaw ?? []) {
    const cid = p.cliente_id as string;
    const pid = p.id as string;
    // Un crédito sin dueño se muestra igual (no hay a quién atribuírselo).
    const duenoAjeno = !!cobradorId && !!p.cobrador_id && p.cobrador_id !== cobradorId;
    if (duenoAjeno) {
      conCreditoAjeno.add(cid);
      continue; // ni su cuota ni su plata
    }
    const cuota = Number(p.cuota_diaria);
    const totalDias = Number(p.total_dias);
    const pagadoAcum = Number(p.pagado_acum ?? 0);
    const frecuencia = (p.frecuencia as FrecuenciaPrestamo) ?? "diario";
    // Crédito SALDADO (pagó todo pero aún no se finalizó/renovó): fuera de la ruta.
    // Si no, un cliente que ya terminó reaparecía como "pendiente" (inflando "Falta")
    // o como "cartera vencida · a recuperar" — persiguiendo a alguien que pagó todo.
    // Tolerancia sub-peso (deuda #30, espejo del cartón/renovación): una cuota
    // fraccionaria pagada completa deja un residuo de centavos INCOBRABLE → sin el
    // −0,5 un crédito saldado quedaba en la ruta con "Falta $0,xx" fantasma.
    const totalCred = totalCredito(cuota, totalDias);
    if (totalCred > 0 && pagadoAcum >= totalCred - 0.5) continue;
    // ¿El plazo de ESTE crédito ya venció? (cartera vencida → fuera del target del día)
    const vencido = plazoVencido(
      { cuota_diaria: cuota, total_dias: totalDias, fecha_inicio: p.fecha_inicio as string, frecuencia },
      hoyMid,
    );
    const cred: CredInterno = {
      id: pid, cuotaDiaria: cuota, totalDias, fechaInicio: p.fecha_inicio as string,
      frecuencia, pagadoAcum, plazoVencido: vencido,
    };
    const acc = creditosDe.get(cid);
    if (acc) acc.creditos.push(cred);
    else creditosDe.set(cid, { creditos: [cred], principalId: pid });
  }

  const ids = [...creditosDe.values()].flatMap((c) => c.creditos.map((x) => x.id));
  const desde = inicioDiaUYIso(hoy);

  // Cobros y visitas de HOY.
  const pagadoPorPrestamo = new Map<string, number>();
  const noPagoPrestamos = new Set<string>();
  if (ids.length > 0) {
    // Cobros y visitas de HOY: independientes → EN PARALELO.
    const [pagRes, visRes] = await Promise.all([
      db.from("pagos").select("prestamo_id, monto").eq("anulado", false).gte("registrado_en", desde).in("prestamo_id", ids),
      db.from("visitas").select("prestamo_id, resultado").gte("registrado_en", desde).in("prestamo_id", ids),
    ]);
    if (pagRes.error) throw pagRes.error;
    if (visRes.error) throw visRes.error;
    for (const r of pagRes.data ?? [])
      pagadoPorPrestamo.set(
        r.prestamo_id as string,
        (pagadoPorPrestamo.get(r.prestamo_id as string) ?? 0) + Number(r.monto),
      );
    for (const r of visRes.data ?? []) {
      const res = r.resultado as string;
      if (res !== "pago" && res !== "abono")
        noPagoPrestamos.add(r.prestamo_id as string);
    }
  }

  let esperado = 0;
  let recaudado = 0;
  let recaudadoRuta = 0; // cobrado hoy sobre cuotas EN TÉRMINO (para % y "Falta")
  let atrasoEsperado = 0; // deuda de días anteriores a recuperar (fuera de la meta)
  let atrasoRecuperado = 0;
  let cobrados = 0;
  let abonos = 0;
  let noPagos = 0;
  let conRuta = 0; // clientes con crédito EN TÉRMINO (denominador del día; sin zombies)

  const items: ItemRuta[] = clientes.flatMap((c): ItemRuta[] => {
    const cr = creditosDe.get(c.id);
    if (!cr) {
      // Sin crédito PROPIO. Si el que tiene es de un compañero, el cliente no es
      // suyo: se saca de la ruta. Si no tiene con nadie, queda como candidato a
      // venta nueva (al final, con "sin crédito"), que es información útil.
      if (conCreditoAjeno.has(c.id)) return [];
      return [{ cliente: c, prestamoId: null, cuota: 0, atraso: 0, estadoHoy: "sin_credito" as const, pagadoHoy: 0, orden: ordenDe.get(c.id) ?? null, sinCuotaHoy: false, plazoVencido: false, recuperadoHoy: 0 }];
    }
    // No-pago si alguno de sus créditos quedó marcado como visita sin cobro.
    const esNoPago = cr.creditos.some((x) => noPagoPrestamos.has(x.id));
    // Créditos con lo cobrado HOY en CADA uno (para separar recaudo total vs.
    // cobro sobre la cuota vigente al derivar el estado del cliente).
    const creditos: CreditoRuta[] = cr.creditos.map((x) => {
      const pagadoHoy = pagadoPorPrestamo.get(x.id) ?? 0;
      // Cuota-OBJETIVO de hoy (frecuencia-aware): diario = cuota fija; no-diario = lo
      // que falta para estar al día HOY, calculado con lo pagado ANTES de hoy
      // (pagado_acum − pagadoHoy: el trigger 0063 ya incluyó el cobro de hoy). Así la
      // cuota-objetivo es ESTABLE intradía y el pago de hoy se descuenta UNA sola vez
      // (vía pagadoHoy/estadoHoyDe). Diario ignora pagadoAcum → 80% sin cambios (#5).
      const { cuotaHoy: programada, mora } = objetivoDelDia(
        { cuota: x.cuotaDiaria, totalDias: x.totalDias, fechaInicio: x.fechaInicio, frecuencia: x.frecuencia, pagadoAcum: x.pagadoAcum - pagadoHoy },
        hoyMid,
      );
      // Lo que se le PIDE = cuota de hoy + atraso, topeado a una cuota. Lo que
      // cuenta como META = solo la cuota de hoy.
      const aPedir = Math.min(x.cuotaDiaria, programada + mora);
      return {
        cuota: aPedir < 0.5 ? 0 : aPedir,
        cuotaProgramada: programada,
        pagadoHoy,
        plazoVencido: x.plazoVencido,
        // Al día por cronograma (crédito REAL: cuota_diaria>0 y total_dias>0): distingue
        // "nada que cobrar" de un crédito roto (cuota 0 / días 0), que sigue visible como
        // pendiente. (La BD ya garantiza >0, pero el guard cierra la asimetría defensiva.)
        // Con MORA viva NO está al día: debe seguir apareciendo como pendiente.
        alDia:
          programada <= 0.5 &&
          mora <= 0.5 &&
          x.cuotaDiaria > 0 &&
          x.totalDias > 0 &&
          !x.plazoVencido,
      };
    });
    const clase = clasificarClienteRuta(creditos, esNoPago);
    recaudado += clase.pagadoHoyTotal; // incluye recuperaciones de vencidos: la plata es plata
    // Solo los créditos EN TÉRMINO aportan al target del día y al denominador de
    // "ruta completa"; los vencidos puros quedan visibles pero fuera de esas cuentas.
    // Los "al día por cronograma" (semanal sin cuota hoy) NO cuentan en el día:
    // ni como cobrados (mentira: no se les cobró nada) ni en el denominador
    // (no hay nada que hacerles hoy). Visibles en la lista como "Hoy no toca".
    if (clase.cuentaEnRuta && !clase.alDiaCronograma) {
      esperado += clase.cuotaEnTermino;
      // Cap POR CLIENTE: lo que un cliente pagó de MÁS sobre su cuota de hoy (se
      // puso al día pagando 2 cuotas) NO puede tapar el faltante de OTRO cliente.
      // Sin el tope, "Falta $" y "Completo ✓" netean y la ruta se ve cerrada con
      // clientes sin cobrar. El recaudo TOTAL (línea de arriba) sí suma todo.
      recaudadoRuta += Math.min(clase.pagadoHoyEnTermino, clase.cuotaEnTermino);
      // El ATRASO lleva su propia cuenta: lo cobrado se imputa PRIMERO a la cuota
      // de hoy y lo que sobra recupera atraso. Sin esta cuenta, recuperar $30.000
      // de mora no movía ni un número y el cobrador que NO cobraba cerraba la ruta
      // antes que el que sí cobraba.
      atrasoEsperado += clase.moraEnTermino;
      atrasoRecuperado += Math.min(
        Math.max(0, clase.pagadoHoyEnTermino - clase.cuotaEnTermino),
        clase.moraEnTermino,
      );
      conRuta += 1;
      if (clase.estadoHoy === "pagado") cobrados++;
      else if (clase.estadoHoy === "abono") abonos++;
      else if (clase.estadoHoy === "no_pago") noPagos++;
    }
    return [{
      cliente: c,
      prestamoId: cr.principalId,
      // Lo que la TARJETA le pide: la cuota de hoy + el atraso arrastrado. La meta
      // del día (`esperado`) usa solo la cuota; acá va todo lo cobrable, porque
      // mostrarle $0 a un semanal que debe sería esconder la deuda.
      cuota: clase.cuotaEnTermino + clase.moraEnTermino,
      atraso: clase.moraEnTermino,
      estadoHoy: clase.estadoHoy,
      pagadoHoy: clase.pagadoHoyEnTermino, // lo cobrado hacia la cuota de HOY (chip "Abonó")
      orden: ordenDe.get(c.id) ?? null,
      sinCuotaHoy: clase.alDiaCronograma,
      plazoVencido: clase.soloVencido,
      // Recuperación de deuda vieja hoy (solo aplica a cartera vencida pura).
      recuperadoHoy: clase.soloVencido ? clase.pagadoHoyTotal : 0,
    }];
  });

  const conCredito = conRuta;
  return {
    items,
    arqueo: {
      esperado,
      atrasoEsperado,
      atrasoRecuperado,
      recaudado,
      recaudadoRuta,
      cobrados,
      abonos,
      // Pendientes "puros" = ni cobrados, ni con abono parcial, ni no-pago.
      pendientes: Math.max(0, conCredito - cobrados - abonos - noPagos),
      noPagos,
      clientes: conCredito,
    },
  };
}
