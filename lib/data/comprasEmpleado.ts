// ─────────────────────────────────────────────────────────────────────────
//  COMPRAS DEL EQUIPO A CRÉDITO (0113). Un cobrador/supervisor compra un producto
//  y la cuota se descuenta de su comisión. Capa de datos: alta vía RPC atómico +
//  lecturas para el empleado y el admin + el descuento (llamado al liquidar).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante, funcionFaltante } from "./errores";

export type EstadoCompraEmpleado = "activa" | "saldada" | "cancelada";

/** Un descuento aplicado (repago de una cuota desde la comisión). */
export interface DescuentoCompra {
  periodoKey: string;
  monto: number;
  creadoEn: string;
}

export interface CompraEmpleado {
  id: string;
  empleadoId: string;
  empleadoNombre: string | null;
  productoId: string | null;
  productoNombre: string;
  precio: number;
  cuotas: number;
  cuotaMonto: number;
  total: number;
  saldo: number;
  estado: EstadoCompraEmpleado;
  /** Cuándo empezó el crédito de este artículo. */
  creadaEn: string;
  /** Historial de descuentos (lo que se fue pagando, más reciente primero). */
  descuentos: DescuentoCompra[];
}

const N = (v: unknown) => Math.round(Number(v) || 0);

function mapCompra(r: Record<string, unknown>): CompraEmpleado {
  const emp = r.empleado as { nombre?: string } | null;
  return {
    id: r.id as string,
    empleadoId: r.empleado_id as string,
    empleadoNombre: emp?.nombre ?? null,
    productoId: (r.producto_id as string | null) ?? null,
    productoNombre: (r.producto_nombre as string) ?? "",
    precio: N(r.precio),
    cuotas: N(r.cuotas),
    cuotaMonto: N(r.cuota_monto),
    total: N(r.total),
    saldo: N(r.saldo),
    estado: (r.estado as EstadoCompraEmpleado) ?? "activa",
    creadaEn: r.creada_en as string,
    descuentos: [],
  };
}

const SEL = "*, empleado:usuarios!empleado_id(nombre)";

/** Adjunta a cada compra su historial de descuentos (una consulta para todas). */
async function conDescuentos(db: SupabaseClient, compras: CompraEmpleado[]): Promise<CompraEmpleado[]> {
  if (compras.length === 0) return compras;
  const ids = compras.map((c) => c.id);
  const { data, error } = await db
    .from("descuentos_compra_empleado")
    .select("compra_id, periodo_key, monto, creado_en")
    .in("compra_id", ids)
    .order("creado_en", { ascending: false });
  if (error) throw error;
  const porCompra = new Map<string, DescuentoCompra[]>();
  for (const r of data ?? []) {
    const cid = (r as { compra_id: string }).compra_id;
    const lista = porCompra.get(cid) ?? [];
    lista.push({
      periodoKey: (r as { periodo_key: string }).periodo_key,
      monto: N((r as { monto: unknown }).monto),
      creadoEn: (r as { creado_en: string }).creado_en,
    });
    porCompra.set(cid, lista);
  }
  return compras.map((c) => ({ ...c, descuentos: porCompra.get(c.id) ?? [] }));
}

/** Alta de una compra de empleado (RPC atómico: precio server-side, CAP, stock, op_id). */
export async function crearCompraEmpleadoDb(
  db: SupabaseClient,
  p: { empleadoId: string; productoId: string; cuotas: number; opId: string; creadoPor: string },
): Promise<{ ok: true; compra: CompraEmpleado } | { ok: false; error: string }> {
  const { data, error } = await db.rpc("crear_compra_empleado_seguro", {
    p_empleado_id: p.empleadoId,
    p_producto_id: p.productoId,
    p_cuotas: p.cuotas,
    p_op_id: p.opId,
    p_creado_por: p.creadoPor,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42883" || code === "PGRST202") return { ok: false, error: "Falta correr la migración 0113 (compras del equipo)." };
    if (code === "P0401") return { ok: false, error: "Solo podés comprar para vos mismo." };
    if (code === "P0403") return { ok: false, error: "El producto supera el tope de compra del equipo ($30.000)." };
    if (code === "P0409") return { ok: false, error: "El producto está sin stock." };
    if (code === "P0410") return { ok: false, error: "El producto está inactivo." };
    if (code === "P0002") return { ok: false, error: "El producto ya no existe." };
    return { ok: false, error: "No se pudo registrar la compra. Probá de nuevo." };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, compra: mapCompra(row as Record<string, unknown>) };
}

/** Todas las compras del equipo (admin). */
export async function getComprasEmpleado(db: SupabaseClient, limite = 300): Promise<CompraEmpleado[]> {
  try {
    const { data, error } = await db.from("compras_empleado").select(SEL).order("creada_en", { ascending: false }).limit(limite);
    if (error) throw error;
    return conDescuentos(db, (data ?? []).map((r) => mapCompra(r as Record<string, unknown>)));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Las compras del empleado logueado (para su vista en la tienda). */
export async function getMisComprasEmpleado(db: SupabaseClient, empleadoId: string): Promise<CompraEmpleado[]> {
  try {
    const { data, error } = await db.from("compras_empleado").select(SEL).eq("empleado_id", empleadoId).order("creada_en", { ascending: false }).limit(100);
    if (error) throw error;
    return conDescuentos(db, (data ?? []).map((r) => mapCompra(r as Record<string, unknown>)));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export interface ResumenComprasEmpleado {
  activas: number;
  saldoTotal: number;
  compradores: number;
}

/** KPIs para el panel del admin. */
export async function getResumenComprasEmpleado(db: SupabaseClient): Promise<ResumenComprasEmpleado> {
  try {
    const { data, error } = await db.from("compras_empleado").select("empleado_id, saldo, estado").eq("estado", "activa");
    if (error) throw error;
    const rows = data ?? [];
    return {
      activas: rows.length,
      saldoTotal: rows.reduce((a, r) => a + N((r as { saldo: unknown }).saldo), 0),
      compradores: new Set(rows.map((r) => (r as { empleado_id: string }).empleado_id)).size,
    };
  } catch (e) {
    if (tablaFaltante(e)) return { activas: 0, saldoTotal: 0, compradores: 0 };
    throw e;
  }
}

/**
 * Cancela una compra (admin): sin más descuentos. NO revierte stock (best-effort).
 * Devuelve `true` si realmente cambió una fila. ⚠️ `compras_empleado` tiene RLS con
 * SOLO policy de SELECT (las escrituras van por RPC SECURITY DEFINER), así que este
 * UPDATE DIRECTO debe hacerse con el cliente ADMIN (service_role); con el cliente de
 * sesión afectaría 0 filas SIN error → cancelación fantasma que sigue descontando la
 * comisión. El `.select("id")` confirma que la fila cambió (no un no-op silencioso).
 */
export async function cancelarCompraEmpleadoDb(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db
    .from("compras_empleado")
    .update({ estado: "cancelada", actualizada_en: new Date().toISOString() })
    .eq("id", id)
    .eq("estado", "activa")
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Descuenta las cuotas del período de las compras activas del empleado, hasta el
 * tope (la comisión). Devuelve lo descontado. Idempotente por período. Si falta la
 * migración 0113, devuelve 0 (la liquidación de comisión sigue funcionando).
 */
export async function descontarComprasEmpleadoDb(
  db: SupabaseClient,
  p: { empleadoId: string; periodoKey: string; tope: number; creadoPor: string },
): Promise<number> {
  try {
    const { data, error } = await db.rpc("descontar_compras_empleado", {
      p_empleado_id: p.empleadoId,
      p_periodo_key: p.periodoKey,
      p_tope: p.tope,
      p_creado_por: p.creadoPor,
    });
    if (error) throw error;
    return Math.round(Number(data) || 0);
  } catch (e) {
    if (funcionFaltante(e) || tablaFaltante(e)) return 0; // sin 0113 → no descuenta, no rompe
    throw e;
  }
}

/**
 * Revierte el descuento de compras de un período (restaura saldo + borra filas). Se
 * usa cuando el egreso de la comisión falla, para no dejar un descuento huérfano.
 * Best-effort: si falta la migración 0117 no rompe.
 */
export async function revertirDescuentoComprasEmpleadoDb(
  db: SupabaseClient,
  p: { empleadoId: string; periodoKey: string },
): Promise<void> {
  try {
    const { error } = await db.rpc("revertir_descuento_compras_empleado", {
      p_empleado_id: p.empleadoId,
      p_periodo_key: p.periodoKey,
    });
    if (error) throw error;
  } catch (e) {
    if (funcionFaltante(e) || tablaFaltante(e)) return;
    throw e;
  }
}
