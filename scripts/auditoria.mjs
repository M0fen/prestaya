// ─────────────────────────────────────────────────────────────────────────
//  Auditoría de la base de Presta Ya contra Supabase real.
//  Verifica: migraciones 0001–0004, funciones RLS, que el RLS bloquee al
//  anónimo, el write de reportes (con limpieza) y la lectura de anuncios.
//  node --env-file=.env.local scripts/auditoria.mjs
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

let fallos = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => {
  console.log(`  ❌ ${m}`);
  fallos++;
};

const CLIENTE_ID = "00000000-0000-0000-0000-000000000001";
const PRESTAMO_ID = "00000000-0000-0000-0000-0000000000a1";

console.log("\n1) TABLAS (service_role) ───────────────────────────────");
for (const t of [
  "usuarios",
  "clientes",
  "prestamos",
  "pagos",
  "visitas",
  "asignaciones",
  "anuncios",
  "reportes",
]) {
  // SELECT real (no head): detecta de forma fiable si la tabla existe en
  // PostgREST. El conteo con head:true puede dar falsos positivos.
  const { data, error } = await admin.from(t).select("id").limit(1);
  if (error) bad(`${t}: NO visible — ${error.message}`);
  else ok(`${t}: existe (muestra ${data.length} fila)`);
}

console.log("\n2) FUNCIONES RLS (0002) ────────────────────────────────");
for (const fn of [
  "app_es_gestor",
  "app_rol",
  "app_usuario_id",
]) {
  const { error } = await admin.rpc(fn);
  if (error && /PGRST202|could not find/i.test(error.message))
    bad(`${fn}() NO existe`);
  else ok(`${fn}() existe`);
}

console.log("\n3) RLS ACTIVO: el anónimo NO debe ver datos ───────────");
{
  const { data, error } = await anon.from("clientes").select("id").limit(5);
  if (error) ok(`clientes (anon) bloqueado por error de política`);
  else if ((data?.length ?? 0) === 0)
    ok(`clientes (anon) devuelve 0 filas → RLS bloquea ✔`);
  else bad(`clientes (anon) devolvió ${data.length} filas → RLS NO bloquea`);
}
{
  const { data } = await anon.from("pagos").select("id").limit(5);
  if ((data?.length ?? 0) === 0) ok(`pagos (anon) → 0 filas ✔`);
  else bad(`pagos (anon) devolvió ${data.length} filas → RLS NO bloquea`);
}

console.log("\n4) WRITE de reportes (service_role) + limpieza ─────────");
{
  const { data, error } = await admin
    .from("reportes")
    .insert({
      cliente_id: CLIENTE_ID,
      prestamo_id: PRESTAMO_ID,
      tipo: "falta_pago",
      dia_credito: 11,
      comentario: "AUDITORIA — registro de prueba (se borra solo)",
    })
    .select()
    .single();
  if (error) {
    bad(`insert reporte falló: ${error.message}`);
  } else {
    ok(`reporte creado (id ${data.id.slice(0, 8)}…, estado '${data.estado}')`);
    const del = await admin.from("reportes").delete().eq("id", data.id);
    if (del.error) bad(`no se pudo limpiar el reporte de prueba`);
    else ok(`reporte de prueba eliminado (limpieza)`);
  }
}

console.log("\n5) LECTURA de anuncio vigente (service_role) ───────────");
{
  const ahora = new Date().toISOString();
  const { data, error } = await admin
    .from("anuncios")
    .select("titulo")
    .eq("activo", true)
    .lte("fecha_inicio", ahora)
    .or(`fecha_fin.is.null,fecha_fin.gte.${ahora}`)
    .in("segmento", ["todos", "con_pendientes"])
    .order("prioridad", { ascending: false })
    .limit(1);
  if (error) bad(`lectura anuncios: ${error.message}`);
  else if (data.length) ok(`anuncio vigente: "${data[0].titulo.slice(0, 40)}…"`);
  else console.log("  ℹ️  no hay anuncio vigente (corré el seed si querés uno)");
}

console.log(
  `\n${fallos === 0 ? "✅ AUDITORÍA OK — todo correcto" : `❌ ${fallos} problema(s)`}\n`,
);
process.exit(fallos === 0 ? 0 : 1);
