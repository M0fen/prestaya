// ─────────────────────────────────────────────────────────────────────────
//  PEDIDOS A CURBE (0112) — cola de DESPACHO. Cuando se vende un producto cuyo
//  proveedor es Curbe, se crea un pedido acá. El admin le avisa a Curbe (WhatsApp/
//  mail, no hay API) y lo trackea: pendiente → pedido → despachado. Es logística;
//  el dinero (el crédito de la venta) vive en `prestamos`, no acá.
//
//  Lectura: solo admin (RLS). Escritura: service_role desde las acciones.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "@/lib/data/errores";

export type EstadoPedidoCurbe = "pendiente" | "pedido" | "despachado" | "cancelado";

export interface PedidoCurbe {
  id: string;
  prestamoId: string | null;
  productoId: string | null;
  productoNombre: string;
  clienteNombre: string | null;
  clienteTelefono: string | null;
  clienteDireccion: string | null;
  monto: number;
  estado: EstadoPedidoCurbe;
  nota: string | null;
  creadoEn: string;
  notificadoEn: string | null;
}

function mapPedido(r: Record<string, unknown>): PedidoCurbe {
  return {
    id: r.id as string,
    prestamoId: (r.prestamo_id as string | null) ?? null,
    productoId: (r.producto_id as string | null) ?? null,
    productoNombre: (r.producto_nombre as string) ?? "",
    clienteNombre: (r.cliente_nombre as string | null) ?? null,
    clienteTelefono: (r.cliente_telefono as string | null) ?? null,
    clienteDireccion: (r.cliente_direccion as string | null) ?? null,
    monto: Math.round(Number(r.monto) || 0),
    estado: (r.estado as EstadoPedidoCurbe) ?? "pendiente",
    nota: (r.nota as string | null) ?? null,
    creadoEn: r.creado_en as string,
    notificadoEn: (r.notificado_en as string | null) ?? null,
  };
}

/** Cola de despacho para el admin (activos primero, luego por fecha). */
export async function getPedidosCurbe(db: SupabaseClient, limite = 200): Promise<PedidoCurbe[]> {
  try {
    const { data, error } = await db
      .from("pedidos_curbe")
      .select("*")
      .order("creado_en", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []).map(mapPedido);
  } catch (e) {
    if (tablaFaltante(e)) return []; // defensivo: sin 0112 la tienda anda igual
    throw e;
  }
}

/** Cuántos pedidos esperan que se le avise a Curbe (para el badge del nav). */
export async function contarPedidosCurbePendientes(db: SupabaseClient): Promise<number> {
  try {
    const { count, error } = await db
      .from("pedidos_curbe")
      .select("*", { count: "exact", head: true })
      .eq("estado", "pendiente");
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    if (tablaFaltante(e)) return 0;
    throw e;
  }
}

export interface PedidoCurbeInput {
  prestamoId: string | null;
  productoId: string | null;
  productoNombre: string;
  clienteNombre: string | null;
  clienteTelefono: string | null;
  clienteDireccion: string | null;
  monto: number;
}

/**
 * Crea el pedido de despacho (service_role). IDEMPOTENTE por venta: si ya existe
 * uno para este prestamo_id, no duplica (un reintento de la conversión no genera
 * dos pedidos a Curbe). Devuelve false si no pudo (tabla ausente) sin romper la venta.
 */
export async function crearPedidoCurbeDb(admin: SupabaseClient, p: PedidoCurbeInput): Promise<boolean> {
  try {
    if (p.prestamoId) {
      const { data: ya } = await admin
        .from("pedidos_curbe")
        .select("id")
        .eq("prestamo_id", p.prestamoId)
        .limit(1)
        .maybeSingle();
      if (ya) return true; // ya encolado
    }
    const { error } = await admin.from("pedidos_curbe").insert({
      prestamo_id: p.prestamoId,
      producto_id: p.productoId,
      producto_nombre: p.productoNombre,
      cliente_nombre: p.clienteNombre,
      cliente_telefono: p.clienteTelefono,
      cliente_direccion: p.clienteDireccion,
      monto: p.monto,
      estado: "pendiente",
    });
    if (error) throw error;
    return true;
  } catch (e) {
    if (tablaFaltante(e)) return false;
    throw e;
  }
}

export interface CurbeResumen {
  productosCurbe: number;        // productos con proveedor='curbe'
  productosActivos: number;      // …y visibles en la tienda
  ventas: number;                // pedidos no cancelados (cada venta encola uno)
  totalVendido: number;          // Σ monto de esas ventas (lo que pagan los clientes)
  porDespachar: number;          // estado pendiente + pedido
  despachados: number;
  porEstado: Record<EstadoPedidoCurbe, number>;
}

/** KPIs de la integración Curbe para el hub del admin. Defensivo: sin 0112 → ceros. */
export async function getCurbeResumen(db: SupabaseClient): Promise<CurbeResumen> {
  const vacio: CurbeResumen = {
    productosCurbe: 0, productosActivos: 0, ventas: 0, totalVendido: 0,
    porDespachar: 0, despachados: 0,
    porEstado: { pendiente: 0, pedido: 0, despachado: 0, cancelado: 0 },
  };
  try {
    const [prodTot, prodAct, pedidos] = await Promise.all([
      db.from("productos").select("*", { count: "exact", head: true }).eq("proveedor", "curbe"),
      db.from("productos").select("*", { count: "exact", head: true }).eq("proveedor", "curbe").eq("activo", true),
      db.from("pedidos_curbe").select("estado, monto").limit(5000),
    ]);
    const r = { ...vacio, porEstado: { pendiente: 0, pedido: 0, despachado: 0, cancelado: 0 } };
    r.productosCurbe = prodTot.count ?? 0;
    r.productosActivos = prodAct.count ?? 0;
    for (const row of pedidos.data ?? []) {
      const estado = (row.estado as EstadoPedidoCurbe) ?? "pendiente";
      r.porEstado[estado] = (r.porEstado[estado] ?? 0) + 1;
      if (estado !== "cancelado") {
        r.ventas += 1;
        r.totalVendido += Math.round(Number(row.monto) || 0);
      }
    }
    r.porDespachar = r.porEstado.pendiente + r.porEstado.pedido;
    r.despachados = r.porEstado.despachado;
    return r;
  } catch (e) {
    if (tablaFaltante(e)) return vacio;
    throw e;
  }
}

/** Cambia el estado del pedido (service_role). Marca notificado_en al pasar a 'pedido'. */
export async function actualizarPedidoCurbeDb(
  admin: SupabaseClient,
  id: string,
  estado: EstadoPedidoCurbe,
  resueltoPor: string,
  nota?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { estado, resuelto_por: resueltoPor };
  if (nota !== undefined) patch.nota = nota;
  if (estado === "pedido") patch.notificado_en = new Date().toISOString();
  const { error } = await admin.from("pedidos_curbe").update(patch).eq("id", id);
  if (error) throw error;
}
