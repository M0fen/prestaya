// Reintento pausado de los 7 logins que el rate-limit dejó sin verificar en el barrido.
import { createClient } from "@supabase/supabase-js";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASS = "PrestaYa2026!";
const EMAILS = [
  "lorena.torres@prestaya.uy", "luz.angela.idrobo@prestaya.uy", "marcela.londono@prestaya.uy",
  "maria@prestaya.uy", "mauricio.torres@prestaya.uy", "pilar.bedoya@prestaya.uy", "yiset.betancurt@prestaya.uy",
];
for (const email of EMAILS) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASS });
  if (!error) await c.auth.signOut();
  const cred = error && /invalid login credentials/i.test(error.message);
  console.log(`${email.padEnd(36)} ${!error ? "clave de arranque ✓" : cred ? "clave propia ✓" : "✗ " + error.message}`);
  await new Promise((r) => setTimeout(r, 2500));
}
