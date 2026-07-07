// Genera las claves VAPID (para Web Push) + un secreto de cron.
// Ejecutar:  node scripts/gen-vapid.mjs
// Después, pegá estas líneas en .env.local y en Vercel (Settings → Env Vars),
// para Preview y Production. Redeploy y listo.
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
const cronSecret = [...crypto.getRandomValues(new Uint8Array(24))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

console.log("# ── Claves VAPID + secreto de cron para Presta Ya ──");
console.log("NEXT_PUBLIC_VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);
console.log("VAPID_SUBJECT=mailto:admin@prestaya.uy");
console.log("CRON_SECRET=" + cronSecret);
