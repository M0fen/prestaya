// Verificación rápida de conexión a Supabase (no forma parte de la app).
// Ejecutar con:  node --env-file=.env.local scripts/check-conexion.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("✗ Faltan variables en .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const tablas = ["usuarios", "clientes", "prestamos", "pagos", "visitas", "asignaciones"];
let ok = true;

for (const t of tablas) {
  const { count, error } = await db
    .from(t)
    .select("*", { count: "exact", head: true });
  if (error) {
    ok = false;
    console.error(`✗ ${t}: ${error.message}`);
  } else {
    console.log(`✓ ${t}: ${count} filas`);
  }
}

console.log(ok ? "\nConexión y esquema OK ✅" : "\nHubo errores ✗");
process.exit(ok ? 0 : 1);
