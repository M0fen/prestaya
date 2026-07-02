// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CAJA / TESORERÍA (admin/supervisor).
//  Combina los COBROS (tabla `pagos`, ingreso principal) con los movimientos
//  de `movimientos_caja` (gastos, desembolsos, aportes, retiros) para dar el
//  resumen del período: ingresos, egresos, neto, desglose y libro cronológico.
//  Corre como gestor (RLS). Degrada si 0010 aún no existe (los cobros igual salen).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { inicioDiaUYIso, inicioMesUYIso } from "@/lib/fecha";
import { tablaFaltante } from "./errores";

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
): Promise<ResumenCaja> {
  const desde = periodo === "mes" ? inicioMesUYIso(hoy) : inicioDiaUYIso(hoy);

  // 1) Cobros del período (ingreso principal).
  const { data: pagosRaw, error: ePag } = await db
    .from("pagos")
    .select("monto, registrado_en, registrado_por, prestamo_id")
    .eq("anulado", false)
    .gte("registrado_en", desde);
  if (ePag) throw ePag;
  const pagos = pagosRaw ?? [];

  // 2) Movimientos de caja (degrada a vacío si falta 0010).
  let movimientos: Record<string, unknown>[] = [];
  try {
    const { data, error } = await db
      .from("movimientos_caja")
      .select("*")
      .gte("registrado_en", desde);
    if (error) throw error;
    movimientos = data ?? [];
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

  const prestamoIds = [...new Set(pagos.map((p) => p.prestamo_id as string))];
  const clienteDePrestamo = new Map<string, string>();
  if (prestamoIds.length > 0) {
    const { data: pres } = await db
      .from("prestamos")
      .select("id, cliente_id")
      .in("id", prestamoIds);
    const clienteIds = [...new Set((pres ?? []).map((p) => p.cliente_id as string))];
    const nombreCliente = new Map<string, string>();
    if (clienteIds.length > 0) {
      const { data: clis } = await db.from("clientes").select("id, nombre").in("id", clienteIds);
      for (const c of clis ?? []) nombreCliente.set(c.id as string, c.nombre as string);
    }
    for (const p of pres ?? [])
      clienteDePrestamo.set(p.id as string, nombreCliente.get(p.cliente_id as string) ?? "cliente");
  }

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
      concepto: `Cobro · ${clienteDePrestamo.get(p.prestamo_id as string) ?? "cliente"}`,
      monto,
      signo: 1,
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
    libro: libro.slice(0, 150),
  };
}

export interface NuevoMovimiento {
  tipo: TipoMovimiento;
  monto: number;
  categoria: string | null;
  descripcion: string | null;
  cobradorId: string | null;
  registradoPor: string;
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
  });
  if (error) throw error;
}
