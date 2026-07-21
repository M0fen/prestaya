// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RUTA del cobrador y ARQUEO del día.
//  Junta clientes asignados (RLS), su préstamo activo y el estado de HOY
//  (pagado / no pago / pendiente) desde pagos y visitas. Corte de día en UY.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cliente, FrecuenciaPrestamo } from "@/types/db";
import { mapCliente } from "./clientes";
import { inicioDiaUYIso, hoyUY } from "@/lib/fecha";
import { plazoVencido, cuotasDebidasHasta } from "@/lib/cartones";

// "abono" = pagó HOY pero menos que la cuota (abono parcial). Regla del negocio:
// un abono parcial NO cubre el día → no es "pagado", queda como pendiente-visto.
export type EstadoHoy = "pagado" | "abono" | "no_pago" | "pendiente" | "sin_credito";

export interface ItemRuta {
  cliente: Cliente;
  prestamoId: string | null;
  cuota: number;
  estadoHoy: EstadoHoy;
  pagadoHoy: number;
  /** Cliente cuyos créditos activos están TODOS de plazo vencido (cartera vencida):
   *  visible para recuperar, pero fuera del target del día (no infla "Falta $"). */
  plazoVencido: boolean;
  /** Plata RECUPERADA hoy sobre un cliente de cartera vencida (0 si no aplica). Se
   *  muestra en la tarjeta para que el cobrador NO vuelva a pasar y cobre de nuevo:
   *  su cobro no cuenta en la cuota del día, así que sin esto quedaba invisible. */
  recuperadoHoy: number;
}

export interface Arqueo {
  esperado: number;
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
 *  · DIARIO → la cuota fija (target del día, como siempre; el 80% de la cartera).
 *  · NO-DIARIO (semanal/quincenal/mensual) → lo que falta para estar AL DÍA según
 *    el cronograma, topeado a una cuota. Es 0 en los días SIN cuota vencida, así el
 *    crédito no figura "Pendiente" ni suma al "esperado" todos los días (hallazgo #5).
 * Pura y testeable.
 */
export function cuotaObjetivoHoy(
  c: { cuota: number; totalDias: number; fechaInicio: string; frecuencia: FrecuenciaPrestamo; pagadoAcum: number },
  hoy: Date,
): number {
  if ((c.frecuencia ?? "diario") === "diario") return c.cuota;
  const totalCred = c.cuota * c.totalDias;
  const debidas = cuotasDebidasHasta(
    { cuota_diaria: c.cuota, total_dias: c.totalDias, fecha_inicio: c.fechaInicio, frecuencia: c.frecuencia },
    hoy,
  );
  // ⚠️ `pagadoAcum` debe ser lo pagado ANTES de hoy (el llamador resta el cobro de
  // hoy): el trigger 0063 lo actualiza en el insert, y si acá se restara el pago de
  // hoy, `estadoHoyDe`/`recaudadoRuta` lo descontarían DOS veces (cobro a medias se
  // vería "Cobrado" y el cobrador no iría por el resto).
  const montoDebido = Math.max(0, Math.min(debidas * c.cuota, totalCred) - c.pagadoAcum);
  // Tolerancia sub-peso (espejo del cartón): cuota fraccionaria + pagos enteros
  // dejan un residuo de centavos → sin esto el crédito no llega nunca a 0 (al día).
  if (montoDebido < 0.5) return 0;
  return Math.min(c.cuota, montoDebido);
}

/** Un crédito activo del cliente: su cuota-OBJETIVO de hoy, lo cobrado HOY en él y
 *  si su PLAZO ya venció. `alDia`: crédito REAL (cuota_diaria>0) en término sin cuota
 *  vencida hoy (no-diario al día) → distingue "nada que cobrar" de "dato roto". */
export interface CreditoRuta {
  cuota: number;
  pagadoHoy: number;
  plazoVencido: boolean;
  alDia?: boolean;
}

export interface ClaseClienteRuta {
  /** Suma de cuota de los créditos EN TÉRMINO (el target de cobro de HOY). */
  cuotaEnTermino: number;
  /** Cobrado HOY en créditos EN TÉRMINO (para el ESTADO del cliente y el chip "Abonó"). */
  pagadoHoyEnTermino: number;
  /** Cobrado HOY en TODOS los créditos (para el recaudo — la plata es plata). */
  pagadoHoyTotal: number;
  /** Tiene créditos activos pero TODOS de plazo vencido (cartera vencida pura). */
  soloVencido: boolean;
  estadoHoy: EstadoHoy;
  /** Cuenta para el denominador/target del día (los vencidos puros NO). */
  cuentaEnRuta: boolean;
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
  const cuotaEnTermino = enTermino.reduce((s, c) => s + c.cuota, 0);
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
  return {
    cuotaEnTermino,
    pagadoHoyEnTermino,
    pagadoHoyTotal,
    soloVencido,
    estadoHoy: alDiaHoy ? "pagado" : estadoHoyDe(pagadoHoyEnTermino, cuotaEnTermino, esNoPago),
    cuentaEnRuta: !soloVencido,
  };
}

/** Ruta del cobrador logueado + arqueo del día (todo scopeado por RLS). */
export async function getRutaCobrador(
  db: SupabaseClient,
  hoy: Date = new Date(),
): Promise<Ruta> {
  // Clientes del cobrador SCOPEADOS por sus asignaciones (RLS = suyas, indexado
  // por cobrador_id → devuelve ~decenas). Antes se hacía `select * from clientes`
  // dependiendo del RLS, que con 13k clientes evaluaba la política fila-por-fila
  // → statement timeout. Con `.in(ids)` el RLS solo se evalúa sobre esos ids.
  const { data: asigRaw, error: e0 } = await db
    .from("asignaciones")
    .select("cliente_id")
    .eq("activo", true);
  if (e0) throw e0;
  const cliIds = [...new Set((asigRaw ?? []).map((a) => a.cliente_id as string))];
  if (cliIds.length === 0) return { items: [], arqueo: ARQUEO_VACIO };

  // clientes + créditos activos: ambos dependen solo de cliIds → EN PARALELO.
  // (Un cliente puede tener VARIOS créditos [0037]: se acumulan TODOS — la cuota
  // del día y lo cobrado hoy suman los de todos, si no el arqueo subestima.)
  const [cliRes, presRes] = await Promise.all([
    db.from("clientes").select("*").in("id", cliIds).eq("activo", true).order("nombre", { ascending: true }),
    db
      .from("prestamos")
      .select("id, cliente_id, cuota_diaria, total_dias, fecha_inicio, frecuencia, pagado_acum")
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
  for (const p of presRaw ?? []) {
    const cid = p.cliente_id as string;
    const pid = p.id as string;
    const cuota = Number(p.cuota_diaria);
    const totalDias = Number(p.total_dias);
    const pagadoAcum = Number(p.pagado_acum ?? 0);
    const frecuencia = (p.frecuencia as FrecuenciaPrestamo) ?? "diario";
    // Crédito SALDADO (pagó todo pero aún no se finalizó/renovó): fuera de la ruta.
    // Si no, un cliente que ya terminó reaparecía como "pendiente" (inflando "Falta")
    // o como "cartera vencida · a recuperar" — persiguiendo a alguien que pagó todo.
    const totalCred = cuota * totalDias;
    if (totalCred > 0 && pagadoAcum >= totalCred) continue;
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
  let cobrados = 0;
  let abonos = 0;
  let noPagos = 0;
  let conRuta = 0; // clientes con crédito EN TÉRMINO (denominador del día; sin zombies)

  const items: ItemRuta[] = clientes.map((c) => {
    const cr = creditosDe.get(c.id);
    if (!cr)
      return { cliente: c, prestamoId: null, cuota: 0, estadoHoy: "sin_credito", pagadoHoy: 0, plazoVencido: false, recuperadoHoy: 0 };
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
      const cuotaHoy = cuotaObjetivoHoy(
        { cuota: x.cuotaDiaria, totalDias: x.totalDias, fechaInicio: x.fechaInicio, frecuencia: x.frecuencia, pagadoAcum: x.pagadoAcum - pagadoHoy },
        hoyMid,
      );
      return {
        cuota: cuotaHoy,
        pagadoHoy,
        plazoVencido: x.plazoVencido,
        // Al día por cronograma (crédito REAL: cuota_diaria>0 y total_dias>0): distingue
        // "nada que cobrar" de un crédito roto (cuota 0 / días 0), que sigue visible como
        // pendiente. (La BD ya garantiza >0, pero el guard cierra la asimetría defensiva.)
        alDia: cuotaHoy <= 0.5 && x.cuotaDiaria > 0 && x.totalDias > 0 && !x.plazoVencido,
      };
    });
    const clase = clasificarClienteRuta(creditos, esNoPago);
    recaudado += clase.pagadoHoyTotal; // incluye recuperaciones de vencidos: la plata es plata
    // Solo los créditos EN TÉRMINO aportan al target del día y al denominador de
    // "ruta completa"; los vencidos puros quedan visibles pero fuera de esas cuentas.
    if (clase.cuentaEnRuta) {
      esperado += clase.cuotaEnTermino;
      // Cap POR CLIENTE: lo que un cliente pagó de MÁS sobre su cuota de hoy (se
      // puso al día pagando 2 cuotas) NO puede tapar el faltante de OTRO cliente.
      // Sin el tope, "Falta $" y "Completo ✓" netean y la ruta se ve cerrada con
      // clientes sin cobrar. El recaudo TOTAL (línea de arriba) sí suma todo.
      recaudadoRuta += Math.min(clase.pagadoHoyEnTermino, clase.cuotaEnTermino);
      conRuta += 1;
      if (clase.estadoHoy === "pagado") cobrados++;
      else if (clase.estadoHoy === "abono") abonos++;
      else if (clase.estadoHoy === "no_pago") noPagos++;
    }
    return {
      cliente: c,
      prestamoId: cr.principalId,
      cuota: clase.cuotaEnTermino,
      estadoHoy: clase.estadoHoy,
      pagadoHoy: clase.pagadoHoyEnTermino, // lo cobrado hacia la cuota de HOY (chip "Abonó")
      plazoVencido: clase.soloVencido,
      // Recuperación de deuda vieja hoy (solo aplica a cartera vencida pura).
      recuperadoHoy: clase.soloVencido ? clase.pagadoHoyTotal : 0,
    };
  });

  const conCredito = conRuta;
  return {
    items,
    arqueo: {
      esperado,
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
