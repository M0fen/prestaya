// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — VIGILANCIA del cobrador (admin). Agrega las señales de una
//  ventana (30 días por defecto) por cobrador y calcula: (a) el SCORE DE
//  CONFIANZA (lib/scoreCobrador) y (b) su CUENTA CORRIENTE (recaudado vs rendido,
//  faltantes acumulados y float sin declarar). Corre como gestor; el supervisor
//  ve solo los cobradores de su zona (alcance).
//
//  Rendimiento: las tablas grandes (pagos/visitas/bitácora) se PAGINAN y se
//  filtran por ventana; los agregados se hacen en JS. Verdad = tablas base.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "./paginado";
import { tablaFaltante } from "./errores";
import { alcanceDelActor, type Alcance } from "./alcance";
import { calcularConfianzaCobrador, type ResultadoConfianza, type SenalesCobrador } from "@/lib/scoreCobrador";
import { analizarSospecha, type EventoBitacora } from "@/lib/sospecha";

export interface VigilanciaCobrador {
  cobradorId: string;
  nombre: string;
  confianza: ResultadoConfianza;
  senales: SenalesCobrador;
  // Cuenta corriente (ventana):
  recaudado: number;
  rendido: number;
  gastos: number;
  /** Recaudado en días SIN rendición (float que no declaró). */
  saldoSinRendir: number;
  /** Suma de diferencias de rendición (negativo = faltante neto). */
  diferenciaAcumulada: number;
}

/** "YYYY-MM-DD" en horario de Uruguay de un instante ISO. */
function diaUY(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Montevideo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

interface Acc {
  recaudado: number;
  cobros: number;
  diasPago: Set<string>;
  recaudadoPorDia: Map<string, number>;
  noPagos: number;
  rendido: number;
  faltantes: number;
  montoFaltante: number;
  sobrantes: number;
  diasRendidos: Set<string>;
  diferenciaAcumulada: number;
  gastos: number;
  // Bitácora, agrupada por día para correr analizarSospecha.
  eventosPorDia: Map<string, EventoBitacora[]>;
}

const nuevoAcc = (): Acc => ({
  recaudado: 0, cobros: 0, diasPago: new Set(), recaudadoPorDia: new Map(),
  noPagos: 0, rendido: 0, faltantes: 0, montoFaltante: 0, sobrantes: 0,
  diasRendidos: new Set(), diferenciaAcumulada: 0, gastos: 0, eventosPorDia: new Map(),
});

export async function getVigilanciaCobradores(
  db: SupabaseClient,
  hoy: Date = new Date(),
  opts: { ventanaDias?: number; alcance?: Alcance } = {},
): Promise<VigilanciaCobrador[]> {
  const ventanaDias = opts.ventanaDias ?? 30;
  const desdeIso = new Date(hoy.getTime() - ventanaDias * 86400000).toISOString();
  const desdeYmd = diaUY(desdeIso);
  const alcance = opts.alcance ?? (await alcanceDelActor());
  const cobIds = alcance.global ? null : alcance.cobradorIds;

  // Cobradores (filas del ranking). Supervisor → solo los suyos.
  let cobQuery = db.from("usuarios").select("id, nombre").eq("rol", "cobrador").eq("activo", true);
  if (cobIds) cobQuery = cobQuery.in("id", cobIds);
  const cobRes = await cobQuery;
  if (cobRes.error) throw cobRes.error;
  const cobradores = (cobRes.data ?? []).map((c) => ({ id: c.id as string, nombre: c.nombre as string }));
  if (cobradores.length === 0) return [];
  const permitido = new Set(cobradores.map((c) => c.id));

  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) { a = nuevoAcc(); acc.set(id, a); }
    return a;
  };
  for (const c of cobradores) get(c.id);

  // 1) Recaudo por cobrador y día. A ESCALA (decenas de miles de pagos en la
  //    ventana) se AGREGA EN SQL con la RPC 0043 (devuelve cobradores×días filas,
  //    no todos los pagos). Si falta la RPC, degrada: para el supervisor se puede
  //    acotar barato por sus cobradores; para el admin se omite el recaudo (evita
  //    colgar), y la confianza igual sale de rendición/bitácora.
  const sumaDia = (id: string, dia: string, monto: number, cobros: number) => {
    if (!permitido.has(id)) return;
    const a = get(id);
    a.recaudado += monto;
    a.cobros += cobros;
    a.diasPago.add(dia);
    a.recaudadoPorDia.set(dia, (a.recaudadoPorDia.get(dia) ?? 0) + monto);
  };
  try {
    const { data, error } = await db.rpc("app_vigilancia_pagos", { desde: desdeIso });
    if (error) throw error;
    for (const r of (data ?? []) as { cobrador_id: string; dia: string; monto: number; cobros: number }[]) {
      sumaDia(r.cobrador_id, r.dia as string, Number(r.monto), Number(r.cobros));
    }
  } catch {
    if (cobIds) {
      // Fallback acotado (supervisor): trae solo los pagos de SUS cobradores.
      const pagos = await traerTodo<{ registrado_por: string | null; monto: number; registrado_en: string }>(
        (d, h) =>
          db.from("pagos").select("registrado_por, monto, registrado_en")
            .eq("anulado", false).gte("registrado_en", desdeIso).in("registrado_por", cobIds)
            .order("id", { ascending: true }).range(d, h),
      );
      for (const p of pagos) {
        if (!p.registrado_por) continue;
        sumaDia(p.registrado_por, diaUY(p.registrado_en), Number(p.monto), 1);
      }
    }
    // Admin sin RPC: se omite el recaudo (no se paginan decenas de miles de filas).
  }

  // 2) Visitas "no pago" de la ventana.
  const visitas = await traerTodo<{ cobrador_id: string | null; resultado: string }>(
    (d, h) => {
      let q = db.from("visitas").select("cobrador_id, resultado").gte("registrado_en", desdeIso);
      if (cobIds) q = q.in("cobrador_id", cobIds);
      return q.order("id", { ascending: true }).range(d, h);
    },
  );
  for (const v of visitas) {
    const id = v.cobrador_id;
    if (!id || !permitido.has(id)) continue;
    if (v.resultado === "no_pago") get(id).noPagos += 1;
  }

  // 3) Rendiciones de la ventana (por fecha).
  try {
    let rq = db.from("rendiciones").select("cobrador_id, fecha, entregado, diferencia").gte("fecha", desdeYmd);
    if (cobIds) rq = rq.in("cobrador_id", cobIds);
    const { data, error } = await rq;
    if (error) throw error;
    for (const r of data ?? []) {
      const id = r.cobrador_id as string;
      if (!permitido.has(id)) continue;
      const a = get(id);
      const dif = Number(r.diferencia);
      a.rendido += Number(r.entregado);
      a.diferenciaAcumulada += dif;
      a.diasRendidos.add(r.fecha as string);
      if (dif < 0) { a.faltantes += 1; a.montoFaltante += -dif; }
      else if (dif > 0) a.sobrantes += 1;
    }
  } catch (e) {
    if (!tablaFaltante(e)) throw e; // sin 0013: sin datos de rendición
  }

  // 4) Movimientos de caja (gastos de RUTA) de la ventana. Se EXCLUYE la categoría
  //    "Comisión": un pago de comisión al cobrador NO es un gasto de su ruta (y si
  //    se contara, distorsionaría su cuenta corriente / gastos declarados).
  try {
    let mq = db.from("movimientos_caja").select("cobrador_id, tipo, monto, categoria").gte("registrado_en", desdeIso);
    if (cobIds) mq = mq.in("cobrador_id", cobIds);
    const { data, error } = await mq;
    if (error) throw error;
    for (const m of data ?? []) {
      const id = m.cobrador_id as string | null;
      if (!id || !permitido.has(id)) continue;
      if ((m.tipo as string) === "egreso" && (m.categoria as string | null) !== "Comisión")
        get(id).gastos += Number(m.monto);
    }
  } catch (e) {
    if (!tablaFaltante(e)) throw e;
  }

  // 5) Bitácora de la ventana → sospecha por día (planchado, fuera de zona, etc.).
  try {
    const eventos = await traerTodo<Record<string, unknown>>(
      (d, h) => {
        let q = db.from("bitacora")
          .select("actor_id, fecha_uy, accion, server_ts, gps_lat, gps_lng, gps_denegado, en_zona, cliente_id")
          .gte("fecha_uy", desdeYmd);
        if (cobIds) q = q.in("actor_id", cobIds);
        return q.order("id", { ascending: true }).range(d, h);
      },
    );
    for (const r of eventos) {
      const id = r.actor_id as string | null;
      if (!id || !permitido.has(id)) continue;
      const dia = r.fecha_uy as string;
      const ev: EventoBitacora = {
        accion: r.accion as string,
        serverTs: r.server_ts as string,
        gpsLat: r.gps_lat == null ? null : Number(r.gps_lat),
        gpsLng: r.gps_lng == null ? null : Number(r.gps_lng),
        gpsDenegado: Boolean(r.gps_denegado),
        enZona: r.en_zona == null ? null : Boolean(r.en_zona),
        clienteId: (r.cliente_id as string | null) ?? null,
      };
      const a = get(id);
      const arr = a.eventosPorDia.get(dia) ?? [];
      arr.push(ev);
      a.eventosPorDia.set(dia, arr);
    }
  } catch (e) {
    if (!tablaFaltante(e)) throw e;
  }

  // 6) Consolidar por cobrador → señales → confianza + cuenta corriente.
  const filas: VigilanciaCobrador[] = cobradores.map((c) => {
    const a = get(c.id);

    // Sospecha de la bitácora, por día.
    let fueraDeZona = 0, sinGps = 0, diasAlerta = 0, diasObservar = 0;
    for (const eventos of a.eventosPorDia.values()) {
      const s = analizarSospecha(eventos);
      fueraDeZona += s.fueraDeZona;
      sinGps += s.sinGps;
      if (s.nivel === "alerta") diasAlerta += 1;
      else if (s.nivel === "observar") diasObservar += 1;
    }

    // Días con recaudo que NO se rindieron + su monto (float sin declarar).
    let diasSinRendir = 0, saldoSinRendir = 0;
    for (const [dia, monto] of a.recaudadoPorDia) {
      // El día de hoy no cuenta como "sin rendir" (todavía puede rendir).
      if (dia === diaUY(hoy.toISOString())) continue;
      if (!a.diasRendidos.has(dia)) { diasSinRendir += 1; saldoSinRendir += monto; }
    }

    const senales: SenalesCobrador = {
      diasActivos: a.diasPago.size,
      rendiciones: a.diasRendidos.size,
      diasSinRendir,
      faltantes: a.faltantes,
      montoFaltante: a.montoFaltante,
      cobros: a.cobros,
      noPagos: a.noPagos,
      fueraDeZona,
      sinGps,
      diasAlerta,
      diasObservar,
      floatMaxSinRendir: saldoSinRendir,
    };

    return {
      cobradorId: c.id,
      nombre: c.nombre,
      confianza: calcularConfianzaCobrador(senales),
      senales,
      recaudado: a.recaudado,
      rendido: a.rendido,
      gastos: a.gastos,
      saldoSinRendir,
      diferenciaAcumulada: a.diferenciaAcumulada,
    };
  });

  // Menos confiable arriba (lo que el admin debe mirar primero).
  filas.sort((x, y) => x.confianza.puntaje - y.confianza.puntaje);
  return filas;
}
