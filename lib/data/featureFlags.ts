// ─────────────────────────────────────────────────────────────────────────
//  FEATURE FLAGS (0072) — lectura del KILL SWITCH "modo solo lectura".
//  Se consulta antes de cada ESCRITURA DE PLATA. Cacheado por request (React
//  cache) para no leerlo N veces. FAIL-OPEN a propósito: si el flag no se puede
//  leer (0072 sin correr, o error transitorio), NO se bloquea — no queremos
//  frenar la operación por un glitch; el kill switch es una acción deliberada y
//  cuando está prendido el flag existe y se lee bien.
// ─────────────────────────────────────────────────────────────────────────
import { cache } from "react";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/** ¿Está congelada la escritura de dinero? (kill switch encendido). */
export const escrituraCongelada = cache(async (): Promise<boolean> => {
  try {
    const db = createSupabaseAdmin();
    const { data, error } = await db
      .from("feature_flags")
      .select("activo")
      .eq("clave", "modo_solo_lectura")
      .maybeSingle();
    if (error) throw error;
    return Boolean(data?.activo);
  } catch {
    return false; // fail-open: ante cualquier duda, dejar operar
  }
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
