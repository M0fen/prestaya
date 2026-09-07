// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — AUDITORÍA (log inmutable, tabla `auditoria`, 0015).
//  `registrarAuditoria` es BEST-EFFORT: nunca tira ni rompe la acción que la
//  invoca (si falla o falta la tabla, se ignora en silencio). `getAuditoria`
//  degrada a vacío si 0015 aún no corrió.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { inicioDiaUYIso } from "@/lib/fecha";
import { tablaFaltante } from "./errores";

/**
 * La acción con la que queda registrado un crédito que un COBRADOR colocó por
 * encima de su umbral (+20% del anterior) sin aprobación previa (regla de
 * Carlos, 06-09: "automático, solo aviso"). Es UNA cadena compartida entre la
 * puerta que la escribe (lib/acciones/cobradorCredito.ts) y el lector que la
 * muestra en el panel (lib/data/misPedidos.ts): si se escribe distinto en un
 * lado, el panel deja de verlo y el aviso muere en silencio.
 */
export const ACCION_SOBRE_TECHO = "Colocó por encima del +20% desde la calle (sin aprobación, avisado)";

export interface EntradaAuditoria {
  actorId: string;
  actorNombre: string;
  accion: string;
  entidad?: string | null;
  entidadId?: string | null;
  detalle?: string | null;
}

/** Registra una acción en el log. Best-effort: si falla, no interrumpe nada. */
export async function registrarAuditoria(
  db: SupabaseClient,
  e: EntradaAuditoria,
): Promise<void> {
  try {
    await db.from("auditoria").insert({
      actor_id: e.actorId,
      actor_nombre: e.actorNombre,
      accion: e.accion,
      entidad: e.entidad ?? null,
      entidad_id: e.entidadId ?? null,
      detalle: e.detalle ?? null,
    });
  } catch {
    /* la auditoría nunca debe romper la operación principal */
  }
}

export interface RegistroAuditoria {
  id: string;
  actorNombre: string;
  accion: string;
  entidad: string | null;
  entidadId: string | null;
  detalle: string | null;
  creadoEn: string;
}

const mapRegistro = (r: Record<string, unknown>): RegistroAuditoria => ({
  id: r.id as string,
  actorNombre: (r.actor_nombre as string | null) ?? "—",
  accion: r.accion as string,
  entidad: (r.entidad as string | null) ?? null,
  entidadId: (r.entidad_id as string | null) ?? null,
  detalle: (r.detalle as string | null) ?? null,
  creadoEn: r.creado_en as string,
});

/** Últimos registros de auditoría (para el panel). Degrada a [] si falta 0015. */
export async function getAuditoria(
  db: SupabaseClient,
  limite = 120,
): Promise<RegistroAuditoria[]> {
  try {
    const { data, error } = await db
      .from("auditoria")
      .select("*")
      .order("creado_en", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []).map(mapRegistro);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Acciones que ESTE gestor registró HOY — la "bitácora del día" de Mi jornada.
 *  Descarga la memoria de trabajo: le deja ver de un vistazo lo que ya hizo (avisó,
 *  registró un compromiso, aprobó un gasto, cerró una zona) para retomar tras una
 *  interrupción. Degrada a [] si falta 0015. */
export async function getBitacoraGestorDia(
  db: SupabaseClient,
  actorId: string,
  hoy: Date = new Date(),
  limite = 25,
): Promise<RegistroAuditoria[]> {
  try {
    const { data, error } = await db
      .from("auditoria")
      .select("*")
      .eq("actor_id", actorId)
      .gte("creado_en", inicioDiaUYIso(hoy))
      .order("creado_en", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []).map(mapRegistro);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}
