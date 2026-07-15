// ─────────────────────────────────────────────────────────────────────────
//  CONSOLIDAR ASIGNACIONES — deja cada cliente con las asignaciones que
//  REFLEJAN al dueño de sus créditos activos (prestamos.cobrador_id, fuente de
//  verdad de Disapp + comisiones 0069). Baja las asignaciones STALE (activas a
//  un cobrador que NO posee ningún crédito activo del cliente), que quedaron del
//  armado de zonas y provocan que 2 cobradores vean al mismo cliente.
//
//  REGLA: por cada cliente con ≥1 crédito activo, desactivar las asignaciones
//  activas cuyo cobrador NO sea dueño de un crédito activo del cliente, SIEMPRE
//  que quede ≥1 asignación (nunca orfanar). Los clientes con 2 dueños reales
//  (0038) quedan con sus 2 asignaciones (legítimo).
//
//    Dry-run:  node --env-file=.env.local scripts/consolidar-asignaciones.mjs
//    Aplicar:  node --env-file=.env.local scripts/consolidar-asignaciones.mjs --commit
//
//  Al aplicar, guarda un log reversible (ids desactivados) en scripts/.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COMMIT = process.argv.includes("--commit");

async function traerTodo(t, s, f = (q) => q) {
  const out = []; for (let d = 0; ; d += 1000) { let q = db.from(t).select(s).order("id", { ascending: true }).range(d, d + 999); q = f(q); const { data, error } = await q; if (error) throw error; out.push(...(data ?? [])); if (!data || data.length < 1000) break; } return out;
}

const usuarios = await traerTodo("usuarios", "id, nombre, rol, zona_id");
const zonas = await traerTodo("zonas", "id, nombre");
const zNom = new Map(zonas.map((z) => [z.id, z.nombre]));
const centroId = (zonas.find((z) => z.nombre.toLowerCase().includes("centro")) || {}).id;
const U = new Map(usuarios.map((u) => [u.id, u]));
const nom = (id) => U.get(id)?.nombre ?? "—";
const esCentro = (id) => centroId && U.get(id)?.zona_id === centroId;

// Dueños de créditos activos por cliente
const pres = await traerTodo("prestamos", "id, cliente_id, cobrador_id, estado", (q) => q.eq("estado", "activo"));
const owners = new Map();
for (const p of pres) {
  if (!owners.has(p.cliente_id)) owners.set(p.cliente_id, new Set());
  if (p.cobrador_id) owners.get(p.cliente_id).add(p.cobrador_id);
}

// Asignaciones activas por cliente
const asig = await traerTodo("asignaciones", "id, cobrador_id, cliente_id, activo, asignado_en", (q) => q.eq("activo", true));
const porCli = new Map();
for (const a of asig) { if (!porCli.has(a.cliente_id)) porCli.set(a.cliente_id, []); porCli.get(a.cliente_id).push(a); }

const bajar = [];       // asignaciones a desactivar (stale)
let clientesTocados = 0, saltadosOrfandad = 0, legitMulti = 0, centroLimpiados = 0;
const colisionesCentroResueltas = [];

for (const [cli, as] of porCli) {
  if (as.length < 2) continue;               // solo doble-ruta
  const dueños = owners.get(cli);
  if (!dueños || dueños.size === 0) continue; // sin crédito activo → no aplica
  const conDueño = as.filter((a) => dueños.has(a.cobrador_id));
  const stale = as.filter((a) => !dueños.has(a.cobrador_id));
  if (stale.length === 0) { if (conDueño.length >= 2) legitMulti++; continue; } // 0038 legítimo
  if (conDueño.length === 0) { saltadosOrfandad++; continue; }                  // GUARDA: nunca orfanar
  // Desactivar las stale; quedan las de dueño (≥1).
  for (const a of stale) bajar.push(a);
  clientesTocados++;
  const tocaCentro = as.some((a) => esCentro(a.cobrador_id));
  if (tocaCentro) {
    centroLimpiados++;
    const ambosCentro = as.length === 2 && as.every((a) => esCentro(a.cobrador_id));
    if (ambosCentro) colisionesCentroResueltas.push(`${cli.slice(0,8)}: queda ${conDueño.map(a=>nom(a.cobrador_id)).join("+")}, baja ${stale.map(a=>nom(a.cobrador_id)).join("+")}`);
  }
}

console.log(`═══ CONSOLIDACIÓN DE ASIGNACIONES ${COMMIT ? "· COMMIT" : "· DRY-RUN"} ═══\n`);
console.log(`Clientes en doble-ruta con crédito activo: ${[...porCli.values()].filter(a=>a.length>1).length}`);
console.log(`  · legít-multi (2 dueños reales, se dejan): ${legitMulti}`);
console.log(`  · a consolidar (bajar asignación stale): ${clientesTocados} clientes → ${bajar.length} asignaciones a desactivar`);
console.log(`  · saltados por guarda anti-orfandad (ningún asignado es dueño): ${saltadosOrfandad}`);
console.log(`  · de los tocados, tocan Zona Centro (piloto): ${centroLimpiados}`);
if (colisionesCentroResueltas.length) {
  console.log(`\nColisiones DENTRO de Zona Centro que se resuelven (${colisionesCentroResueltas.length}):`);
  for (const c of colisionesCentroResueltas) console.log(`   · ${c}`);
}

// Verificación de seguridad: tras bajar, ¿algún cliente quedaría con 0 asignaciones?
const bajarIds = new Set(bajar.map((a) => a.id));
let orfanados = 0;
for (const [cli, as] of porCli) {
  const quedan = as.filter((a) => !bajarIds.has(a.id));
  if (as.length > 0 && quedan.length === 0) orfanados++;
}
console.log(`\nChequeo de seguridad: clientes que quedarían SIN asignación: ${orfanados} ${orfanados === 0 ? "✅" : "🔴 ABORTAR"}`);

if (!COMMIT) {
  console.log(`\nDRY-RUN — no se escribió nada. Corré con --commit para aplicar.`);
  process.exit(0);
}
if (orfanados > 0) { console.error("🔴 Se abortó: la consolidación orfanaría clientes."); process.exit(1); }

// Aplicar en lotes; guardar log reversible.
const log = bajar.map((a) => ({ id: a.id, cobrador_id: a.cobrador_id, cliente_id: a.cliente_id, cobrador: nom(a.cobrador_id) }));
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const logPath = new URL(`./_consolidacion_revert_${ts}.json`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
writeFileSync(logPath, JSON.stringify(log, null, 2));
console.log(`\nLog reversible guardado: ${logPath}`);

let ok = 0;
for (let i = 0; i < bajar.length; i += 100) {
  const ids = bajar.slice(i, i + 100).map((a) => a.id);
  const { error } = await db.from("asignaciones").update({ activo: false }).in("id", ids);
  if (error) { console.error("ERROR al desactivar:", error.message); process.exit(1); }
  ok += ids.length;
}
console.log(`✓ Desactivadas ${ok} asignaciones stale. Reversible con el log (set activo=true por id).`);
