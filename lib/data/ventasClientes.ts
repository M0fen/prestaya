// ─────────────────────────────────────────────────────────────────────────
//  VENTAS A CLIENTES (control). Los créditos que vinieron de una COMPRA en la
//  tienda (prestamos.origen='tienda'): quién compró qué, cuándo empezó, cuánto
//  lleva pagado y cuánto falta. Para que el admin tenga control de las ventas.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { tablaFaltante } from "./errores";

export interface VentaCliente {
  id: string;
  clienteId: string;
  clienteNombre: string | null;
  productoNombre: string;
  proveedor: string | null;
  total: number;       // a cobrar (cuota × días)
  pagado: number;      // ya cobrado
  falta: number;       // total − pagado
  cuota: number;
  totalDias: number;
  estado: string;
  fechaInicio: string;
}

const N = (v: unknown) => Math.round(Number(v) || 0);

export interface ResumenVentasClientes {
  ventas: number;
  compradores: number;
  totalVendido: number;
  totalCobrado: number;
}

export async function getVentasClientes(_db?: SupabaseClient): Promise<{ ventas: VentaCliente[]; resumen: ResumenVentasClientes }> {
  const vacio = { ventas: [] as VentaCliente[], resumen: { ventas: 0, compradores: 0, totalVendido: 0, totalCobrado: 0 } };
  const admin = createSupabaseAdmin();
  try {
    const { data, error } = await admin
      .from("prestamos")
      .select("id, cliente_id, producto_id, producto_nombre, cuota_diaria, total_dias, pagado_acum, estado, fecha_inicio")
      .eq("origen", "tienda")
      .neq("estado", "anulado")
      .order("fecha_inicio", { ascending: false })
      .limit(2000);
    if (error) throw error;
    const filas = data ?? [];
    if (filas.length === 0) return vacio;

    // Nombres de clientes (solo los que compraron) + proveedor de productos.
    const cliIds = [...new Set(filas.map((f) => (f as { cliente_id: string }).cliente_id).filter(Boolean))];
    const prodIds = [...new Set(filas.map((f) => (f as { producto_id: string | null }).producto_id).filter(Boolean))] as string[];
    const [cli, prod] = await Promise.all([
      cliIds.length ? admin.from("clientes").select("id, nombre").in("id", cliIds) : Promise.resolve({ data: [] }),
      prodIds.length ? admin.from("productos").select("id, proveedor").in("id", prodIds) : Promise.resolve({ data: [] }),
    ]);
    const nombreCli = new Map((cli.data ?? []).map((c) => [(c as { id: string }).id, (c as { nombre: string }).nombre]));
    const provProd = new Map((prod.data ?? []).map((p) => [(p as { id: string }).id, (p as { proveedor: string | null }).proveedor ?? null]));

    const ventas: VentaCliente[] = filas.map((f) => {
      const r = f as {
        id: string; cliente_id: string; producto_id: string | null; producto_nombre: string | null;
        cuota_diaria: unknown; total_dias: unknown; pagado_acum: unknown; estado: string; fecha_inicio: string;
      };
      const total = N(r.cuota_diaria) * N(r.total_dias);
      const pagado = N(r.pagado_acum);
      return {
        id: r.id,
        clienteId: r.cliente_id,
        clienteNombre: nombreCli.get(r.cliente_id) ?? null,
        productoNombre: r.producto_nombre ?? "Producto de la tienda",
        proveedor: r.producto_id ? provProd.get(r.producto_id) ?? null : null,
        total,
        pagado,
        falta: Math.max(0, total - pagado),
        cuota: N(r.cuota_diaria),
        totalDias: N(r.total_dias),
        estado: r.estado,
        fechaInicio: r.fecha_inicio,
      };
    });

    const resumen: ResumenVentasClientes = {
      ventas: ventas.length,
      compradores: new Set(ventas.map((v) => v.clienteId)).size,
      totalVendido: ventas.reduce((a, v) => a + v.total, 0),
      totalCobrado: ventas.reduce((a, v) => a + v.pagado, 0),
    };
    return { ventas, resumen };
  } catch (e) {
    if (tablaFaltante(e)) return vacio;
    throw e;
  }
}
