// ─────────────────────────────────────────────────────────────────────────
//  VERIFICACIÓN de un respaldo lógico (scripts/backup-completo.mjs).
//
//  Un respaldo sin verificar es una esperanza, no un respaldo. Este script NO
//  toca la base de datos de origen: trabaja SOLO sobre la carpeta del respaldo.
//   1. Integridad física: SHA-256 y conteo de filas de cada archivo vs manifest.
//   2. Integridad REFERENCIAL dentro del respaldo: pagos→prestamos,
//      prestamos→clientes, asignaciones→clientes/usuarios (huérfanos = respaldo
//      del que no se puede restaurar un estado consistente).
//   3. Invariante de DINERO dentro del respaldo (INV1): pagado_acum de cada
//      crédito == Σ de sus pagos vigentes. Si el respaldo no cuadra, restaurarlo
//      restauraría plata equivocada.
//   4. Sanidad: ids únicos, montos no negativos, disapp_pago_id sin duplicados.
//  Si TODO pasa, marca verificado=true en backups_log (si hay credenciales).
//
//  Uso:
//    node --env-file=.env.local scripts/verificar-backup.mjs backups/<carpeta>
//    (sin --env-file también funciona; solo omite el registro en backups_log)
// ─────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2];
if (!DIR || !existsSync(join(DIR, "manifest.json"))) {
  console.error("Uso: node scripts/verificar-backup.mjs backups/<carpeta>  (con manifest.json adentro)");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));
const problemas = [];
const avisos = [];

const leer = (nombreArchivo) => {
  const buf = readFileSync(join(DIR, nombreArchivo));
  return { buf, filas: gunzipSync(buf).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
};
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// ── 1) Integridad física ────────────────────────────────────────────────────
if (manifest.incompleto) problemas.push("el manifest ya está marcado INCOMPLETO (ver advertencias)");
const tablas = {};
for (const [tabla, meta] of Object.entries(manifest.tablas)) {
  const archivo = `tablas/${tabla}.jsonl.gz`;
  if (!existsSync(join(DIR, archivo))) { problemas.push(`falta el archivo de ${tabla}`); continue; }
  const { buf, filas } = leer(archivo);
  if (sha256(buf) !== meta.sha256) problemas.push(`${tabla}: SHA-256 no coincide (archivo corrupto)`);
  if (filas.length !== meta.filas) problemas.push(`${tabla}: ${filas.length} filas ≠ ${meta.filas} del manifest`);
  tablas[tabla] = filas;
}
if (manifest.auth) {
  const { buf, filas } = leer("auth-users.jsonl.gz");
  if (sha256(buf) !== manifest.auth.sha256) problemas.push("auth-users: SHA-256 no coincide");
  if (filas.length !== manifest.auth.usuarios) problemas.push(`auth-users: ${filas.length} ≠ ${manifest.auth.usuarios}`);
}
console.log(`física: ${Object.keys(tablas).length} tablas re-leídas y hasheadas`);

// ── 2) Referencial dentro del respaldo ──────────────────────────────────────
const ids = (t) => new Set((tablas[t] ?? []).map((f) => f.id));
const clientes = ids("clientes");
const prestamos = ids("prestamos");
const usuarios = ids("usuarios");

let huerfanos = 0;
for (const p of tablas.pagos ?? []) if (!prestamos.has(p.prestamo_id)) huerfanos++;
if (huerfanos) problemas.push(`${huerfanos} pagos huérfanos (prestamo_id inexistente en el respaldo)`);
let prestamosSinCliente = 0;
for (const p of tablas.prestamos ?? []) if (!clientes.has(p.cliente_id)) prestamosSinCliente++;
if (prestamosSinCliente) problemas.push(`${prestamosSinCliente} créditos sin cliente en el respaldo`);
let asigRotas = 0;
for (const a of tablas.asignaciones ?? []) {
  if (!clientes.has(a.cliente_id) || !usuarios.has(a.cobrador_id)) asigRotas++;
}
if (asigRotas) problemas.push(`${asigRotas} asignaciones con cliente/cobrador inexistente`);
console.log(`referencial: pagos→prestamos, prestamos→clientes, asignaciones ✓ revisados`);

// ── 3) INV1 dentro del respaldo: pagado_acum == Σ pagos vigentes ────────────
// ⚠️ Sumar EXACTO y comparar al final, NO redondear pago por pago. El empalme de
// Disapp importó cuotas FRACCIONARIAS (ej. 8425/24 = 351,04): redondear cada pago
// y recién después sumar acumula el error de cada uno y fabrica un drift que no
// existe — la primera corrida de este verificador reportó 5 créditos "en drift"
// (hasta 217 pesos) que en la base están perfectos. Así lo hace también el RPC
// app_reconciliacion_violaciones, que suma en `numeric` dentro de SQL.
const suma = new Map();
for (const p of tablas.pagos ?? []) {
  if (p.anulado) continue;
  suma.set(p.prestamo_id, (suma.get(p.prestamo_id) ?? 0) + Number(p.monto));
}
let drift = 0;
for (const pr of tablas.prestamos ?? []) {
  const s = suma.get(pr.id) ?? 0;
  if (Math.abs(Number(pr.pagado_acum) - s) >= 1) drift++;
}
if (drift) problemas.push(`INV1: ${drift} créditos cuyo pagado_acum NO cuadra con la Σ de sus pagos DENTRO del respaldo`);
console.log(`dinero: INV1 verificada sobre ${(tablas.prestamos ?? []).length.toLocaleString("es-UY")} créditos y ${(tablas.pagos ?? []).length.toLocaleString("es-UY")} pagos → drift=${drift}`);

// ── 4) Sanidad ──────────────────────────────────────────────────────────────
for (const [t, filas] of Object.entries(tablas)) {
  if (!filas.length || !("id" in filas[0])) continue;
  const set = new Set(filas.map((f) => f.id));
  if (set.size !== filas.length) problemas.push(`${t}: ids duplicados (${filas.length - set.size})`);
}
let negativos = 0;
for (const p of tablas.pagos ?? []) if (Number(p.monto) < 0) negativos++;
if (negativos) problemas.push(`${negativos} pagos con monto negativo`);
const disapp = new Map();
let dupDisapp = 0;
for (const p of tablas.pagos ?? []) {
  if (!p.disapp_pago_id) continue;
  if (disapp.has(p.disapp_pago_id)) dupDisapp++;
  disapp.set(p.disapp_pago_id, 1);
}
if (dupDisapp) problemas.push(`${dupDisapp} disapp_pago_id duplicados`);

// ── Veredicto ───────────────────────────────────────────────────────────────
for (const a of avisos) console.log(`⚠ ${a}`);
if (problemas.length) {
  console.log(`\n🔴 RESPALDO NO CONFIABLE (${problemas.length} problema/s):`);
  for (const p of problemas) console.log(`   · ${p}`);
  process.exit(1);
}
console.log(`\n✅ RESPALDO VERIFICADO: íntegro, consistente y con la plata cuadrada.`);

// Marcar verificado=true en backups_log (best-effort; exige credenciales).
if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data } = await db.from("backups_log").select("id").eq("destino", DIR.replace(/\\/g, "/")).order("corrido_en", { ascending: false }).limit(1);
    const id = data?.[0]?.id ?? null;
    if (id) {
      await db.from("backups_log").update({ verificado: true }).eq("id", id);
      console.log("backups_log: marcado verificado ✓");
    } else {
      // El destino puede diferir por separadores; matchear la última corrida sin verificar.
      const { data: ult } = await db.from("backups_log").select("id").eq("verificado", false).order("corrido_en", { ascending: false }).limit(1);
      if (ult?.[0]) {
        await db.from("backups_log").update({ verificado: true }).eq("id", ult[0].id);
        console.log("backups_log: marcado verificado (última corrida) ✓");
      }
    }
  } catch {
    console.log("⚠ no se pudo marcar verificado en backups_log");
  }
}
