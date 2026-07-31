import "server-only";
// ─────────────────────────────────────────────────────────────────────────
//  Alerta por EMAIL (canal AUTÓNOMO, independiente del push del teléfono).
//  Usa la API HTTP de Resend con `fetch` (sin dependencia npm nueva, igual que
//  como se llama a DeepSeek). Degrada a NO-OP si faltan las variables (como el
//  push VAPID o Sentry: gated por entorno) y NUNCA lanza: una falla de mail no
//  debe romper el cron de reconciliación de dinero.
//
//  Para encenderlo, en Vercel (Production) + redeploy:
//    RESEND_API_KEY   = re_xxx           (https://resend.com → API Keys)
//    ALERTA_EMAIL_TO  = tu@correo.com    (uno o varios separados por coma)
//    ALERTA_EMAIL_FROM (opcional)        = "Presta Ya <alertas@tudominio>"
//  Sin dominio propio verificado, Resend permite enviar desde onboarding@resend.dev
//  SOLO a la casilla dueña de la cuenta (perfecto para avisarte a vos en el piloto).
// ─────────────────────────────────────────────────────────────────────────

/** ¿Está configurado el canal de email? (para decidir si intentar enviar). */
export function emailConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ALERTA_EMAIL_TO);
}

export interface EmailAlerta {
  asunto: string;
  cuerpo: string;
}

/**
 * Envía un mail de alerta. Devuelve true si Resend lo aceptó. Best-effort:
 * si no está configurado o falla, devuelve false SIN lanzar.
 */
export async function enviarEmailAlerta(m: EmailAlerta): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERTA_EMAIL_TO;
  if (!key || !to) return false;
  const from = process.env.ALERTA_EMAIL_FROM || "Presta Ya <onboarding@resend.dev>";
  const destinatarios = to
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (destinatarios.length === 0) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to: destinatarios, subject: m.asunto, text: m.cuerpo }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
