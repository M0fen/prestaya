// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — GASTOS de ruta del cobrador (egresos en `movimientos_caja`).
//  Corre con la sesión del cobrador (RLS de 0017: solo sus egresos). Degrada
//  a vacío si falta 0010 (la tabla de caja).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { inicioDiaUYIso } from "@/lib/fecha";
import { tablaFaltante } from "./errores";

export interface GastoRuta {
  monto: number;
  categoria: string | null;
  descripcion: string | null;
  registradoEn: string;
}

export interface GastosCobradorHoy {
  total: number;
  items: GastoRuta[];
}

/** Gastos de HOY del cobrador (suma + lista). Degrada a vacío si falta la tabla. */
export async function getGastosCobradorHoy(
  db: SupabaseClient,
  cobradorId: string,
  hoy: Date = new Date(),
): Promise<GastosCobradorHoy> {
  try {
    const { data, error } = await db
      .from("movimientos_caja")
      .select("monto, categoria, descripcion, registrado_en")
      .eq("tipo", "egreso")
      .eq("cobrador_id", cobradorId)
      .gte("registrado_en", inicioDiaUYIso(hoy))
      .order("registrado_en", { ascending: false });
    if (error) throw error;
    const items = (data ?? []).map((r) => ({
      monto: Number(r.monto),
      categoria: (r.categoria as string | null) ?? null,
      descripcion: (r.descripcion as string | null) ?? null,
      registradoEn: r.registrado_en as string,
    }));
    return { total: items.reduce((s, g) => s + g.monto, 0), items };
  } catch (e) {
    if (tablaFaltante(e)) return { total: 0, items: [] };
    throw e;
  }
}
// El alta de gastos ya no es directa: el cobrador SOLICITA (solicitudes_gasto,
// 0057) y el admin aprueba → recién ahí se crea el egreso. Ver lib/acciones/gastos.ts.
