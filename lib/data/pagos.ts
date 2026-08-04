// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — PAGOS (libro contable inmutable).
//  Lectura: solo pagos NO anulados. Escritura: insertar (nunca update/delete).
//  ⚠️ El dinero llega de PostgREST como string: se convierte a number aquí.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NuevoPago, Pago } from "@/types/db";

/** Convierte una fila cruda en un Pago tipado (parsea numeric → number). */
function mapPago(r: Record<string, unknown>): Pago {
  return {
    id: r.id as string,
    prestamo_id: r.prestamo_id as string,
    dia_credito: Number(r.dia_credito),
    monto: Number(r.monto),
    registrado_por: (r.registrado_por as string | null) ?? null,
    registrado_en: r.registrado_en as string,
    gps_lat: r.gps_lat == null ? null : Number(r.gps_lat),
    gps_lng: r.gps_lng == null ? null : Number(r.gps_lng),
    origen: (r.origen as string | null) ?? null,
    anulado: r.anulado as boolean,
    anulado_por: (r.anulado_por as string | null) ?? null,
    anulado_en: (r.anulado_en as string | null) ?? null,
    motivo_anulacion: (r.motivo_anulacion as string | null) ?? null,
  };
}

/**
 * Lista los pagos VIGENTES (no anulados) de un préstamo, ordenados por día.
 * Esta es la entrada que consume el cálculo del cartón.
 */
export async function getPagosDePrestamo(
  db: SupabaseClient,
  prestamoId: string,
): Promise<Pago[]> {
  const { data, error } = await db
    .from("pagos")
    .select("*")
    .eq("prestamo_id", prestamoId)
    .eq("anulado", false)
    .order("dia_credito", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapPago);
}

/**
 * Pagos vigentes de VARIOS préstamos en UNA sola consulta (evita el N+1 de pedir
 * los pagos crédito por crédito, ej. en la ficha de un cliente con muchas
 * renovaciones). Devuelve un mapa prestamo_id → pagos (ordenados por día).
 */
export async function getPagosDeVariosPrestamos(
  db: SupabaseClient,
  prestamoIds: string[],
): Promise<Record<string, Pago[]>> {
  const porPrestamo: Record<string, Pago[]> = {};
  if (prestamoIds.length === 0) return porPrestamo;
  const { data, error } = await db
    .from("pagos")
    .select("*")
    .in("prestamo_id", prestamoIds)
    .eq("anulado", false)
    .order("dia_credito", { ascending: true });
  if (error) throw error;
  // El orden global por día se preserva dentro de cada grupo (misma semántica que
  // getPagosDePrestamo, que ordena por dia_credito).
  for (const r of data ?? []) {
    const p = mapPago(r);
    (porPrestamo[p.prestamo_id] ??= []).push(p);
  }
  return porPrestamo;
}

/** Marca de "sobre-pago rechazado bajo el candado" (la carrera perdió: otro pago
 *  saldó el crédito primero). Es PERMANENTE (no reintentar): el llamador lo surfacea. */
export function esSobrePago(e: unknown): boolean {
  return (e as { code?: string; sobrepago?: boolean } | null)?.code === "P0409"
    || (e as { sobrepago?: boolean } | null)?.sobrepago === true;
}

/**
 * Registra un pago nuevo. Los pagos NUNCA se editan ni borran: para corregir
 * un error se inserta la anulación (otro paso) sobre el registro existente.
 *
 * Camino ATÓMICO anti-carrera (RPC 0079): serializa por crédito con un advisory
 * lock y re-chequea el sobre-pago con el pagado_acum FRESCO → dos cobros
 * concurrentes al mismo crédito no se pisan. Si la migración 0079 aún no corrió, cae
 * al insert plano (conducta previa, sin regresión). Un sobre-pago bajo el candado
 * (P0409) se propaga como error PERMANENTE (esSobrePago); un op_id repetido (23505)
 * se propaga igual que antes (el llamador lo trata como éxito idempotente).
 */
export async function registrarPago(
  db: SupabaseClient,
  pago: NuevoPago,
): Promise<Pago> {
  const rpc = await db.rpc("registrar_pago_seguro", {
    p_prestamo_id: pago.prestamo_id,
    p_dia_credito: pago.dia_credito,
    // CHOKEPOINT money-critical: entero (el RPC vuelve a redondear). Nunca float al libro.
    p_monto: Math.round(pago.monto),
    p_registrado_por: pago.registrado_por ?? null,
    p_gps_lat: pago.gps_lat ?? null,
    p_gps_lng: pago.gps_lng ?? null,
    p_registrado_en: pago.registrado_en ?? null,
    p_op_id: pago.op_id ?? null,
  });
  if (!rpc.error) return mapPago(rpc.data as Record<string, unknown>);

  const code = (rpc.error as { code?: string }).code;
  // RPC ausente (0079 sin correr) → fallback al insert plano (sin regresión).
  if (code === "42883" || code === "PGRST202") return insertarPagoPlano(db, pago);
  // Sobre-pago detectado bajo el candado → error permanente (que el llamador surfacee).
  if (code === "P0409") throw Object.assign(new Error("SOBREPAGO"), { code: "P0409", sobrepago: true });
  // 23505 (op_id repetido) y cualquier otro error real → propagar tal cual.
  throw rpc.error;
}

/** Insert directo (camino previo / fallback si el RPC 0079 no está). */
async function insertarPagoPlano(db: SupabaseClient, pago: NuevoPago): Promise<Pago> {
  const { data, error } = await db
    .from("pagos")
    .insert({
      prestamo_id: pago.prestamo_id,
      dia_credito: pago.dia_credito,
      // CHOKEPOINT money-critical: el libro es ENTERO. Aunque la cuota_diaria del
      // import de Disapp fuera fraccionaria (numeric(12,2)), acá se redondea para
      // que NUNCA entre un float al libro inmutable, venga del cobrador o del panel.
      monto: Math.round(pago.monto),
      registrado_por: pago.registrado_por ?? null,
      gps_lat: pago.gps_lat ?? null,
      gps_lng: pago.gps_lng ?? null,
      ...(pago.registrado_en ? { registrado_en: pago.registrado_en } : {}),
      ...(pago.op_id ? { op_id: pago.op_id } : {}),
    })
    .select()
    .single();

  if (error) throw error;
  return mapPago(data);
}
