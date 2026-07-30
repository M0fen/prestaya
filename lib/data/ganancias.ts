// ─────────────────────────────────────────────────────────────────────────
//  GANANCIAS DE LA TIENDA (0114). Atribuye el dinero por ORIGEN para que el admin
//  sepa "de dónde es qué": ventas a clientes vs compras del equipo, y productos
//  Curbe vs propios. Ganancia por venta = total a cobrar − costo del producto.
//  Todo por service_role (agrega sobre prestamos/compras sin fricción de RLS).
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { tablaFaltante, columnaFaltante } from "./errores";

export interface BloqueGanancia {
  unidades: number;   // ventas
  vendido: number;    // Σ total a cobrar
  costo: number;      // Σ costo (solo de los que tienen costo definido)
  ganancia: number;   // vendido − costo (solo con costo)
  cobrado: number;    // Σ ya cobrado (cash real hasta ahora)
  sinCosto: number;   // unidades sin costo definido (ganancia a definir)
}

export interface ProductoGanancia {
  productoId: string | null;
  nombre: string;
  proveedor: string | null;
  unidades: number;
  vendido: number;
  costo: number | null;
  ganancia: number | null;
}

export interface GananciasTienda {
  total: BloqueGanancia;
  porCanal: { clientes: BloqueGanancia; equipo: BloqueGanancia };
  porProveedor: { curbe: BloqueGanancia; propios: BloqueGanancia };
  porProducto: ProductoGanancia[];
  productosSinCosto: number; // productos activos del catálogo sin costo definido
}

const N = (v: unknown) => Math.round(Number(v) || 0);

function bloqueVacio(): BloqueGanancia {
  return { unidades: 0, vendido: 0, costo: 0, ganancia: 0, cobrado: 0, sinCosto: 0 };
}

/** Suma una venta a un bloque. costo null = sin costo → no computa ganancia. */
function acumular(b: BloqueGanancia, vendido: number, costo: number | null, cobrado: number) {
  b.unidades += 1;
  b.vendido += vendido;
  b.cobrado += cobrado;
  if (costo == null) {
    b.sinCosto += 1;
  } else {
    b.costo += costo;
    b.ganancia += vendido - costo;
  }
}

export async function getGananciasTienda(): Promise<GananciasTienda> {
  const g: GananciasTienda = {
    total: bloqueVacio(),
    porCanal: { clientes: bloqueVacio(), equipo: bloqueVacio() },
    porProveedor: { curbe: bloqueVacio(), propios: bloqueVacio() },
    porProducto: [],
    productosSinCosto: 0,
  };
  const admin = createSupabaseAdmin();
  try {
    // Mapa producto → {costo, proveedor, nombre}. Barato (~decenas de productos).
    const { data: prods } = await admin.from("productos").select("id, nombre, costo, proveedor, activo");
    const mapProd = new Map<string, { nombre: string; costo: number | null; proveedor: string | null }>();
    for (const p of prods ?? []) {
      const pr = p as { id: string; nombre: string; costo: unknown; proveedor: string | null; activo: boolean };
      mapProd.set(pr.id, { nombre: pr.nombre, costo: pr.costo == null ? null : N(pr.costo), proveedor: pr.proveedor ?? null });
      if (pr.activo && pr.costo == null) g.productosSinCosto += 1;
    }

    // Acumulador por producto (para la tabla de rentabilidad).
    const porProd = new Map<string, ProductoGanancia>();
    const sumaProd = (id: string | null, nombre: string, prov: string | null, vendido: number, costo: number | null) => {
      const key = id ?? `nombre:${nombre}`;
      const e = porProd.get(key) ?? { productoId: id, nombre, proveedor: prov, unidades: 0, vendido: 0, costo: costo == null ? null : 0, ganancia: costo == null ? null : 0 };
      e.unidades += 1;
      e.vendido += vendido;
      if (costo != null) {
        e.costo = (e.costo ?? 0) + costo;
        e.ganancia = (e.ganancia ?? 0) + (vendido - costo);
      }
      porProd.set(key, e);
    };

    // ── Ventas a CLIENTES (prestamos origen='tienda') ──
    const { data: ventas } = await admin
      .from("prestamos")
      .select("cuota_diaria, total_dias, pagado_acum, estado, producto_id, producto_nombre")
      .eq("origen", "tienda")
      .neq("estado", "anulado")
      .limit(20000);
    for (const v of ventas ?? []) {
      const row = v as { cuota_diaria: unknown; total_dias: unknown; pagado_acum: unknown; producto_id: string | null; producto_nombre: string | null };
      const prod = row.producto_id ? mapProd.get(row.producto_id) : undefined;
      const vendido = N(row.cuota_diaria) * N(row.total_dias);
      const cobrado = N(row.pagado_acum);
      const costo = prod?.costo ?? null;
      const prov = prod?.proveedor ?? null;
      acumular(g.porCanal.clientes, vendido, costo, cobrado);
      acumular(prov === "curbe" ? g.porProveedor.curbe : g.porProveedor.propios, vendido, costo, cobrado);
      sumaProd(row.producto_id, prod?.nombre ?? row.producto_nombre ?? "Producto", prov, vendido, costo);
    }

    // ── Compras del EQUIPO (compras_empleado) ──
    try {
      const { data: compras } = await admin
        .from("compras_empleado")
        .select("total, saldo, estado, producto_id, producto_nombre")
        .neq("estado", "cancelada")
        .limit(20000);
      for (const c of compras ?? []) {
        const row = c as { total: unknown; saldo: unknown; producto_id: string | null; producto_nombre: string | null };
        const prod = row.producto_id ? mapProd.get(row.producto_id) : undefined;
        const vendido = N(row.total);
        const cobrado = N(row.total) - N(row.saldo);
        const costo = prod?.costo ?? null;
        const prov = prod?.proveedor ?? null;
        acumular(g.porCanal.equipo, vendido, costo, cobrado);
        acumular(prov === "curbe" ? g.porProveedor.curbe : g.porProveedor.propios, vendido, costo, cobrado);
        sumaProd(row.producto_id, prod?.nombre ?? row.producto_nombre ?? "Producto", prov, vendido, costo);
      }
    } catch (e) {
      if (!tablaFaltante(e)) throw e; // sin 0113 → sin compras del equipo, no rompe
    }

    // Total = clientes + equipo.
    for (const b of [g.porCanal.clientes, g.porCanal.equipo]) {
      g.total.unidades += b.unidades;
      g.total.vendido += b.vendido;
      g.total.costo += b.costo;
      g.total.ganancia += b.ganancia;
      g.total.cobrado += b.cobrado;
      g.total.sinCosto += b.sinCosto;
    }

    g.porProducto = [...porProd.values()].sort((a, b) => (b.ganancia ?? b.vendido) - (a.ganancia ?? a.vendido));
    return g;
  } catch (e) {
    if (tablaFaltante(e) || columnaFaltante(e)) return g; // sin 0114 → ceros
    throw e;
  }
}
