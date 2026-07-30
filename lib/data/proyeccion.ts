// ─────────────────────────────────────────────────────────────────────────
//  BASE PARA LA PROYECCIÓN DE VENTAS de la tienda (admin). Números REALES de la
//  operación (clientes activos, catálogo, ventas ya hechas) que alimentan el
//  simulador "¿cuánto puede facturar la tienda?". El cálculo/proyección se hace
//  en el cliente (interactivo); acá solo traemos la base.
//
//  Los conteos van por service_role: un count sobre ~13k clientes evaluando el
//  RLS por-fila da statement timeout (mismo motivo que en metricas.ts).
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { tablaFaltante, columnaFaltante } from "./errores";

export interface BaseProyeccion {
  clientesActivos: number;   // clientes con cuenta activa (universo alcanzable)
  productosActivos: number;  // catálogo publicado
  precioPromedio: number;    // ticket promedio del catálogo (referencia)
  ventasReales: number;      // ventas de tienda ya realizadas (origen='tienda')
  ingresoReal: number;       // Σ de lo colocado en esas ventas
}

export async function getBaseProyeccion(): Promise<BaseProyeccion> {
  const vacio: BaseProyeccion = { clientesActivos: 0, productosActivos: 0, precioPromedio: 0, ventasReales: 0, ingresoReal: 0 };
  const admin = createSupabaseAdmin();
  try {
    const [cli, prods, ventas] = await Promise.all([
      admin.from("clientes").select("*", { count: "exact", head: true }).eq("activo", true),
      admin.from("productos").select("precio").eq("activo", true).limit(3000),
      admin.from("prestamos").select("monto").eq("origen", "tienda").limit(10000),
    ]);
    const precios = (prods.data ?? []).map((r) => Math.round(Number(r.precio) || 0)).filter((n) => n > 0);
    const precioPromedio = precios.length ? Math.round(precios.reduce((a, b) => a + b, 0) / precios.length) : 0;
    const montos = (ventas.data ?? []).map((r) => Math.round(Number(r.monto) || 0));
    return {
      clientesActivos: cli.count ?? 0,
      productosActivos: precios.length,
      precioPromedio,
      ventasReales: montos.length,
      ingresoReal: montos.reduce((a, b) => a + b, 0),
    };
  } catch (e) {
    if (tablaFaltante(e) || columnaFaltante(e)) return vacio;
    throw e;
  }
}
