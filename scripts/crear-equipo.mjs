// ─────────────────────────────────────────────────────────────────────────
//  Crea/configura el equipo real: Mauricio (admin), Carolina (supervisor),
//  Carlos (desarrollador = admin + es_dev). Idempotente: si el login ya existe
//  lo reusa y le resetea la contraseña. Imprime las credenciales al final.
//    node --env-file=.env.local scripts/crear-equipo.mjs
//  El flag es_dev necesita la migración 0034 corrida (si no, avisa).
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function pass() {
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint32Array(10);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((n) => abc[n % abc.length]).join("");
}

const EQUIPO = [
  { nombre: "Mauricio", email: "admin@prestaya.uy", rol: "admin", dev: false },
  { nombre: "Carolina", email: "carolina@prestaya.uy", rol: "supervisor", dev: false },
  { nombre: "Carlos", email: "carlos@prestaya.uy", rol: "admin", dev: true },
];

async function buscarAuth(email) {
  // Pagina hasta encontrarlo (suficiente para este volumen).
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  return (data?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
}

const salida = [];
let faltaDev = false;

for (const p of EQUIPO) {
  const password = pass();
  let authId;

  const existente = await buscarAuth(p.email);
  if (existente) {
    authId = existente.id;
    await db.auth.admin.updateUserById(authId, { password, email_confirm: true });
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email: p.email,
      password,
      email_confirm: true,
    });
    if (error || !data?.user) {
      console.error(`✗ ${p.email}: ${error?.message}`);
      continue;
    }
    authId = data.user.id;
  }

  // Fila en usuarios (por auth_user_id). Update si existe, insert si no.
  const { data: fila } = await db.from("usuarios").select("id").eq("auth_user_id", authId).maybeSingle();
  if (fila) {
    await db.from("usuarios").update({ nombre: p.nombre, rol: p.rol, activo: true }).eq("id", fila.id);
  } else {
    const { error } = await db
      .from("usuarios")
      .insert({ nombre: p.nombre, rol: p.rol, activo: true, auth_user_id: authId });
    if (error) {
      console.error(`✗ usuarios ${p.email}: ${error.message}`);
      continue;
    }
  }

  // Flag de desarrollador (necesita 0034).
  if (p.dev) {
    const { error } = await db.from("usuarios").update({ es_dev: true }).eq("auth_user_id", authId);
    if (error && /es_dev/.test(error.message)) faltaDev = true;
  }

  salida.push({ nombre: p.nombre, email: p.email, password, rol: p.dev ? "desarrollador" : p.rol });
}

console.log("\n===== CREDENCIALES (temporales — cambialas al entrar) =====");
for (const s of salida) console.log(`${s.rol.padEnd(13)} ${s.email.padEnd(24)} ${s.password}   (${s.nombre})`);
if (faltaDev)
  console.log(
    "\n⚠️  El flag desarrollador NO se aplicó: corré la migración 0034 y volvé a ejecutar este script.",
  );
console.log("");
