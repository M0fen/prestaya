// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RUTA del cobrador y ARQUEO del día.
//  Junta clientes asignados (RLS), su préstamo activo y el estado de HOY
//  (pagado / no pago / pendiente) desde pagos y visitas. Corte de día en UY.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cliente, FrecuenciaPrestamo } from "@/types/db";
import { mapCliente } from "./clientes";
import { inicioDiaUYIso, hoyUY } from "@/lib/fecha";
import { plazoVencido } from "@/lib/cartones";

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
}

export interface Arqueo {
  esperado: number;
  recaudado: number;
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
  if (cuota > 0 && pagadoHoy >= cuota) return "pagado";
  if (pagadoHoy > 0) return "abono"; // pagó algo pero no cubrió la cuota
  if (esNoPago) return "no_pago";
  return "pendiente";
}

/** Un crédito activo del cliente, con su cuota y si su PLAZO ya venció. */
export interface CreditoRuta {
  cuota: number;
  plazoVencido: boolean;
}

export interface ClaseClienteRuta {
  /** Suma de cuota de los créditos EN TÉRMINO (el target de cobro de HOY). */
  cuotaEnTermino: number;
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
 * nunca llegaría (el cobrador persigue una cuota que ya no está programada). El
 * `pagadoHoy` (si recupera algo) se cuenta aparte como recaudo — la plata es plata.
 */
export function clasificarClienteRuta(
  creditos: CreditoRuta[],
  pagadoHoy: number,
  esNoPago: boolean,
): ClaseClienteRuta {
  const cuotaEnTermino = creditos
    .filter((c) => !c.plazoVencido)
    .reduce((s, c) => s + c.cuota, 0);
  const soloVencido = creditos.length > 0 && cuotaEnTermino === 0;
  return {
    cuotaEnTermino,
    soloVencido,
    estadoHoy: estadoHoyDe(pagadoHoy, cuotaEnTermino, esNoPago),
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
      .select("id, cliente_id, cuota_diaria, total_dias, fecha_inicio, frecuencia")
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
  const creditosDe = new Map<string, { ids: string[]; creditos: CreditoRuta[]; principalId: string }>();
  for (const p of presRaw ?? []) {
    const cid = p.cliente_id as string;
    const pid = p.id as string;
    const cuota = Number(p.cuota_diaria);
    // ¿El plazo de ESTE crédito ya venció? (cartera vencida → fuera del target del día)
    const vencido = plazoVencido(
      {
        cuota_diaria: cuota,
        total_dias: Number(p.total_dias),
        fecha_inicio: p.fecha_inicio as string,
        frecuencia: (p.frecuencia as FrecuenciaPrestamo) ?? "diario",
      },
      hoyMid,
    );
    const acc = creditosDe.get(cid);
    if (acc) {
      acc.ids.push(pid);
      acc.creditos.push({ cuota, plazoVencido: vencido });
    } else {
      creditosDe.set(cid, { ids: [pid], creditos: [{ cuota, plazoVencido: vencido }], principalId: pid });
    }
  }

  const ids = [...creditosDe.values()].flatMap((c) => c.ids);
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
  let cobrados = 0;
  let abonos = 0;
  let noPagos = 0;
  let conRuta = 0; // clientes con crédito EN TÉRMINO (denominador del día; sin zombies)

  const items: ItemRuta[] = clientes.map((c) => {
    const cr = creditosDe.get(c.id);
    if (!cr)
      return { cliente: c, prestamoId: null, cuota: 0, estadoHoy: "sin_credito", pagadoHoy: 0, plazoVencido: false };
    // Suma de lo cobrado HOY en TODOS los créditos activos del cliente (incluye
    // recuperaciones sobre créditos vencidos: la plata cobrada es plata).
    const pagadoHoy = cr.ids.reduce((s, id) => s + (pagadoPorPrestamo.get(id) ?? 0), 0);
    recaudado += pagadoHoy;
    // No-pago si alguno de sus créditos quedó marcado como visita sin cobro.
    const esNoPago = cr.ids.some((id) => noPagoPrestamos.has(id));
    const clase = clasificarClienteRuta(cr.creditos, pagadoHoy, esNoPago);
    // Solo los créditos EN TÉRMINO aportan al target del día y al denominador de
    // "ruta completa"; los vencidos puros quedan visibles pero fuera de esas cuentas.
    if (clase.cuentaEnRuta) {
      esperado += clase.cuotaEnTermino;
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
      pagadoHoy,
      plazoVencido: clase.soloVencido,
    };
  });

  const conCredito = conRuta;
  return {
    items,
    arqueo: {
      esperado,
      recaudado,
      cobrados,
      abonos,
      // Pendientes "puros" = ni cobrados, ni con abono parcial, ni no-pago.
      pendientes: Math.max(0, conCredito - cobrados - abonos - noPagos),
      noPagos,
      clientes: conCredito,
    },
  };
}
