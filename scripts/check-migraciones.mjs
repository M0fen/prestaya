// Diagnóstico exacto del estado de las migraciones en Supabase.
// node --env-file=.env.local scripts/check-migraciones.mjs
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function tabla(t) {
  const { count, error } = await db
    .from(t)
    .select("*", { count: "exact", head: true });
  if (error) console.log(`tabla ${t}: ERROR [${error.code}] ${error.message}`);
  else console.log(`tabla ${t}: existe (${count} filas)`);
}

async function funcion(fn) {
  const { data, error } = await db.rpc(fn);
  if (error)
    console.log(`func  ${fn}(): ERROR [${error.code}] ${error.message}`);
  else console.log(`func  ${fn}(): existe → devolvió ${JSON.stringify(data)}`);
}

console.log("── 0001 (tablas base) ──");
await tabla("clientes");
await tabla("pagos");
console.log("── 0002 (funciones RLS) ──");
await funcion("app_es_gestor");
await funcion("app_rol");
console.log("── 0003 (anuncios) ──");
await tabla("anuncios");
console.log("── 0004 (reportes) ──");
await tabla("reportes");
