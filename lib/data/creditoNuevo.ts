// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ALTA de un crédito NUEVO para un cliente SIN crédito activo.
//
//  Orden de escritura DELIBERADO (ruta primero, crédito después):
//    1) se asegura la ASIGNACIÓN activa cliente↔cobrador,
//    2) recién ahí se inserta el CRÉDITO.
//  Si se cortara entre medio, el peor caso es un cliente en la ruta sin crédito
//  (inofensivo: no aparece a cobrar). Al revés dejaría un CRÉDITO SIN RUTA —
//  plata en la calle que ningún cobrador ve, que es exactamente el "cliente
//  fantasma" que hubo que reparar a mano (46 créditos / $634.666, auditoría 08-02).
//
//  Idempotencia: `prestamos.op_id` tiene índice único parcial (0101). El reintento
//  del mismo alta colisiona con 23505 y se resuelve devolviendo el crédito ya
//  creado, en vez de colocar el capital DOS veces.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FrecuenciaPrestamo } from "@/types/db";
import { esViolacionUnica } from "@/lib/idempotencia";

/** Términos del último crédito del cliente: de ahí sale la TASA del nuevo. */
export interface BaseCreditoNuevo {
  prestamoId: string;
  monto: number;
  cuota: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
  /** Cobrador del último crédito (sugerencia de ruta). */
  cobradorId: string | null;
  fechaInicio: string;
  estado: string;
}

/**
 * Último crédito del cliente (cualquier estado), el más nuevo por fecha de inicio.
 * Es la base para arrastrar la tasa y sugerir el cobrador. `null` = primer crédito.
 */
export async function getUltimoCreditoDe(
  db: SupabaseClient,
  clienteId: string,
): Promise<BaseCreditoNuevo | null> {
  const { data, error } = await db
    .from("prestamos")
    .select("id, monto_prestado, cuota_diaria, total_dias, frecuencia, cobrador_id, fecha_inicio, estado")
    // Desempate por `creado_en`: varios créditos pueden compartir fecha_inicio
    // (el empalme cargó lotes con la misma fecha) y sin esto el "último" sería
    // arbitrario → la tasa arrastrada podría salir de un crédito equivocado.
    .eq("cliente_id", clienteId)
    .order("fecha_inicio", { ascending: false })
    .order("creado_en", { ascending: false })
    .limit(1);
  if (error) throw error;
  const r = data?.[0];
  if (!r) return null;
  return {
    prestamoId: r.id as string,
    monto: Math.round(Number(r.monto_prestado) || 0),
    cuota: Math.round(Number(r.cuota_diaria) || 0),
    totalDias: Number(r.total_dias) || 0,
    frecuencia: (r.frecuencia as FrecuenciaPrestamo) ?? "diario",
    cobradorId: (r.cobrador_id as string | null) ?? null,
    fechaInicio: r.fecha_inicio as string,
    estado: (r.estado as string) ?? "?",
  };
}

/** ¿El cliente tiene algún crédito ACTIVO ahora mismo? (para el gate del alta). */
export async function contarCreditosActivos(
  db: SupabaseClient,
  clienteId: string,
): Promise<number> {
  const { count, error } = await db
    .from("prestamos")
    .select("id", { count: "exact", head: true })
    .eq("cliente_id", clienteId)
    .eq("estado", "activo");
  if (error) throw error;
  return count ?? 0;
}

export interface AltaCreditoNuevo {
  clienteId: string;
  cobradorId: string;
  /** Capital entregado (UYU, entero). */
  monto: number;
  /** Cuota ya calculada por el servidor (UYU, entera). */
  cuota: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
  /** "YYYY-MM-DD" del día UY. */
  fechaInicio: string;
  /** Interés total (%) informativo que queda guardado en el crédito. */
  interesPct: number | null;
  /** usuarios.id del gestor que da el alta (auditoría). */
  creadoPor: string | null;
  /** Clave de idempotencia (uuid). */
  opId: string;
}

export type ResultadoAltaNueva =
  | { ok: true; prestamoId: string; repetido: boolean }
  | { ok: false; error: string };

/**
 * Da de alta el crédito nuevo. Ver el encabezado para el orden de escritura.
 * NO finaliza nada (no hay crédito anterior activo que cerrar): solo coloca.
 */
export async function crearCreditoNuevoDb(
  db: SupabaseClient,
  input: AltaCreditoNuevo,
): Promise<ResultadoAltaNueva> {
  // 1) RUTA primero. `upsert` porque puede existir una asignación vieja inactiva
  //    (el cliente ya estuvo en esa ruta antes de terminar su crédito anterior).
  const asig = await db
    .from("asignaciones")
    .upsert(
      { cliente_id: input.clienteId, cobrador_id: input.cobradorId, activo: true },
      { onConflict: "cobrador_id,cliente_id" },
    );
  if (asig.error) {
    return { ok: false, error: "No se pudo poner al cliente en la ruta del cobrador." };
  }

  // 2) CRÉDITO. Con op_id → el reintento por ACK perdido no duplica el capital.
  const alta = await db
    .from("prestamos")
    .insert({
      cliente_id: input.clienteId,
      cobrador_id: input.cobradorId,
      monto_prestado: input.monto,
      cuota_diaria: input.cuota,
      total_dias: input.totalDias,
      frecuencia: input.frecuencia,
      fecha_inicio: input.fechaInicio,
      estado: "activo",
      origen: "credito",
      interes_pct: input.interesPct,
      creado_por: input.creadoPor,
      op_id: input.opId,
    })
    .select("id")
    .single();

  if (!alta.error && alta.data) {
    return { ok: true, prestamoId: alta.data.id as string, repetido: false };
  }

  // Colisión de op_id = este MISMO alta ya se había commiteado (doble submit o
  // reintento tras un 504). No es un error: se devuelve el crédito existente.
  if (esViolacionUnica(alta.error)) {
    const ya = await db.from("prestamos").select("id").eq("op_id", input.opId).limit(1);
    const id = ya.data?.[0]?.id as string | undefined;
    if (id) return { ok: true, prestamoId: id, repetido: true };
  }

  // Falló de verdad... o commiteó y se perdió la respuesta. Verificar por op_id
  // ANTES de reportar el fallo (si existe, el capital ya salió: decirlo bien).
  const chequeo = await db.from("prestamos").select("id").eq("op_id", input.opId).limit(1);
  const idExistente = chequeo.data?.[0]?.id as string | undefined;
  if (idExistente) return { ok: true, prestamoId: idExistente, repetido: true };

  return { ok: false, error: "No se pudo crear el crédito. Probá de nuevo." };
}
