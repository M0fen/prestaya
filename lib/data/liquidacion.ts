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
import { alcanceDelActor, type Alcance } from "./alcance";

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
  /** base(0 si null) + recaudo − retiros. */
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
    traerTodo<{ tipo: string; monto: number; cobrador_id: string | null }>((d, h) => {
      let q = db.from("movimientos_caja").select("tipo, monto, cobrador_id").gte("registrado_en", desde);
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
  let disponibleRendiciones = true;
  try {
    const { data, error } = await db
      .from("rendiciones")
      .select("cobrador_id")
      .eq("fecha", fechaHoy);
    if (error) throw error;
    for (const r of data ?? []) cerradas.add(r.cobrador_id as string);
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
    else if (m.tipo === "egreso" || m.tipo === "retiro") a.retiros += Number(m.monto);
  }

  const filas: FilaLiquidacion[] = cobradores
    .map((c) => {
      const a = acc.get(c.id)!;
      const cajaFinal = (a.base ?? 0) + a.recaudo - a.retiros;
      return {
        cobradorId: c.id,
        nombre: c.nombre,
        base: a.base,
        visitas: a.visitas,
        recaudo: a.recaudo,
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
