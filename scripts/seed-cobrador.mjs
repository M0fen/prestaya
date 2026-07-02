// ─────────────────────────────────────────────────────────────────────────
//  Crea (o actualiza) un COBRADOR de prueba: login en Supabase Auth + fila en
//  `usuarios` (rol cobrador) + asignación al cliente demo (María Fernanda) +
//  GPS en el cliente para poder probar la geo-cerca. Idempotente.
//    node --env-file=.env.local scripts/seed-cobrador.mjs
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("✗ Faltan variables en .env.local");
  process.exit(1);
}

const EMAIL = process.env.SEED_COBRADOR_EMAIL || "cobrador@prestaya.uy";
const PASSWORD = process.env.SEED_COBRADOR_PASSWORD || "PrestaYa2026!";
const NOMBRE = process.env.SEED_COBRADOR_NOMBRE || "Diego (Cobrador)";
const CLIENTE_DEMO = "00000000-0000-0000-0000-000000000001"; // María Fernanda (seed-demo)
const GPS = { lat: -34.8885, lng: -56.1567 };

const db = createClient(url, key, { auth: { persistSession: false } });

async function buscarAuthPorEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    if (u) return u;
    if (data.users.length < 200) break;
  }
  return null;
}

// 1) Usuario de Auth.
let authUser = await buscarAuthPorEmail(EMAIL);
if (authUser) {
  await db.auth.admin.updateUserById(authUser.id, { password: PASSWORD, email_confirm: true });
  console.log(`· auth existente: ${EMAIL} (contraseña actualizada)`);
} else {
  const { data, error } = await db.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) {
    console.error(`✗ crear auth: ${error.message}`);
    process.exit(1);
  }
  authUser = data.user;
  console.log(`✓ usuario de Auth creado: ${EMAIL}`);
}

// 2) Fila en usuarios (rol cobrador).
const { data: existente } = await db
  .from("usuarios")
  .select("id")
  .eq("auth_user_id", authUser.id)
  .maybeSingle();

let cobradorId;
if (existente) {
  cobradorId = existente.id;
  await db.from("usuarios").update({ nombre: NOMBRE, rol: "cobrador", activo: true }).eq("id", cobradorId);
  console.log("· fila en usuarios actualizada (rol cobrador)");
} else {
  const { data, error } = await db
    .from("usuarios")
    .insert({ nombre: NOMBRE, rol: "cobrador", activo: true, auth_user_id: authUser.id })
    .select("id")
    .single();
  if (error) {
    console.error(`✗ insertar usuarios: ${error.message}`);
    process.exit(1);
  }
  cobradorId = data.id;
  console.log("✓ fila en usuarios creada (rol cobrador)");
}

// 3) Asignación al cliente demo (desactiva otras asignaciones activas de ese cliente).
const cli = await db.from("clientes").select("id").eq("id", CLIENTE_DEMO).maybeSingle();
if (cli.data) {
  await db.from("asignaciones").update({ activo: false }).eq("cliente_id", CLIENTE_DEMO).eq("activo", true);
  const { error: errAsig } = await db
    .from("asignaciones")
    .upsert(
      { cobrador_id: cobradorId, cliente_id: CLIENTE_DEMO, activo: true },
      { onConflict: "cobrador_id,cliente_id" },
    );
  if (errAsig) console.log(`· (asignación) ${errAsig.message}`);
  else console.log("✓ cliente demo asignado al cobrador");

  // 4) GPS en el cliente demo (para geo-cerca).
  const upd = await db.from("clientes").update({ gps_lat: GPS.lat, gps_lng: GPS.lng }).eq("id", CLIENTE_DEMO);
  if (upd.error) console.log(`· (gps) ${upd.error.message} — ¿corriste la migración 0005?`);
  else console.log("✓ GPS del cliente demo cargado");
} else {
  console.log("· (aviso) no existe el cliente demo; corré scripts/seed-demo.mjs primero");
}

console.log("\nCobrador listo ✅");
console.log(`   Login:      /ingresar`);
console.log(`   Correo:     ${EMAIL}`);
console.log(`   Contraseña: ${PASSWORD}`);
