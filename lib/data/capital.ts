// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — INVERSIÓN DE CAPITAL (solo admin). Libro APARTE sobre la
//  MISMA tabla movimientos_caja, filtrando cuenta='capital' (NO tabla nueva).
//  Aportes de capital, retiros del dueño, transferencias y descuadres. NO
//  incluye cobros (eso es la caja operativa). Corre como gestor (RLS).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "./errores";
import { traerTodo } from "./paginado";

export interface LineaCapital {
  fechaIso: string;
  /** ingreso = entra capital; retiro = sale. */
  operacion: "ingreso" | "retiro";
  concepto: string;
  vendedor: string | null;
  monto: number;
}

export interface ResumenCapital {
  totalIngresos: number;
  totalRetiros: number;
  /** Ingresos − Retiros. */
  capitalTotal: number;
  libro: LineaCapital[];
}

const N = (v: unknown) => Number(v);

export async function getMovimientosCapital(
  db: SupabaseClient,
  opts: { desde: string; hasta: string; vendedorId?: string | null },
): Promise<ResumenCapital> {
  let movimientos: Record<string, unknown>[] = [];
  try {
    // Paginado: PostgREST corta en 1000 filas y el libro de capital se subcontaba
    // en silencio (capitalTotal MAL). movimientos_caja es chica (gastos + aportes/
    // retiros; los cobros viven en `pagos`), así que barrer la ventana es barato.
    const raw = await traerTodo<Record<string, unknown>>((d, h) => {
      let query = db
        .from("movimientos_caja")
        .select("*")
        .gte("registrado_en", opts.desde)
        .lt("registrado_en", opts.hasta);
      if (opts.vendedorId) query = query.eq("cobrador_id", opts.vendedorId);
      return query.order("id", { ascending: true }).range(d, h);
    });
    // cuenta='capital' se filtra en JS: defensivo si 0041 no corrió (columna).
    movimientos = raw.filter((m) => (m.cuenta as string | null) === "capital");
  } catch (e) {
    if (!tablaFaltante(e)) throw e;
  }

  // Resolver nombres de vendedor (cobrador_id) en un solo batch.
  const ids = new Set<string>();
  for (const m of movimientos) if (m.cobrador_id) ids.add(m.cobrador_id as string);
  const nombre = new Map<string, string>();
  if (ids.size > 0) {
    const { data } = await db.from("usuarios").select("id, nombre").in("id", [...ids]);
    for (const u of data ?? []) nombre.set(u.id as string, u.nombre as string);
  }

  let totalIngresos = 0;
  let totalRetiros = 0;
  const libro: LineaCapital[] = [];
  for (const m of movimientos) {
    const monto = N(m.monto);
    const operacion: "ingreso" | "retiro" = (m.tipo as string) === "ingreso" ? "ingreso" : "retiro";
    if (operacion === "ingreso") totalIngresos += monto;
    else totalRetiros += monto;
    libro.push({
      fechaIso: m.registrado_en as string,
      operacion,
      concepto:
        (m.categoria as string | null) ||
        (m.descripcion as string | null) ||
        (operacion === "ingreso" ? "Ingreso de capital" : "Retiro"),
      vendedor: m.cobrador_id ? (nombre.get(m.cobrador_id as string) ?? null) : null,
      monto,
    });
  }
  libro.sort((a, b) => (a.fechaIso < b.fechaIso ? 1 : -1));

  return {
    totalIngresos,
    totalRetiros,
    capitalTotal: totalIngresos - totalRetiros,
    libro,
  };
}
