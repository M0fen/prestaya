// ─────────────────────────────────────────────────────────────────────────
//  SEED de prueba de la QUINIELA. Abre una quiniela de ejemplo (idempotente por
//  id fijo), reporta la cobertura de numero_registro y da un link de prueba.
//  La participación es AUTOMÁTICA: cada cliente al día que abre su cartón entra
//  con su número (últimos 3 del registro). No hace falta sembrar participaciones.
//    Sembrar:  node --env-file=.env.local scripts/seed-quiniela.mjs
//    Quitar:   node --env-file=.env.local scripts/seed-quiniela.mjs --limpiar
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LIMPIAR = process.argv.includes("--limpiar");

const ID_QUINIELA = "c0b0e000-0000-4000-8000-000000000701"; // uuid fijo (idempotente)
const suerte = (nreg) => (nreg == null ? null : String(Math.abs(Math.trunc(Number(nreg))) % 1000).padStart(3, "0"));

async function main() {
  if (LIMPIAR) {
    // Las participaciones caen por ON DELETE CASCADE.
    const { error } = await db.from("quinielas").delete().eq("id", ID_QUINIELA);
    console.log(error ? "ERROR: " + error.message : "✓ Quiniela de prueba quitada.");
    return;
  }

  // 1) ¿Corrió la 0081? Chequeo la columna numero_registro.
  const chk = await db.from("clientes").select("id, numero_registro").not("numero_registro", "is", null).limit(1);
  if (chk.error && /numero_registro/.test(chk.error.message)) {
    console.log("⚠ Falta la migración 0081 (columna numero_registro). Corré 0081 y volvé a intentar.");
    process.exit(1);
  }
  const totales = await db.from("clientes").select("*", { count: "exact", head: true }).eq("activo", true);
  const conNro = await db.from("clientes").select("*", { count: "exact", head: true }).eq("activo", true).not("numero_registro", "is", null);
  console.log(`Cobertura numero_registro: ${conNro.count ?? 0}/${totales.count ?? 0} clientes activos.`);

  // 2) Abrir la quiniela de prueba (rango fijo 000–999).
  const { error } = await db.from("quinielas").upsert({
    id: ID_QUINIELA,
    titulo: "Quiniela de prueba 🍀",
    rango_min: 0,
    rango_max: 999,
    premio_texto: "1 día de gracia en tu próxima cuota",
    estado: "abierta",
    numero_ganador: null,
    sorteo_en: null,
  }, { onConflict: "id" });
  if (error) { console.error("✗ No se pudo abrir la quiniela:", error.message); process.exit(1); }
  console.log("✓ Quiniela de prueba ABIERTA: “Quiniela de prueba 🍀” (premio: 1 día de gracia).");

  // 3) Link de prueba: un cliente activo con token y crédito activo.
  const { data: cli } = await db
    .from("clientes")
    .select("id, nombre, token_acceso, numero_registro")
    .eq("activo", true)
    .not("token_acceso", "is", null)
    .not("numero_registro", "is", null)
    .limit(40);
  let elegido = null;
  for (const c of cli ?? []) {
    const { count } = await db.from("prestamos").select("*", { count: "exact", head: true }).eq("cliente_id", c.id).eq("estado", "activo");
    if ((count ?? 0) > 0) { elegido = c; break; }
  }
  if (elegido) {
    console.log(`\n🔗 LINK DE PRUEBA (cliente ${elegido.nombre}, número de la suerte ${suerte(elegido.numero_registro)}):`);
    console.log(`   https://prestaya-blush.vercel.app/c/${elegido.token_acceso}`);
    console.log("   (Abrilo estando al día → entra solo al sorteo. Luego mirá /admin/promos.)");
  } else {
    console.log("\n(No encontré un cliente activo con crédito para el link — igual mirá /admin/promos.)");
  }
  console.log("\n⚠ Recordá: la quiniela se ve al cliente solo si la Zona de juego está ENCENDIDA (/admin/juego).");
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
