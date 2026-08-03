// ─────────────────────────────────────────────────────────────────────────
//  RESTAURACIÓN de un respaldo lógico en un proyecto Supabase (DR / drill).
//
//  ⚠️ HERRAMIENTA DE DESASTRE. Diseñada para restaurar en un proyecto NUEVO y
//  VACÍO (ya migrado con supabase/migrations). NUNCA apuntarla a producción
//  viva: se niega si el destino es el mismo host del que salió el respaldo, y
//  se niega si el destino ya tiene datos (salvo flag explícita).
//
//  Orden de uso en un desastre (detalle en docs/RUNBOOK-RESPALDOS.md):
//   1. Crear proyecto Supabase nuevo y correr TODAS las migraciones (SQL Editor).
//   2. node scripts/restaurar-backup.mjs backups/<carpeta> \
//        --url https://<nuevo>.supabase.co --key <SERVICE_ROLE_DEL_NUEVO> --commit
//   3. Corre en orden de dependencias (FK) y reintenta el resto en rondas.
//   4. AUTH: crea los usuarios por email con contraseña temporal ALEATORIA y
//      re-apunta usuarios.auth_user_id (los hashes de contraseña no salen por
//      API — el equipo resetea su clave el primer día; imprime el CSV).
//   5. Verifica conteos contra el manifest al final.
//
//  Dry-run por defecto: sin --commit NO escribe nada.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { gunzipSync } from "node:zlib";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const DIR = process.argv[2];
const arg = (f, d = null) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const URL_DESTINO = arg("--url");
const KEY_DESTINO = arg("--key");
const COMMIT = process.argv.includes("--commit");
const PERMITIR_NO_VACIO = process.argv.includes("--acepto-destino-con-datos");

if (!DIR || !existsSync(join(DIR, "manifest.json")) || !URL_DESTINO || !KEY_DESTINO) {
  console.error("Uso: node scripts/restaurar-backup.mjs backups/<carpeta> --url <https://nuevo.supabase.co> --key <service_role> [--commit]");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));
if (manifest.incompleto) {
  console.error("🔴 Este respaldo está marcado INCOMPLETO. No se restaura un respaldo no confiable.");
  process.exit(1);
}
// Guardia #1: jamás contra el proyecto de ORIGEN.
if (new URL(URL_DESTINO).host === manifest.origen_host) {
  console.error(`🔴 El destino (${new URL(URL_DESTINO).host}) es el MISMO proyecto del que salió el respaldo. Restaurá en un proyecto NUEVO.`);
  process.exit(1);
}
const db = createClient(URL_DESTINO, KEY_DESTINO, { auth: { persistSession: false } });

// Guardia #2: el destino debe estar VACÍO de datos de negocio.
{
  const { count, error } = await db.from("clientes").select("id", { count: "exact", head: true });
  if (error) { console.error(`🔴 El destino no responde o no está migrado (clientes: ${error.message}). Corré las migraciones primero.`); process.exit(1); }
  if ((count ?? 0) > 0 && !PERMITIR_NO_VACIO) {
    console.error(`🔴 El destino ya tiene ${count} clientes. Si REALMENTE querés restaurar encima, pasá --acepto-destino-con-datos.`);
    process.exit(1);
  }
}

const leer = (nombre) => {
  const ruta = join(DIR, nombre);
  if (!existsSync(ruta)) return [];
  return gunzipSync(readFileSync(ruta)).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
};

console.log(`${COMMIT ? "⚠ RESTAURANDO" : "DRY-RUN (nada se escribe; usá --commit)"} → ${new URL(URL_DESTINO).host}`);

// ── 1) AUTH: crear usuarios por email y armar el mapa id_viejo → id_nuevo ────
const authViejos = leer("auth-users.jsonl.gz");
const mapaAuth = new Map();
const credenciales = [];
if (COMMIT) {
  // Índice de los ya existentes en el destino (revancha de una corrida a medias).
  const existentes = new Map();
  for (let page = 1; page <= 50; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    for (const u of data.users) if (u.email) existentes.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 1000) break;
  }
  for (const v of authViejos) {
    if (!v.email) continue;
    const ya = existentes.get(v.email.toLowerCase());
    if (ya) { mapaAuth.set(v.id, ya); continue; }
    const passTemporal = randomBytes(9).toString("base64url");
    const { data, error } = await db.auth.admin.createUser({
      email: v.email, password: passTemporal, email_confirm: true,
      user_metadata: v.user_metadata ?? {}, app_metadata: v.app_metadata ?? {},
    });
    if (error || !data.user) { console.log(`  ⚠ auth ${v.email}: ${error?.message}`); continue; }
    mapaAuth.set(v.id, data.user.id);
    credenciales.push(`${v.email},${passTemporal}`);
  }
  console.log(`auth: ${mapaAuth.size} usuarios mapeados (${credenciales.length} creados con clave temporal)`);
  if (credenciales.length) {
    const csv = join(DIR, "credenciales-temporales-restauracion.csv");
    writeFileSync(csv, "email,password_temporal\n" + credenciales.join("\n"));
    console.log(`  → claves temporales en ${csv} (repartir y que cada quien la cambie)`);
  }
} else {
  console.log(`auth: ${authViejos.length} usuarios se crearían por email (dry-run)`);
}

// ── 2) Datos: orden de dependencias conocido + rondas de reintento ──────────
const PRIORIDAD = [
  "zonas", "usuarios", "supervisor_zonas", "clientes", "categorias_producto",
  "productos", "prestamos", "pagos", "asignaciones", "aperturas_caja",
  "rendiciones", "cierres_zona", "movimientos_caja", "solicitudes_gasto",
  "comisiones_liquidadas", "compras_empleado", "descuentos_compra_empleado",
];
const todas = Object.keys(manifest.tablas);
const orden = [...PRIORIDAD.filter((t) => todas.includes(t)), ...todas.filter((t) => !PRIORIDAD.includes(t)).sort()];

const LOTE = 500;
async function insertarTabla(tabla) {
  let filas = leer(`tablas/${tabla}.jsonl.gz`);
  if (tabla === "usuarios") {
    // Re-apuntar el login al auth NUEVO (los ids de auth cambian al recrear).
    filas = filas.map((f) => ({ ...f, auth_user_id: f.auth_user_id ? (mapaAuth.get(f.auth_user_id) ?? null) : null }));
  }
  if (!COMMIT) return { ok: filas.length, err: 0 };
  let ok = 0, err = 0, ultimo = "";
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    const { error } = await db.from(tabla).upsert(lote, { onConflict: "id", ignoreDuplicates: false });
    if (error) { err += lote.length; ultimo = `${error.code} ${error.message}`; }
    else ok += lote.length;
  }
  return { ok, err, ultimo };
}

const pendientes = new Map(orden.map((t) => [t, null]));
for (let ronda = 1; ronda <= 3 && pendientes.size; ronda++) {
  console.log(`\n— ronda ${ronda} (${pendientes.size} tablas) —`);
  for (const tabla of [...pendientes.keys()]) {
    const r = await insertarTabla(tabla);
    const esperado = manifest.tablas[tabla].filas;
    if (r.err === 0) {
      console.log(`  ✓ ${tabla.padEnd(30)} ${String(r.ok).padStart(8)}/${esperado}`);
      pendientes.delete(tabla);
    } else {
      console.log(`  ↻ ${tabla.padEnd(30)} ok=${r.ok} err=${r.err} (${(r.ultimo ?? "").slice(0, 80)})`);
      pendientes.set(tabla, r.ultimo);
    }
  }
}

// ── 3) Veredicto: conteos contra el manifest ────────────────────────────────
if (COMMIT) {
  console.log("\nVERIFICACIÓN de conteos:");
  let malos = 0;
  for (const tabla of orden) {
    const { count } = await db.from(tabla).select("*", { count: "exact", head: true });
    const esperado = manifest.tablas[tabla].filas;
    const igual = (count ?? 0) === esperado;
    if (!igual) { malos++; console.log(`  ✗ ${tabla}: ${count} ≠ ${esperado}`); }
  }
  if (pendientes.size || malos) {
    console.log(`\n🔴 RESTAURACIÓN INCOMPLETA: ${pendientes.size} tablas con errores, ${malos} con conteos distintos.`);
    process.exit(1);
  }
  console.log(`\n✅ RESTAURACIÓN COMPLETA: ${orden.length} tablas con los conteos del manifest.`);
  console.log("Siguiente paso del runbook: correr scripts/auditoria-db.mjs contra el destino y repartir credenciales.");
} else {
  console.log(`\nDry-run OK: se restaurarían ${orden.length} tablas (${manifest.filas_total.toLocaleString("es-UY")} filas). Agregá --commit.`);
}
