// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CAJA / TESORERÍA (admin/supervisor).
//  Combina los COBROS (tabla `pagos`, ingreso principal) con los movimientos
//  de `movimientos_caja` (gastos, desembolsos, aportes, retiros) para dar el
//  resumen del período: ingresos, egresos, neto, desglose y libro cronológico.
//  Corre como gestor (RLS). Degrada si 0010 aún no existe (los cobros igual salen).
// ─────────────────────────────────────────────────────────────────────────
import { traerTodo } from "./paginado";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inicioDiaUYIso, inicioMesUYIso } from "@/lib/fecha";
import { tablaFaltante } from "./errores";
import type { CuentaCaja } from "@/types/db";

// Re-export para que los consumidores (acciones) importen el tipo desde acá.
export type { CuentaCaja } from "@/types/db";

export type PeriodoCaja = "hoy" | "mes";
export type TipoMovimiento = "ingreso" | "egreso" | "desembolso" | "retiro";

/** −1 si el movimiento SALE de la caja, +1 si ENTRA. */
const SIGNO: Record<TipoMovimiento, 1 | -1> = {
  ingreso: 1,
  egreso: -1,
  desembolso: -1,
  retiro: -1,
};
const ETIQUETA: Record<TipoMovimiento, string> = {
  ingreso: "Ingreso",
  egreso: "Gasto",
  desembolso: "Desembolso",
  retiro: "Retiro",
};

export interface LineaLibro {
  fechaIso: string;
  tipo: "cobro" | TipoMovimiento;
  concepto: string;
  monto: number;
  signo: 1 | -1;
  /** Columna "Visible" de Disapp: si el movimiento se ve en la app del cobrador.
   *  Los cobros siempre son visibles. */
  visible: boolean;
}

export interface ResumenCaja {
  periodo: PeriodoCaja;
  cobros: number;
  cobrosCantidad: number;
  ingresosManuales: number;
  gastos: number;
  desembolsos: number;
  retiros: number;
  ingresosTotal: number;
  egresosTotal: number;
  neto: number;
  egresosPorCategoria: { categoria: string; monto: number }[];
  porCobrador: { nombre: string; recaudado: number; cobros: number }[];
  libro: LineaLibro[];
}

const N = (v: unknown) => Number(v);

export async function getResumenCaja(
  db: SupabaseClient,
  periodo: PeriodoCaja = "hoy",
  hoy: Date = new Date(),
  opts?: { limiteLibro?: number },
): Promise<ResumenCaja> {
  const desde = periodo === "mes" ? inicioMesUYIso(hoy) : inicioDiaUYIso(hoy);
  return resumenCajaCore(db, { desde, hasta: null, periodo }, opts);
}

/**
 * Caja de un RANGO explícito [desde, hasta) — para el filtro Desde/Hasta de la
 * página. Solo cuenta OPERATIVA (los movimientos de capital viven en su propia
 * pantalla, ver lib/data/capital.ts). `hasta` es el fin EXCLUSIVO.
 */
export async function getResumenCajaRango(
  db: SupabaseClient,
  rango: { desde: string; hasta: string },
  opts?: { limiteLibro?: number },
): Promise<ResumenCaja> {
  return resumenCajaCore(db, { desde: rango.desde, hasta: rango.hasta, periodo: "hoy" }, opts);
}

async function resumenCajaCore(
  db: SupabaseClient,
  rango: { desde: string; hasta: string | null; periodo: PeriodoCaja },
  opts?: { limiteLibro?: number },
): Promise<ResumenCaja> {
  const { desde, hasta, periodo } = rango;

  // 1) Cobros del período (ingreso principal). A ESCALA: se PAGINA (el mes puede
  //    ser >1000 pagos) y el nombre del cliente va EMBEBIDO (evita .in de miles).
  const pagos = await traerTodo<{
    monto: number;
    registrado_en: string;
    registrado_por: string | null;
    prestamo_id: string;
    prestamos: { clientes: { nombre: string } | null } | null;
  }>((d, h) => {
    let query = db
      .from("pagos")
      .select("monto, registrado_en, registrado_por, prestamo_id, prestamos(clientes(nombre))")
      .eq("anulado", false)
      .gte("registrado_en", desde);
    if (hasta) query = query.lt("registrado_en", hasta);
    // Orden estable por PK: sin él la paginación puede duplicar/saltear filas.
    return query.order("id", { ascending: true }).range(d, h);
  });

  // 2) Movimientos de caja OPERATIVA (degrada a vacío si falta 0010). Se filtra
  //    cuenta='operativa' en JS: defensivo si 0041 aún no agregó la columna.
  let movimientos: Record<string, unknown>[] = [];
  try {
    let query = db.from("movimientos_caja").select("*").gte("registrado_en", desde);
    if (hasta) query = query.lt("registrado_en", hasta);
    const { data, error } = await query;
    if (error) throw error;
    movimientos = (data ?? []).filter((m) => ((m.cuenta as string | null) ?? "operativa") === "operativa");
  } catch (e) {
    if (!tablaFaltante(e)) throw e;
  }

  // 3) Resolver nombres (cobradores) y clientes (para el libro de cobros).
  const usuarioIds = new Set<string>();
  for (const p of pagos) if (p.registrado_por) usuarioIds.add(p.registrado_por as string);
  for (const m of movimientos) {
    if (m.registrado_por) usuarioIds.add(m.registrado_por as string);
    if (m.cobrador_id) usuarioIds.add(m.cobrador_id as string);
  }
  const nombreUsuario = new Map<string, string>();
  if (usuarioIds.size > 0) {
    const { data } = await db.from("usuarios").select("id, nombre").in("id", [...usuarioIds]);
    for (const u of data ?? []) nombreUsuario.set(u.id as string, u.nombre as string);
  }

  // (el nombre del cliente de cada cobro ya viene embebido en `pagos`)

  // 4) Agregados.
  let cobros = 0;
  const porCob = new Map<string, { recaudado: number; cobros: number }>();
  const libro: LineaLibro[] = [];
  for (const p of pagos) {
    const monto = N(p.monto);
    cobros += monto;
    const cobId = (p.registrado_por as string | null) ?? "—";
    const acc = porCob.get(cobId) ?? { recaudado: 0, cobros: 0 };
    acc.recaudado += monto;
    acc.cobros += 1;
    porCob.set(cobId, acc);
    libro.push({
      fechaIso: p.registrado_en as string,
      tipo: "cobro",
      concepto: `Cobro · ${p.prestamos?.clientes?.nombre ?? "cliente"}`,
      monto,
      signo: 1,
      visible: true,
    });
  }

  let ingresosManuales = 0;
  let gastos = 0;
  let desembolsos = 0;
  let retiros = 0;
  const porCat = new Map<string, number>();
  for (const m of movimientos) {
    const tipo = m.tipo as TipoMovimiento;
    const monto = N(m.monto);
    if (tipo === "ingreso") ingresosManuales += monto;
    else if (tipo === "egreso") gastos += monto;
    else if (tipo === "desembolso") desembolsos += monto;
    else if (tipo === "retiro") retiros += monto;
    if (SIGNO[tipo] === -1) {
      const cat = (m.categoria as string | null) || ETIQUETA[tipo];
      porCat.set(cat, (porCat.get(cat) ?? 0) + monto);
    }
    const quien = m.registrado_por ? nombreUsuario.get(m.registrado_por as string) : null;
    libro.push({
      fechaIso: m.registrado_en as string,
      tipo,
      concepto:
        (m.descripcion as string | null) ||
        (m.categoria as string | null) ||
        ETIQUETA[tipo] + (quien ? ` · ${quien}` : ""),
      monto,
      signo: SIGNO[tipo],
      visible: (m.visible as boolean | undefined) ?? true,
    });
  }

  libro.sort((a, b) => (a.fechaIso < b.fechaIso ? 1 : -1));

  const ingresosTotal = cobros + ingresosManuales;
  const egresosTotal = gastos + desembolsos + retiros;

  return {
    periodo,
    cobros,
    cobrosCantidad: pagos.length,
    ingresosManuales,
    gastos,
    desembolsos,
    retiros,
    ingresosTotal,
    egresosTotal,
    neto: ingresosTotal - egresosTotal,
    egresosPorCategoria: [...porCat.entries()]
      .map(([categoria, monto]) => ({ categoria, monto }))
      .sort((a, b) => b.monto - a.monto),
    porCobrador: [...porCob.entries()]
      .map(([id, v]) => ({ nombre: nombreUsuario.get(id) ?? "Sin asignar", ...v }))
      .sort((a, b) => b.recaudado - a.recaudado),
    // El panel muestra las últimas 150; la exportación pide el libro completo.
    libro: libro.slice(0, opts?.limiteLibro ?? 150),
  };
}

export interface NuevoMovimiento {
  tipo: TipoMovimiento;
  monto: number;
  categoria: string | null;
  descripcion: string | null;
  cobradorId: string | null;
  registradoPor: string;
  /** operativa (gastos de ruta) | capital (aportes/retiros del dueño). Default operativa. */
  cuenta?: CuentaCaja;
  /** Se ve en la app del cobrador (columna Visible). Default true. */
  visible?: boolean;
}

export async function registrarMovimientoCaja(
  db: SupabaseClient,
  m: NuevoMovimiento,
): Promise<void> {
  const { error } = await db.from("movimientos_caja").insert({
    tipo: m.tipo,
    monto: m.monto,
    categoria: m.categoria,
    descripcion: m.descripcion,
    cobrador_id: m.cobradorId,
    registrado_por: m.registradoPor,
    cuenta: m.cuenta ?? "operativa",
    visible: m.visible ?? true,
  });
  if (error) throw error;
}
