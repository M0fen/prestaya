// ─────────────────────────────────────────────────────────────────────────
//  Crea (o actualiza) el usuario ADMIN del panel: login en Supabase Auth +
//  fila en `usuarios` (rol admin) vinculada por auth_user_id.
//  Idempotente. Ejecutar:
//    node --env-file=.env.local scripts/seed-admin.mjs
//  Opcional (cambiar credenciales):
//    SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... SEED_ADMIN_NOMBRE=... node ...
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("✗ Faltan variables en .env.local");
  process.exit(1);
}

const EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@prestaya.uy";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || "PrestaYa2026!";
const NOMBRE = process.env.SEED_ADMIN_NOMBRE || "Mauricio (Admin)";

const db = createClient(url, key, { auth: { persistSession: false } });

/** Busca un usuario de Auth por email (paginando), o null. */
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

// 1) Crear o recuperar el usuario de Auth.
let authUser = await buscarAuthPorEmail(EMAIL);
if (authUser) {
  // Asegura la contraseña conocida (por si se reejecuta para resetearla).
  const { error } = await db.auth.admin.updateUserById(authUser.id, {
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) {
    console.error(`✗ actualizar auth: ${error.message}`);
    process.exit(1);
  }
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

// 2) Vincular/crear la fila en `usuarios` (rol admin).
const { data: existente, error: errSel } = await db
  .from("usuarios")
  .select("id")
  .eq("auth_user_id", authUser.id)
  .maybeSingle();
if (errSel) {
  console.error(`✗ leer usuarios: ${errSel.message}`);
  process.exit(1);
}

if (existente) {
  const { error } = await db
    .from("usuarios")
    .update({ nombre: NOMBRE, rol: "admin", activo: true })
    .eq("id", existente.id);
  if (error) {
    console.error(`✗ actualizar usuarios: ${error.message}`);
    process.exit(1);
  }
  console.log("· fila en usuarios actualizada (rol admin)");
} else {
  const { error } = await db.from("usuarios").insert({
    nombre: NOMBRE,
    rol: "admin",
    activo: true,
    auth_user_id: authUser.id,
  });
  if (error) {
    console.error(`✗ insertar usuarios: ${error.message}`);
    process.exit(1);
  }
  console.log("✓ fila en usuarios creada (rol admin)");
}

console.log("\nAdmin listo ✅");
console.log(`   Login:      /admin/login`);
console.log(`   Correo:     ${EMAIL}`);
console.log(`   Contraseña: ${PASSWORD}`);
console.log("   ⚠️  Cambiá la contraseña luego del primer ingreso.");
