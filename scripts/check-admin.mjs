// Verifica el camino real del panel: login con email/contraseña (clave ANÓNIMA,
// como el navegador) y acceso a datos vía RLS según el rol. Sin service_role.
//   node --env-file=.env.local scripts/check-admin.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@prestaya.uy";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || "PrestaYa2026!";

const db = createClient(url, anon, { auth: { persistSession: false } });

console.log("1) Login con la clave anónima (como el navegador)…");
const { data: sesion, error: errLogin } = await db.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
});
if (errLogin) {
  console.error(`   ✗ login falló: ${errLogin.message}`);
  process.exit(1);
}
console.log(`   ✅ sesión iniciada (uid ${sesion.user.id.slice(0, 8)}…)`);

console.log("2) Resolver usuario del sistema (RLS sobre usuarios)…");
const { data: usuario, error: errU } = await db
  .from("usuarios")
  .select("nombre, rol, activo")
  .eq("auth_user_id", sesion.user.id)
  .maybeSingle();
if (errU || !usuario) {
  console.error(`   ✗ no se resolvió el usuario: ${errU?.message ?? "no existe"}`);
  process.exit(1);
}
console.log(`   ✅ ${usuario.nombre} · rol ${usuario.rol} · activo ${usuario.activo}`);

console.log("3) Acceso a datos como gestor (RLS debe permitir ver todo)…");
const clientes = await db.from("clientes").select("*", { count: "exact", head: true });
const prestamos = await db.from("prestamos").select("*", { count: "exact", head: true });
const pagos = await db.from("pagos").select("*", { count: "exact", head: true });
if (clientes.error || prestamos.error || pagos.error) {
  console.error("   ✗ RLS bloqueó al gestor (revisar políticas).");
  process.exit(1);
}
console.log(
  `   ✅ clientes ${clientes.count} · préstamos ${prestamos.count} · pagos ${pagos.count}`,
);

await db.auth.signOut();
console.log("\n✅ Camino del panel verificado: login + RLS por rol OK.");
