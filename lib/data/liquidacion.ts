// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — LIQUIDACIÓN DIARIA por cobrador (paridad Disapp).
//  Por cada cobrador activo, la foto del día: base (aporte de capital), visitas,
//  recaudo (sus pagos de hoy), retiros, ventas (créditos nuevos), caja final y si
//  ya cerró la jornada (rendición). Corre como gestor (RLS ve todo).
//
//  A ESCALA: agrega en JS sobre lo de HOY, que está acotado a un día (no son los
//  151k pagos históricos). Si algún día se necesita, se puede mover a una RPC
//  security-definer estilo 0040; hoy no hace falta.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { inicioDiaUYIso, hoyUY } from "@/lib/fecha";
import { toIso } from "@/lib/format";
import { traerTodo } from "./paginado";
import { tablaFaltante } from "./errores";
import { reportarError } from "@/lib/observabilidad";
import { alcanceDelActor, type Alcance } from "./alcance";
import { getAperturasDia } from "./aperturas";
import { colocadoEnDias, claveColocado } from "./colocado";

export interface FilaLiquidacion {
  cobradorId: string;
  nombre: string;
  /** Aporte de capital del día (movimientos 'ingreso'). null = sin dato → "—". */
  base: number | null;
  visitas: number;
  recaudo: number;
  retiros: number;
  /** Créditos nuevos colocados hoy por el cobrador. */
  ventas: number;
  /** Capital que entregó en la calle hoy: sale de su bolsillo, no lo tiene. */
  colocado: number;
  /** Lo que YA rindió a la oficina hoy (0 si todavía no cerró). Esa plata ya está
   *  en la caja central: no puede seguir contando como efectivo de la calle. */
  entregado: number;
  /** Lo que TODAVÍA tiene encima: base + recaudo − retiros − colocado − entregado. */
  cajaFinal: number;
  estado: "cerrada" | "abierta";
}

export interface LiquidacionDia {
  fecha: string;
  filas: FilaLiquidacion[];
  cajasCerradas: number;
  totalCobradores: number;
  recaudoTotal: number;
  cajaFinalTotal: number;
  /** false si falta la migración 0013 (no se puede saber quién cerró). */
  disponibleRendiciones: boolean;
}

export async function getLiquidacionDiaria(
  db: SupabaseClient,
  hoy: Date = new Date(),
  alcancePre?: Alcance,
): Promise<LiquidacionDia> {
  const desde = inicioDiaUYIso(hoy);
  const fechaHoy = toIso(hoyUY(hoy));

  // Cobradores activos = las filas de la tabla (uno por cobrador). El supervisor
  // ve SOLO los de su zona; el admin, todos.
  const alcance = alcancePre ?? (await alcanceDelActor());
  let cobQuery = db
    .from("usuarios")
    .select("id, nombre")
    .eq("rol", "cobrador")
    .eq("activo", true);
  if (!alcance.global) cobQuery = cobQuery.in("id", alcance.cobradorIds);
  const cobRes = await cobQuery;
  if (cobRes.error) throw cobRes.error;
  const cobradores = (cobRes.data ?? []).map((c) => ({
    id: c.id as string,
    nombre: c.nombre as string,
  }));

  // Perf del supervisor: acotamos los escaneos de HOY a SUS cobradores (antes se
  // barrían todos y se descartaban en JS). El admin (global) no filtra. Reduce
  // las filas que el RLS por-fila tiene que evaluar → dashboard del supervisor más
  // rápido, sin cambiar el resultado (solo se muestran sus cobradores).
  const soloCob = alcance.global ? null : alcance.cobradorIds;

  // Eventos de HOY (paginados con orden estable), en paralelo.
  const [pagos, visitas, movs, prestamosNuevos] = await Promise.all([
    traerTodo<{ monto: number; registrado_por: string | null }>((d, h) => {
      // Solo nativos: la liquidación del día es custodia de efectivo en mano
      // (asientos importados/de reconciliación rinden en el mundo viejo).
      let q = db
        .from("pagos")
        .select("monto, registrado_por")
        .eq("anulado", false)
        .is("origen", null)
        .gte("registrado_en", desde);
      if (soloCob) q = q.in("registrado_por", soloCob);
      return q.order("id", { ascending: true }).range(d, h);
    }),
    traerTodo<{ cobrador_id: string | null }>((d, h) => {
      let q = db.from("visitas").select("cobrador_id").gte("registrado_en", desde);
      if (soloCob) q = q.in("cobrador_id", soloCob);
      return q.order("id", { ascending: true }).range(d, h);
    }),
    traerTodo<{ tipo: string; monto: number; cobrador_id: string | null; categoria: string | null }>((d, h) => {
      let q = db
        .from("movimientos_caja")
        .select("tipo, monto, cobrador_id, categoria")
        .gte("registrado_en", desde);
      if (soloCob) q = q.in("cobrador_id", soloCob);
      return q.order("id", { ascending: true }).range(d, h);
    }),
    traerTodo<{ cobrador_id: string | null }>((d, h) => {
      let q = db.from("prestamos").select("cobrador_id").gte("creado_en", desde);
      if (soloCob) q = q.in("cobrador_id", soloCob);
      return q.order("id", { ascending: true }).range(d, h);
    }),
  ]);

  // Rendiciones de hoy: quién ya cerró (degrada si falta 0013).
  const cerradas = new Set<string>();
  // ⚠️ Lo que YA entregó. Sin esto, la fila de un cobrador que cerró y te puso la
  // plata en la mano seguía mostrando esa misma plata como "caja final", y el total
  // del home la contaba como efectivo en la calle: el 08-09 Karent y Anyela
  // entregaron $240.869 y $245.840 y el titular seguía sumando los $486.709. Es el
  // número con el que se decide cuánto sacar a prestar al día siguiente.
  const entregadoDe = new Map<string, number>();
  let disponibleRendiciones = true;
  try {
    const { data, error } = await db
      .from("rendiciones")
      .select("cobrador_id, entregado")
      .eq("fecha", fechaHoy);
    if (error) throw error;
    for (const r of data ?? []) {
      cerradas.add(r.cobrador_id as string);
      entregadoDe.set(
        r.cobrador_id as string,
        (entregadoDe.get(r.cobrador_id as string) ?? 0) + Math.round(Number(r.entregado) || 0),
      );
    }
  } catch (e) {
    if (tablaFaltante(e)) disponibleRendiciones = false;
    else throw e;
  }

  // Acumuladores por cobrador.
  type Acc = { base: number | null; visitas: number; recaudo: number; retiros: number; ventas: number };
  const acc = new Map<string, Acc>();
  const init = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = { base: null, visitas: 0, recaudo: 0, ventas: 0, retiros: 0 };
      acc.set(id, a);
    }
    return a;
  };
  for (const c of cobradores) init(c.id);

  for (const p of pagos) {
    if (!p.registrado_por) continue;
    init(p.registrado_por).recaudo += Number(p.monto);
  }
  for (const v of visitas) {
    if (v.cobrador_id) init(v.cobrador_id).visitas += 1;
  }
  for (const pr of prestamosNuevos) {
    if (pr.cobrador_id) init(pr.cobrador_id).ventas += 1;
  }
  for (const m of movs) {
    if (!m.cobrador_id) continue;
    const a = init(m.cobrador_id);
    if (m.tipo === "ingreso") a.base = (a.base ?? 0) + Number(m.monto); // aporte de capital
    // La COMISIÓN liquidada sale de la caja CENTRAL, no del bolsillo del cobrador:
    // contarla como retiro suyo le hunde la "caja final" los días de pago (2 por
    // mes) y con una comisión grande la deja NEGATIVA en el home del admin — un
    // retiro que nunca hizo. Mismo criterio que lib/data/gastos.ts.
    else if ((m.tipo === "egreso" || m.tipo === "retiro") && m.categoria !== "Comisión")
      a.retiros += Number(m.monto);
  }

  // BASE del día: la verdad está en `aperturas_caja` (la misma fuente que usa el
  // cierre de zona), no en un movimiento de tipo 'ingreso'. Sin esto la columna
  // "Base" del home del admin mostraba "—" para todos SIEMPRE y la "caja final"
  // quedaba subestimada justo en la base entregada.
  try {
    const aperturas = await getAperturasDia(db, hoy, soloCob ?? undefined);
    for (const [cobradorId, base] of aperturas) {
      if (!(base > 0)) continue;
      init(cobradorId).base = base;
    }
  } catch {
    /* sin tabla de aperturas (0104) → se queda con lo que dieran los movimientos */
  }

  // ⚠️ El CAPITAL COLOCADO no lo tiene el cobrador: se lo dio a los clientes. Sin
  // restarlo, la columna "Caja final" del home del admin era una CUARTA fórmula
  // (base + recaudo − retiros) que contradecía al teléfono del cobrador y al cierre
  // por zona de la misma página — María Artunduaga aparecía con $104.144 cuando
  // tenía $27.144.
  // Es una pantalla de LECTURA, no el acta de cierre: si no se puede leer, se
  // muestra sin el descuento (queda el número de antes) pero se reporta — nunca
  // en silencio, porque el número que queda es el inflado.
  let colocadoPorCob = new Map<string, number>();
  try {
    colocadoPorCob = await colocadoEnDias(
      cobradores.map((c) => ({ cobradorId: c.id, ymd: fechaHoy })),
    );
  } catch (e) {
    reportarError("liquidacion:colocado", e);
  }

  const filas: FilaLiquidacion[] = cobradores
    .map((c) => {
      const a = acc.get(c.id)!;
      const colocado = colocadoPorCob.get(claveColocado(c.id, fechaHoy)) ?? 0;
      const entregado = entregadoDe.get(c.id) ?? 0;
      // "Caja final" = lo que TODAVÍA tiene encima. Lo entregado ya está en la caja
      // central: contarlo acá lo mostraba dos veces (una en la mano del cobrador y
      // otra en la de la oficina) e inflaba la exposición de la calle.
      const cajaFinal = Math.max(0, (a.base ?? 0) + a.recaudo - a.retiros - colocado - entregado);
      return {
        cobradorId: c.id,
        nombre: c.nombre,
        base: a.base,
        visitas: a.visitas,
        recaudo: a.recaudo,
        colocado,
        entregado,
        retiros: a.retiros,
        ventas: a.ventas,
        cajaFinal,
        estado: cerradas.has(c.id) ? ("cerrada" as const) : ("abierta" as const),
      };
    })
    .sort((x, y) => y.recaudo - x.recaudo);

  return {
    fecha: fechaHoy,
    filas,
    cajasCerradas: filas.filter((f) => f.estado === "cerrada").length,
    totalCobradores: filas.length,
    recaudoTotal: filas.reduce((s, f) => s + f.recaudo, 0),
    cajaFinalTotal: filas.reduce((s, f) => s + f.cajaFinal, 0),
    disponibleRendiciones,
  };
}
