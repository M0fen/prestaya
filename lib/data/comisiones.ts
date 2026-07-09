// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — COMISIONES por cobrador (tasa % sobre lo recaudado).
//  Reusa el recaudado por cobrador del período (getResumenPeriodo) y le aplica
//  la comision_pct de cada cobrador (columna en `usuarios`, 0014). Lista TODOS
//  los cobradores activos (para poder fijarles la tasa aunque no hayan cobrado).
//  Degrada si 0014 aún no corrió (disponible=false, pct=0).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { getResumenPeriodo, type Periodo } from "./periodo";
import { calcularComision } from "@/lib/comision";
import { columnaFaltante } from "./errores";

export interface FilaComision {
  cobradorId: string;
  nombre: string;
  recaudado: number;
  cobros: number;
  pct: number;
  comision: number;
}

export interface ResumenComisiones {
  periodo: Periodo;
  etiqueta: string;
  /** Rango del período (día UY "YYYY-MM-DD"), para mostrar "del X al Y". */
  desde: string;
  hasta: string;
  filas: FilaComision[];
  totalRecaudado: number;
  totalComision: number;
  /** Total de cobros del período (suma de cobros de todos los cobradores). */
  totalCobros: number;
  /** false si falta la columna comision_pct (migración 0014 sin correr). */
  disponible: boolean;
}

export async function getComisionesPeriodo(
  db: SupabaseClient,
  periodo: Periodo,
  hoy: Date = new Date(),
): Promise<ResumenComisiones> {
  const resumen = await getResumenPeriodo(db, periodo, hoy);
  const recaudadoDe = new Map(resumen.porCobrador.map((c) => [c.cobradorId, c]));

  // Cobradores activos + su tasa (degrada si no existe la columna).
  let cobs: { id: string; nombre: string; comision_pct: number }[] = [];
  let disponible = true;
  try {
    const { data, error } = await db
      .from("usuarios")
      .select("id, nombre, comision_pct")
      .eq("rol", "cobrador")
      .eq("activo", true)
      .order("nombre");
    if (error) throw error;
    cobs = (data ?? []).map((u) => ({
      id: u.id as string,
      nombre: u.nombre as string,
      comision_pct: Number(u.comision_pct ?? 0),
    }));
  } catch (e) {
    if (!columnaFaltante(e)) throw e;
    disponible = false;
    const { data } = await db
      .from("usuarios")
      .select("id, nombre")
      .eq("rol", "cobrador")
      .eq("activo", true)
      .order("nombre");
    cobs = (data ?? []).map((u) => ({ id: u.id as string, nombre: u.nombre as string, comision_pct: 0 }));
  }

  const filas: FilaComision[] = cobs
    .map((u) => {
      const r = recaudadoDe.get(u.id);
      const recaudado = r?.recaudado ?? 0;
      const cobros = r?.cobros ?? 0;
      return {
        cobradorId: u.id,
        nombre: u.nombre,
        recaudado,
        cobros,
        pct: u.comision_pct,
        comision: calcularComision(recaudado, u.comision_pct),
      };
    })
    .sort((a, b) => b.comision - a.comision || b.recaudado - a.recaudado);

  return {
    periodo,
    etiqueta: resumen.etiqueta,
    desde: resumen.desde,
    hasta: resumen.hasta,
    filas,
    totalRecaudado: resumen.recaudado,
    totalComision: filas.reduce((s, f) => s + f.comision, 0),
    totalCobros: filas.reduce((s, f) => s + f.cobros, 0),
    disponible,
  };
}

/** Fija la comisión (%) de un cobrador. */
export async function setComisionPctDb(
  db: SupabaseClient,
  cobradorId: string,
  pct: number,
): Promise<void> {
  const { error } = await db.from("usuarios").update({ comision_pct: pct }).eq("id", cobradorId);
  if (error) throw error;
}
