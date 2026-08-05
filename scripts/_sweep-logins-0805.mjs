// 08-05: barrido de TODOS los usuarios activos — ¿responde el login de cada uno?
// Clasifica: clave de arranque ✓ · clave propia ✓ · SIN LOGIN ✗ · BANEADO ✗ · otro error.
// Con --fix: desbanea y crea la cuenta Auth de quien no tenga (email por slug del nombre).
// node --env-file=.env.local scripts/_sweep-logins-0805.mjs [--fix]
import { createClient } from "@supabase/supabase-js";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PASS = "PrestaYa2026!";
const FIX = process.argv.includes("--fix");

const { data: us } = await db.from("usuarios").select("id, nombre, rol, zona_id, auth_user_id, activo").eq("activo", true);
const { data: zonas } = await db.from("zonas").select("id, nombre");
const zonaDe = new Map((zonas ?? []).map((z) => [z.id, z.nombre]));

const authPorId = new Map();
for (let p = 1; p <= 15; p++) {
  const { data } = await db.auth.admin.listUsers({ page: p, perPage: 200 });
  for (const u of data.users) authPorId.set(u.id, u);
  if (data.users.length < 200) break;
}

const slug = (n) =>
  n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/,.*$/, "").trim().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, ".");

const resultados = [];
for (const u of (us ?? []).sort((a, b) => a.nombre.localeCompare(b.nombre))) {
  const a = u.auth_user_id ? authPorId.get(u.auth_user_id) : null;
  let email = a?.email ?? null;
  let estado = "";

  if (!a) {
    if (FIX) {
      email = `${slug(u.nombre)}@prestaya.uy`;
      const { data: creado, error } = await db.auth.admin.createUser({ email, password: PASS, email_confirm: true });
      if (error) estado = `✗ sin login, no pude crear: ${error.message}`;
      else {
        await db.from("usuarios").update({ auth_user_id: creado.user.id }).eq("id", u.id);
        estado = "✦ LOGIN CREADO (clave de arranque)";
      }
    } else estado = "✗ SIN LOGIN";
    resultados.push({ u, email, estado });
    continue;
  }

  const baneado = a.banned_until && new Date(a.banned_until) > new Date();
  if (baneado) {
    if (FIX) {
      const { error } = await db.auth.admin.updateUserById(a.id, { ban_duration: "none" });
      estado = error ? `✗ baneado, no pude desbanear: ${error.message}` : "✦ DESBANEADO";
    } else {
      resultados.push({ u, email, estado: `✗ BANEADO hasta ${a.banned_until}` });
      continue;
    }
  }

  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASS });
  if (!error) await c.auth.signOut();
  await new Promise((r) => setTimeout(r, 250));
  const cred = error && /invalid login credentials/i.test(error.message);
  const login = !error ? "clave de arranque ✓" : cred ? "clave propia ✓" : `✗ ${error.message}`;
  resultados.push({ u, email, estado: estado ? `${estado} · ${login}` : login });
}

let problemas = 0;
for (const { u, email, estado } of resultados) {
  if (estado.includes("✗") || estado.includes("✦")) problemas++;
  console.log(`${u.nombre.padEnd(28)} ${u.rol.padEnd(10)} ${(zonaDe.get(u.zona_id) ?? "—").padEnd(12)} ${(email ?? "(sin email)").padEnd(38)} ${estado}`);
}
console.log(`\n${resultados.length} usuarios activos · ${problemas === 0 ? "TODOS RESPONDEN ✓" : problemas + " con novedades (✗ roto / ✦ arreglado)"}`);
