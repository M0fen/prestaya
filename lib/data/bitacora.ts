// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — BITÁCORA DE CAMPO. Registro best-effort (NUNCA rompe la
//  acción principal, igual que la auditoría) + lectura para el panel de control
//  de cobradores. El score de sospecha lo calcula el núcleo puro lib/sospecha.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "@/lib/data/errores";
import { analizarSospecha, type EventoBitacora, type SenalesSospecha } from "@/lib/sospecha";
import { alcanceDelActor } from "./alcance";
import { traerTodo } from "./paginado";

export interface EntradaBitacora {
  actorId: string;
  actorNombre: string;
  rol: string;
  accion: string;
  clienteId?: string | null;
  prestamoId?: string | null;
  monto?: number | null;
  detalle?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  gpsPrecision?: number | null;
  gpsDenegado?: boolean;
  enZona?: boolean | null;
  deviceTs?: string | null;
}

/** Registra una acción en la bitácora. BEST-EFFORT: si falla (o no existe la
 *  tabla), traga el error y sigue — jamás rompe el cobro/gasto/etc. */
export async function registrarBitacora(
  db: SupabaseClient,
  e: EntradaBitacora,
): Promise<void> {
  try {
    await db.from("bitacora").insert({
      actor_id: e.actorId,
      actor_nombre: e.actorNombre,
      rol: e.rol,
      accion: e.accion,
      cliente_id: e.clienteId ?? null,
      prestamo_id: e.prestamoId ?? null,
      monto: e.monto ?? null,
      detalle: e.detalle ?? null,
      gps_lat: e.gpsLat ?? null,
      gps_lng: e.gpsLng ?? null,
      gps_precision: e.gpsPrecision ?? null,
      gps_denegado: e.gpsDenegado ?? false,
      en_zona: e.enZona ?? null,
      device_ts: e.deviceTs ?? null,
    });
  } catch {
    /* best-effort: nunca interrumpe la acción principal */
  }
}

/** Un evento de la bitácora leído para el panel (incluye actor + GPS). */
export interface BitacoraFila extends EventoBitacora {
  id: string;
  actorId: string;
  actorNombre: string;
  monto: number | null;
  detalle: string | null;
  clienteNombre: string | null;
}

/** Resumen por cobrador de un día: sus eventos + las señales de sospecha. */
export interface ResumenCobradorDia {
  actorId: string;
  actorNombre: string;
  eventos: BitacoraFila[];
  senales: SenalesSospecha;
}

/** Trae la bitácora de un día (fecha UY "YYYY-MM-DD"), agrupada por cobrador
 *  con su score de sospecha. Ordenada por score desc (lo más sospechoso arriba). */
export async function getResumenBitacoraDia(
  db: SupabaseClient,
  fechaUY: string,
): Promise<ResumenCobradorDia[]> {
  try {
    // El supervisor ve SOLO la bitácora de sus cobradores; el admin, todos.
    const alcance = await alcanceDelActor();
    if (!alcance.global && alcance.cobradorIds.length === 0) return [];
    // PAGINA por `id` (no por server_ts): un día con 52 cobradores supera las 1000
    // filas de PostgREST y truncaba la TARDE en silencio → cobradores desaparecían
    // del panel y el score de sospecha salía MAL (subestimado). Cada actor se
    // reordena por serverTs abajo para el display cronológico (analizarSospecha
    // re-ordena internamente, así que el score no depende del orden de entrada).
    const filas = await traerTodo<Record<string, unknown>>((desde, hasta) => {
      let q = db.from("bitacora").select("*").eq("fecha_uy", fechaUY);
      if (!alcance.global) q = q.in("actor_id", alcance.cobradorIds);
      return q.order("id", { ascending: true }).range(desde, hasta);
    });

    // Nombres de clientes (para mostrar a quién).
    const cliIds = [...new Set(filas.map((r) => r.cliente_id).filter((x): x is string => !!x))];
    const nombres = new Map<string, string>();
    if (cliIds.length > 0) {
      const { data: cs } = await db.from("clientes").select("id, nombre").in("id", cliIds);
      for (const c of cs ?? []) nombres.set(c.id as string, c.nombre as string);
    }

    // Agrupar por actor.
    const porActor = new Map<string, BitacoraFila[]>();
    for (const r of filas) {
      const fila: BitacoraFila = {
        id: r.id as string,
        actorId: (r.actor_id as string) ?? "—",
        actorNombre: (r.actor_nombre as string) ?? "—",
        accion: r.accion as string,
        serverTs: r.server_ts as string,
        gpsLat: r.gps_lat == null ? null : Number(r.gps_lat),
        gpsLng: r.gps_lng == null ? null : Number(r.gps_lng),
        gpsDenegado: Boolean(r.gps_denegado),
        enZona: r.en_zona == null ? null : Boolean(r.en_zona),
        clienteId: (r.cliente_id as string | null) ?? null,
        clienteNombre: r.cliente_id ? (nombres.get(r.cliente_id as string) ?? null) : null,
        monto: r.monto == null ? null : Number(r.monto),
        detalle: (r.detalle as string | null) ?? null,
      };
      const arr = porActor.get(fila.actorId) ?? [];
      arr.push(fila);
      porActor.set(fila.actorId, arr);
    }
    // Display cronológico por cobrador (traemos paginado por id, no por hora).
    for (const arr of porActor.values()) arr.sort((a, b) => a.serverTs.localeCompare(b.serverTs));

    const resumen: ResumenCobradorDia[] = [...porActor.entries()].map(([actorId, eventos]) => ({
      actorId,
      actorNombre: eventos[0]?.actorNombre ?? "—",
      eventos,
      senales: analizarSospecha(eventos),
    }));
    // Más sospechoso arriba.
    resumen.sort((a, b) => b.senales.score - a.senales.score);
    return resumen;
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}
