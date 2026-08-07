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
import { getRendicionesDia, type ResumenRendiciones } from "./rendicion";
import { tablaFaltante } from "./errores";
import {
  consolidarPorZona,
  CLAVE_SIN_ZONA,
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
  // Perf: si el caller ya trae las rendiciones del día (p. ej. "Mi jornada", que
  // las comparte con el Centro de alertas), las pasa para no recomputarlas.
  rendPre?: ResumenRendiciones,
): Promise<ResumenCierreZonas> {
  const alcance = alcancePre ?? (await alcanceDelActor());

  // Rendiciones del día, ya acotadas a la(s) zona(s) del gestor.
  const rend = rendPre ?? (await getRendicionesDia(db, hoy, alcance));

  const rendidas: RendidaLite[] = rend.rendidas.map((r) => ({
    cobradorId: r.cobradorId,
    nombre: r.cobradorNombre ?? "Cobrador",
    recaudado: r.recaudado,
    gastos: r.gastos,
    entregado: r.entregado,
    diferencia: r.diferencia,
    estado: r.estado,
    base: r.base,
    recaudadoVivo: r.recaudadoVivo,
    colocado: r.colocado,
  }));
  const pendientes: PendienteLite[] = rend.pendientes.map((p) => ({
    cobradorId: p.cobradorId,
    nombre: p.nombre,
    recaudado: p.recaudado,
    cobros: p.cobros,
    colocado: p.colocado,
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

  // Cobradores ACTIVOS del plantel que hoy no aparecen por ningún lado (ni rindieron
  // ni registraron un cobro). El consolidado se arma desde la ACTIVIDAD del día, así
  // que un cobrador que no tocó la app es invisible — y el cierre de zona es único e
  // inmutable: si su recaudo aparece después, ya no entra. Se lista para que el
  // supervisor confirme a conciencia (franco / sin señal / app rota).
  try {
    let q = db.from("usuarios").select("id, nombre, zona_id").eq("rol", "cobrador").eq("activo", true);
    if (!alcance.global && alcance.cobradorIds.length > 0) q = q.in("id", alcance.cobradorIds);
    const { data: plantel, error } = await q;
    if (error) throw error;
    const conActividad = new Set<string>();
    for (const z of consolidado.zonas) for (const c of z.cobradores) conActividad.add(c.cobradorId);
    const porZona = new Map<string, { cobradorId: string; nombre: string }[]>();
    for (const u of plantel ?? []) {
      const id = u.id as string;
      if (conActividad.has(id)) continue;
      const clave = (u.zona_id as string | null) ?? CLAVE_SIN_ZONA;
      porZona.set(clave, [...(porZona.get(clave) ?? []), { cobradorId: id, nombre: (u.nombre as string) ?? "Cobrador" }]);
    }
    for (const z of consolidado.zonas) {
      z.sinActividad = (porZona.get(z.zonaId ?? CLAVE_SIN_ZONA) ?? []).sort((a, b) =>
        a.nombre.localeCompare(b.nombre, "es"),
      );
    }
  } catch {
    /* informativo: si no se puede leer el plantel, el cierre sigue funcionando igual */
  }

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
      // Un cierre con zona_id NULL (la "Caja del día" del bucket sin zona, 0110) se
      // indexa bajo la clave sentinel para adjuntarlo al bucket correspondiente.
      porZona.set((c.zona_id as string | null) ?? CLAVE_SIN_ZONA, {
        supervisorNombre: (c.supervisor_nombre as string | null) ?? null,
        totalEntregado: Number(c.total_entregado),
        creadoEn: c.creado_en as string,
      });
    }
    for (const z of consolidado.zonas) {
      z.confirmado = porZona.get(z.zonaId ?? CLAVE_SIN_ZONA) ?? null;
    }
  } catch (e) {
    if (tablaFaltante(e)) confirmacionesDisponible = false;
    else throw e;
  }

  return { consolidado, disponible: rend.disponible, confirmacionesDisponible };
}
