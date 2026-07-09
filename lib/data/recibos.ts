// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RECIBOS a trabajadores (0046). Comprobante interno de pago
//  (comisión/sueldo/adelanto…), numerado e imprimible. Degrada si falta 0046.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "./errores";

export interface Recibo {
  id: string;
  numero: number;
  trabajadorId: string | null;
  trabajadorNombre: string;
  concepto: string;
  monto: number;
  periodo: string | null;
  nota: string | null;
  emitidoPorNombre: string | null;
  emitidoEn: string;
}

function mapRecibo(r: Record<string, unknown>): Recibo {
  return {
    id: r.id as string,
    numero: Number(r.numero),
    trabajadorId: (r.trabajador_id as string | null) ?? null,
    trabajadorNombre: r.trabajador_nombre as string,
    concepto: r.concepto as string,
    monto: Number(r.monto),
    periodo: (r.periodo as string | null) ?? null,
    nota: (r.nota as string | null) ?? null,
    emitidoPorNombre: (r.emitido_por_nombre as string | null) ?? null,
    emitidoEn: r.emitido_en as string,
  };
}

/** Últimos recibos emitidos (para la lista/historial). */
export async function getRecibos(db: SupabaseClient, limite = 50): Promise<Recibo[]> {
  try {
    const { data, error } = await db
      .from("recibos")
      .select("*")
      .order("emitido_en", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []).map(mapRecibo);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export interface NuevoRecibo {
  trabajadorId: string | null;
  trabajadorNombre: string;
  concepto: string;
  monto: number;
  periodo: string | null;
  nota: string | null;
  emitidoPor: string;
  emitidoPorNombre: string;
}

/** Inserta un recibo y devuelve el creado (con su número). */
export async function crearReciboDb(db: SupabaseClient, r: NuevoRecibo): Promise<Recibo> {
  const { data, error } = await db
    .from("recibos")
    .insert({
      trabajador_id: r.trabajadorId,
      trabajador_nombre: r.trabajadorNombre,
      concepto: r.concepto,
      monto: r.monto,
      periodo: r.periodo,
      nota: r.nota,
      emitido_por: r.emitidoPor,
      emitido_por_nombre: r.emitidoPorNombre,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapRecibo(data);
}
