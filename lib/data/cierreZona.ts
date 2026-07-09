// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CIERRE DE CAJA POR ZONA (0047 opcional).
//  Toma las rendiciones del día (ya acotadas por zona vía alcance), las agrupa
//  por la zona del cobrador con el núcleo puro `lib/cierreZona.ts` y adjunta la
//  confirmación del supervisor si ya cerró la zona. Degrada elegante: si falta
//  0013 no hay rendiciones; si falta 0047 el consolidado se ve igual, sin el
//  sello de "cerrada".
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { toIso } from "@/lib/format";
import { hoyUY } from "@/lib/fecha";
import { alcanceDelActor, type Alcance } from "./alcance";
import { getRendicionesDia } from "./rendicion";
import { tablaFaltante } from "./errores";
import {
  consolidarPorZona,
  type CierreConsolidado,
  type ConfirmacionCierre,
  type RendidaLite,
  type PendienteLite,
} from "@/lib/cierreZona";

export interface ResumenCierreZonas {
  consolidado: CierreConsolidado;
  /** false si falta la migración 0013 (rendiciones). */
  disponible: boolean;
  /** false si falta la migración 0047 (confirmación de cierre por zona). */
  confirmacionesDisponible: boolean;
}

export async function getCierrePorZona(
  db: SupabaseClient,
  hoy: Date = new Date(),
  alcancePre?: Alcance,
): Promise<ResumenCierreZonas> {
  const alcance = alcancePre ?? (await alcanceDelActor());

  // Rendiciones del día, ya acotadas a la(s) zona(s) del gestor.
  const rend = await getRendicionesDia(db, hoy, alcance);

  const rendidas: RendidaLite[] = rend.rendidas.map((r) => ({
    cobradorId: r.cobradorId,
    nombre: r.cobradorNombre ?? "Cobrador",
    recaudado: r.recaudado,
    gastos: r.gastos,
    entregado: r.entregado,
    diferencia: r.diferencia,
    estado: r.estado,
  }));
  const pendientes: PendienteLite[] = rend.pendientes.map((p) => ({
    cobradorId: p.cobradorId,
    nombre: p.nombre,
    recaudado: p.recaudado,
    cobros: p.cobros,
  }));

  // Zona de cada cobrador que aparece hoy (few ids → `.in` directo).
  const ids = [...new Set([...rendidas, ...pendientes].map((c) => c.cobradorId))];
  const cobradorZona = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data } = await db.from("usuarios").select("id, zona_id").in("id", ids);
    for (const u of data ?? [])
      cobradorZona.set(u.id as string, (u.zona_id as string | null) ?? null);
  }

  // Nombres de zona (sin filtrar por activo: solo para etiquetar).
  const zonaNombre = new Map<string, string>();
  try {
    const { data, error } = await db.from("zonas").select("id, nombre");
    if (error) throw error;
    for (const z of data ?? []) zonaNombre.set(z.id as string, z.nombre as string);
  } catch {
    /* sin tabla de zonas → todo cae en "Sin zona" */
  }

  const consolidado = consolidarPorZona(rendidas, pendientes, cobradorZona, zonaNombre);

  // Confirmaciones del supervisor (0047). Degrada si la tabla no existe.
  let confirmacionesDisponible = true;
  try {
    const { data, error } = await db
      .from("cierres_zona")
      .select("zona_id, supervisor_nombre, total_entregado, creado_en")
      .eq("fecha", toIso(hoyUY(hoy)));
    if (error) throw error;
    const porZona = new Map<string, ConfirmacionCierre>();
    for (const c of data ?? []) {
      porZona.set(c.zona_id as string, {
        supervisorNombre: (c.supervisor_nombre as string | null) ?? null,
        totalEntregado: Number(c.total_entregado),
        creadoEn: c.creado_en as string,
      });
    }
    for (const z of consolidado.zonas) {
      if (z.zonaId) z.confirmado = porZona.get(z.zonaId) ?? null;
    }
  } catch (e) {
    if (tablaFaltante(e)) confirmacionesDisponible = false;
    else throw e;
  }

  return { consolidado, disponible: rend.disponible, confirmacionesDisponible };
}
