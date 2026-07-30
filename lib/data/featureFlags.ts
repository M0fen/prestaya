// ─────────────────────────────────────────────────────────────────────────
//  FEATURE FLAGS (0072) — lectura del KILL SWITCH "modo solo lectura".
//  Se consulta antes de cada ESCRITURA DE PLATA. Cacheado por request (React
//  cache) para no leerlo N veces. FAIL-OPEN a propósito: si el flag no se puede
//  leer (0072 sin correr, o error transitorio), NO se bloquea — no queremos
//  frenar la operación por un glitch; el kill switch es una acción deliberada.
//  PERO: durante un incidente real (DB inestable) es JUSTO cuando el freeze más
//  importa y cuando el blip es más probable → antes de caer a fail-open hacemos
//  un reintento corto, para que un glitch aislado no reabra un freeze encendido.
// ─────────────────────────────────────────────────────────────────────────
import { cache } from "react";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Una sola lectura del flag. Lanza si falla (para que el retry la reintente). */
async function leerFlagCongelado(): Promise<boolean> {
  const db = createSupabaseAdmin();
  const { data, error } = await db
    .from("feature_flags")
    .select("activo")
    .eq("clave", "modo_solo_lectura")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.activo);
}

/** ¿Está congelada la escritura de dinero? (kill switch encendido). */
export const escrituraCongelada = cache(async (): Promise<boolean> => {
  // 2 intentos con backoff corto: un blip transitorio no debe reabrir el freeze.
  const INTENTOS = 2;
  for (let i = 0; i < INTENTOS; i++) {
    try {
      return await leerFlagCongelado();
    } catch {
      if (i < INTENTOS - 1) await sleep(150);
    }
  }
  return false; // fail-open SOLO tras agotar los reintentos
});

/**
 * Guarda para las acciones de PLATA: si el sistema está en modo solo lectura,
 * devuelve el resultado de rechazo (mensaje claro) para hacer `return` directo;
 * si no, devuelve null y la acción sigue. Llamar al INICIO de la acción.
 */
export async function bloqueoSoloLectura(): Promise<
  { ok: false; error: string; retryable: true; sistemico: true } | null
> {
  if (await escrituraCongelada()) {
    return {
      ok: false,
      error: "El sistema está en modo solo lectura por mantenimiento. Probá de nuevo en unos minutos.",
      // TEMPORAL: el freeze se levanta. La cola offline del cobrador NO debe envenenar
      // (marcar "atascado" → descartá) un cobro real por esto — hay que reintentar luego.
      retryable: true,
      // SISTÉMICO e inequívoco (afecta a TODAS las ops por igual): la cola corta el
      // batch y reintenta todo más tarde, sin acumular intentos hacia "atascada".
      sistemico: true,
    };
  }
  return null;
}
