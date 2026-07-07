// Marca a un usuario como DESARROLLADOR (es_dev=true) por email, SIN tocar su
// contraseña. Correr DESPUÉS de la migración 0034.
//   node --env-file=.env.local scripts/marcar-dev.mjs carlos@prestaya.uy
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const email = (process.argv[2] || "carlos@prestaya.uy").toLowerCase();

const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
const u = (data?.users ?? []).find((x) => (x.email ?? "").toLowerCase() === email);
if (!u) {
  console.error("✗ No existe un login con ese email:", email);
  process.exit(1);
}
const { error } = await db.from("usuarios").update({ es_dev: true }).eq("auth_user_id", u.id);
if (error) {
  console.error("✗", error.message, "(¿corriste la migración 0034?)");
  process.exit(1);
}
console.log(`✓ ${email} ahora es DESARROLLADOR.`);
