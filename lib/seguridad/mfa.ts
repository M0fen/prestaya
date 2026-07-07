// ─────────────────────────────────────────────────────────────────────────
//  2FA (MFA TOTP de Supabase) — helper de estado del SERVIDOR.
//  Diseño anti-lockout: la exigencia es "sticky" (solo afecta a quien YA activó
//  2FA); quien no lo activó entra normal. Ante cualquier fallo del subsistema
//  MFA, FALLA ABIERTO (no bloquea): nunca dejar a nadie afuera por un bug acá.
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface EstadoMfa {
  /** El usuario tiene al menos un factor TOTP verificado. */
  tieneFactor: boolean;
  /** Tiene 2FA activo pero la sesión sigue en aal1: falta ingresar el código. */
  stepUpPendiente: boolean;
}

/** Lee el nivel de aseguramiento (AAL) de la sesión actual. Fail-open. */
export async function estadoMfa(db: SupabaseClient): Promise<EstadoMfa> {
  try {
    const { data, error } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return { tieneFactor: false, stepUpPendiente: false };
    // nextLevel === 'aal2' ⇒ hay un factor verificado.
    const tieneFactor = data.nextLevel === "aal2";
    const stepUpPendiente = data.currentLevel === "aal1" && data.nextLevel === "aal2";
    return { tieneFactor, stepUpPendiente };
  } catch {
    return { tieneFactor: false, stepUpPendiente: false };
  }
}
