// ─────────────────────────────────────────────────────────────────────────
//  VERIFICAR PILOTO — foto de "listo para el día 1" del acercamiento.
//  Read-only (NO escribe). Chequea, en una sola corrida:
//   [A] eventos_uso (0064) → sin esto /admin/uso va en blanco (ciego a adopción).
//   [B] estructura de zonas: supervisor 1:1 + cobradores con LOGIN (auth) real.
//   [C] ruta real por cobrador: clientes asignados con préstamo ACTIVO.
//   [D] coherencia del cartón de cada crédito del piloto: campos que hacen que
//       el cartón RENDERICE (cuota>0, días>0, fecha_inicio) y que NO haya
//       sobre-cobro (pagado_acum <= cuota×días). El pagado_acum==Σpagos lo
//       valida aparte scripts/reconciliacion.mjs (más pesado).
//
//    node --env-file=.env.local scripts/verificar-piloto.mjs
//
//  Sale con código 1 si hay banderas rojas (para que un cron/CI lo note).
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const N = (v) => Math.round(Number(v) || 0);
const money = (n) => "$" + N(n).toLocaleString("es-UY");
let banderas = 0; // rojas → exit 1

/** Trae TODAS las filas (paginado estable por id) — nunca trunca. */
async function traerTodo(tabla, select, filtro = (q) => q) {
  const out = [];
  const paso = 1000;
  for (let desde = 0; ; desde += paso) {
    let q = db.from(tabla).select(select).order("id", { ascending: true }).range(desde, desde + paso - 1);
    q = filtro(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < paso) break;
  }
  return out;
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  VERIFICACIÓN DE PILOTO — Presta Ya");
console.log("  " + url);
console.log("═══════════════════════════════════════════════════════════\n");

// ── [A] eventos_uso (0064) ──────────────────────────────────────────────────
console.log("── [A] Observabilidad de adopción (eventos_uso / 0064) ──");
{
  const { count, error } = await db.from("eventos_uso").select("*", { count: "exact", head: true });
  if (error) {
    console.log(`  🔴 tabla eventos_uso: ERROR [${error.code}] ${error.message}`);
    console.log("     → CORRER supabase/migrations/0064_eventos_uso.sql. Sin esto /admin/uso va en blanco.");
    banderas++;
  } else {
    console.log(`  ✅ eventos_uso existe (${count} filas registradas) — /admin/uso operativo.`);
  }
}

// ── Cargar universo ─────────────────────────────────────────────────────────
const usuarios = await traerTodo("usuarios", "id, nombre, rol, zona_id, auth_user_id");
const zonas = await traerTodo("zonas", "id, nombre, color, activo");
// supervisor_zonas es tabla de junción (PK compuesta, sin columna `id`) → select plano.
const { data: supZonas, error: eSup } = await db.from("supervisor_zonas").select("supervisor_id, zona_id");
if (eSup) throw eSup;
const asignaciones = await traerTodo("asignaciones", "cobrador_id, cliente_id, activo", (q) => q.eq("activo", true));
const prestamosAct = await traerTodo(
  "prestamos",
  "id, cliente_id, cuota_diaria, total_dias, pagado_acum, fecha_inicio, estado",
  (q) => q.eq("estado", "activo"),
);

const zonaPorId = new Map(zonas.map((z) => [z.id, z]));
const uById = new Map(usuarios.map((u) => [u.id, u]));

// clientes con crédito ACTIVO + índice cliente→créditos
const activosCli = new Set(prestamosAct.map((p) => p.cliente_id));
const prestamosPorCli = new Map();
for (const p of prestamosAct) {
  if (!prestamosPorCli.has(p.cliente_id)) prestamosPorCli.set(p.cliente_id, []);
  prestamosPorCli.get(p.cliente_id).push(p);
}

// ruta por cobrador (clientes asignados activos que tienen crédito activo)
const cliPorCob = new Map();
for (const a of asignaciones) {
  if (!cliPorCob.has(a.cobrador_id)) cliPorCob.set(a.cobrador_id, new Set());
  cliPorCob.get(a.cobrador_id).add(a.cliente_id);
}
const clientesRutaDe = (uid) => {
  const cs = cliPorCob.get(uid);
  if (!cs) return [];
  return [...cs].filter((c) => activosCli.has(c));
};

// supervisores por zona
const supsPorZona = new Map();
for (const sz of supZonas) {
  if (!supsPorZona.has(sz.zona_id)) supsPorZona.set(sz.zona_id, []);
  supsPorZona.get(sz.zona_id).push(sz.supervisor_id);
}

// ── [B]+[C] Estructura + ruta ───────────────────────────────────────────────
console.log("\n── [B/C] Estructura del piloto: zona → supervisor → cobradores ──");
const cobradores = usuarios.filter((u) => u.rol === "cobrador");
const cobConRuta = cobradores.filter((c) => clientesRutaDe(c.id).length > 0);
console.log(`  cobradores totales: ${cobradores.length} · con ruta real hoy: ${cobConRuta.length}`);

// Agrupar cobradores CON RUTA por zona (el piloto real es quien tiene ruta).
const porZona = new Map();
for (const c of cobConRuta) {
  const zid = c.zona_id ?? "__sin_zona__";
  if (!porZona.has(zid)) porZona.set(zid, []);
  porZona.get(zid).push(c);
}

const pilotoPrestamos = []; // créditos a auditar en [D]
for (const [zid, cobs] of porZona) {
  const zona = zid === "__sin_zona__" ? { nombre: "(sin zona)", color: "" } : zonaPorId.get(zid);
  const sups = (supsPorZona.get(zid) ?? []).map((sid) => uById.get(sid)?.nombre).filter(Boolean);
  console.log(`\n  🗺️  ${zona?.nombre ?? zid}  ${sups.length ? "· supervisor: " + sups.join(", ") : "· ⚠ SIN supervisor asignado"}`);
  if (zid !== "__sin_zona__" && sups.length === 0) banderas++;
  if (sups.length > 1) console.log(`      ⚠ ${sups.length} supervisores en la misma zona (revisar 1:1).`);

  for (const c of cobs.sort((a, b) => a.nombre.localeCompare(b.nombre))) {
    const ruta = clientesRutaDe(c.id);
    const tieneLogin = !!c.auth_user_id;
    const nCred = ruta.reduce((s, cli) => s + (prestamosPorCli.get(cli)?.length ?? 0), 0);
    // acumular créditos del piloto para [D]
    for (const cli of ruta) for (const pr of prestamosPorCli.get(cli) ?? []) pilotoPrestamos.push({ ...pr, cobrador: c.nombre });
    const marca = tieneLogin ? "✅" : "🔴 SIN LOGIN";
    console.log(`      ${marca}  ${c.nombre.slice(0, 26).padEnd(26)}  ${String(ruta.length).padStart(3)} clientes · ${String(nCred).padStart(3)} créditos`);
    if (!tieneLogin) banderas++;
  }
}

// Cobradores con zona pero SIN ruta (quedarían con "caja vacía" el día 1)
const cobSinRuta = cobradores.filter((c) => c.zona_id && clientesRutaDe(c.id).length === 0);
if (cobSinRuta.length) {
  console.log(`\n  ⚠ ${cobSinRuta.length} cobrador(es) con zona pero SIN ruta hoy:`);
  for (const c of cobSinRuta) console.log(`      · ${c.nombre}`);
}

// ── [D] Coherencia del cartón de los créditos del piloto ────────────────────
console.log(`\n── [D] Coherencia del cartón (${pilotoPrestamos.length} créditos del piloto) ──`);
const problemas = { sinCuota: [], sinDias: [], sinFecha: [], sobrecobro: [], acumNeg: [] };
const TOL = 1; // $1 de tolerancia por redondeo
for (const p of pilotoPrestamos) {
  const cuota = N(p.cuota_diaria);
  const dias = Number(p.total_dias || 0);
  const acum = N(p.pagado_acum);
  const total = cuota * dias;
  const et = (arr) => arr.push({ id: p.id, cli: p.cliente_id, cob: p.cobrador, cuota, dias, acum, total });
  if (cuota <= 0) et(problemas.sinCuota);
  if (dias <= 0) et(problemas.sinDias);
  if (!p.fecha_inicio) et(problemas.sinFecha);
  if (acum < 0) et(problemas.acumNeg);
  if (total > 0 && acum > total + TOL) et(problemas.sobrecobro);
}
const linea = (nombre, arr, critico) => {
  if (arr.length === 0) { console.log(`  ✅ ${nombre}: 0`); return; }
  console.log(`  ${critico ? "🔴" : "🟠"} ${nombre}: ${arr.length}`);
  for (const x of arr.slice(0, 8))
    console.log(`      · ${x.cob} — crédito ${x.id.slice(0, 8)} (cliente ${String(x.cli).slice(0, 8)}): cuota ${money(x.cuota)} × ${x.dias}d = ${money(x.total)}, pagado ${money(x.acum)}`);
  if (arr.length > 8) console.log(`      … y ${arr.length - 8} más`);
  if (critico) banderas++;
};
linea("cuota_diaria <= 0 (cartón no renderiza)", problemas.sinCuota, true);
linea("total_dias <= 0 (cartón no renderiza)", problemas.sinDias, true);
linea("fecha_inicio nula (cartón no renderiza)", problemas.sinFecha, true);
linea("pagado_acum negativo", problemas.acumNeg, true);
linea("SOBRE-COBRO (pagado_acum > cuota×días)", problemas.sobrecobro, true);

// ── Veredicto ───────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════");
if (banderas === 0) {
  console.log("  ✅ PILOTO LISTO — sin banderas rojas. Día 1 puede arrancar.");
  process.exit(0);
}
console.log(`  🔴 ${banderas} BANDERA(S) ROJA(S) — revisar antes del día 1.`);
console.log("═══════════════════════════════════════════════════════════");
process.exit(1);
