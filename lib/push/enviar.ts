import "server-only";
// ─────────────────────────────────────────────────────────────────────────
//  Envío de Web Push (VAPID). Solo servidor. Degrada a no-op si faltan las
//  claves VAPID en el entorno (así el resto de la app no se rompe).
//  Claves: generalas con `node scripts/gen-vapid.mjs` y ponelas en el entorno:
//    NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// ─────────────────────────────────────────────────────────────────────────
import webpush from "web-push";

let listo = false;

function configurar(): boolean {
  if (listo) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@prestaya.uy";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  listo = true;
  return true;
}

/** ¿Están las claves VAPID? (para no ofrecer "activar avisos" si no). */
export function pushConfigurado(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface PushPayload {
  titulo: string;
  cuerpo: string;
  url?: string;
  tag?: string;
}

/** Envía a UNA suscripción. 'gone' = caducada (borrarla); 'error' = otra falla. */
export async function enviarPush(
  sub: PushSub,
  payload: PushPayload,
): Promise<"ok" | "gone" | "error"> {
  if (!configurar()) return "error";
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    return "ok";
  } catch (e) {
    const code = (e as { statusCode?: number })?.statusCode;
    return code === 404 || code === 410 ? "gone" : "error";
  }
}
