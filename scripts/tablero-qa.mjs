#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
//  TABLERO DE QA (§9 del plan maestro) — SOLO LECTURA contra la base viva.
//
//  "Si un número de estos se mueve, algo del workflow se rompió aunque los
//  tests estén verdes." Corre en segundos, sin sesión ni navegador:
//
//      node scripts/tablero-qa.mjs
//
//  Cadencia: semanal (junto con «Un día en la vida») y ante cualquier duda.
//  Métricas: invariantes rojas vs baseline conocido · candado trabajando ·
//  pedidos envejecidos · jornadas sin rendir · reportes desde la app ·
//  adopción de bases. El drift vs Disapp y la cola offline no viven en la
//  base (export manual / teléfono) — se listan como recordatorio.
//
//  BASELINE (medido 15-08-2026): lo heredado que los vigilantes cantan todos
//  los días sin que sea un incidente nuevo. Si un contador SUPERA su baseline,
//  eso sí es del día y hay que mirarlo.
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

function leerEnv(nombre) {
  if (process.env[nombre]) return process.env[nombre];
  const texto = readFileSync(join(raiz, ".env.local"), "utf8");
  const linea = texto.split(/\r?\n/).find((l) => l.startsWith(`${nombre}=`));
  if (!linea) throw new Error(`${nombre} no está en .env.local`);
  return linea.slice(nombre.length + 1).trim().replace(/^["']|["']$/g, "");
}

// Lo que los vigilantes cantan HOY por herencia del empalme / operación
// conocida. Ver memoria qa-fases-2-3-0815: no es plata nueva mal contada.
const BASELINE = {
  "no-sobrecobro": { tope: 300, nota: "herencia del empalme (292 el 15-08), plano" },
  "importado-saldado-sin-finalizar": { tope: null, nota: "zombies de Renovar (~217): operación, no plata" },
  "gasto_sin_egreso": { tope: 1, nota: "Valentina $1.000 (04-08) hasta registrar el egreso" },
  "rendicion-existe": { tope: 15, nota: "jornadas sin rendir conocidas" },
  "base_sin_rendir": { tope: 15, nota: "bases sin acta conocidas" },
};

const alarmas = [];
function linea(titulo, valor, alarma = null) {
  console.log(`  ${titulo.padEnd(46, "·")} ${valor}`);
  if (alarma) {
    alarmas.push(alarma);
    console.log(`     ⚠ ${alarma}`);
  }
}

const db = new pg.Client({
  connectionString: leerEnv("SUPABASE_DB_URL"),
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

console.log("═══ TABLERO DE QA · " + new Date().toISOString().slice(0, 16) + "Z ═══\n");

// ── 1 · Invariantes de los vigilantes (última corrida) ──────────────────────
{
  const [ultima] = await q(
    "select corrida_en, criticos, detalle from reconciliacion_log order by corrida_en desc limit 1",
  );
  if (!ultima) {
    linea("Vigilantes nocturnos", "SIN CORRIDAS", "reconciliacion_log vacío: ¿el cron murió?");
  } else {
    const horas = (Date.now() - new Date(ultima.corrida_en).getTime()) / 3_600_000;
    console.log(
      `  Vigilantes (corrida ${new Date(ultima.corrida_en).toISOString().slice(0, 16)}Z, hace ${horas.toFixed(0)} h)`,
    );
    if (horas > 30) alarmas.push("la última corrida de vigilantes tiene más de 30 h — ¿cron caído?");
    // `detalle` ES el mapa {invariante: cantidad} (verificado contra la base 15-08).
    const det = typeof ultima.detalle === "string" ? JSON.parse(ultima.detalle) : (ultima.detalle ?? {});
    const porInv = Object.fromEntries(Object.entries(det).filter(([, v]) => typeof v === "number"));
    for (const [inv, n] of Object.entries(porInv).sort((a, b) => b[1] - a[1])) {
      const base = BASELINE[inv];
      const sobre = base ? (base.tope != null && n > base.tope) : n > 0;
      linea(
        `   ${inv}`,
        `${n}${base ? `  (baseline: ${base.nota})` : ""}`,
        sobre ? `${inv} = ${n} SUPERA lo conocido — mirar hoy` : null,
      );
    }
  }
}

// ── 2 · El candado anti-duplicados trabaja ──────────────────────────────────
{
  const frenos = await q(
    `select accion, count(*)::int as k from auditoria
     where accion like 'Candado frenó%' and creado_en > now() - interval '7 days'
     group by accion order by k desc`,
  );
  if (frenos.length === 0) {
    linea(
      "Candado: frenos en 7 días",
      "0",
      null, // el rastro existe recién desde el 15-08: 0 todavía no prueba candado muerto
    );
    console.log("     (rastro nuevo del 15-08: un 0 sostenido POR SEMANAS = candado muerto o nadie duplica)");
  } else {
    for (const f of frenos) linea(`   ${f.accion}`, String(f.k));
  }
}

// ── 3 · Pedidos envejecidos (>24 h pendientes) ──────────────────────────────
{
  const [r] = await q(`
    select
      (select count(*)::int from solicitudes_renovacion where estado='pendiente' and solicitado_en < now() - interval '24 hours') as renov,
      (select count(*)::int from solicitudes_gasto      where estado='pendiente' and solicitado_en < now() - interval '24 hours') as gasto,
      (select count(*)::int from solicitudes_anulacion  where estado='pendiente' and solicitado_en < now() - interval '24 hours') as anul
  `);
  const total = r.renov + r.gasto + r.anul;
  linea(
    "Pedidos pendientes > 24 h (renov/gasto/anul)",
    `${r.renov} / ${r.gasto} / ${r.anul}`,
    total > 0 ? `${total} pedidos con más de un día: la cola se está resolviendo por WhatsApp otra vez` : null,
  );
}

// ── 4 · Jornadas sin rendir ─────────────────────────────────────────────────
{
  const [r] = await q(`
    select
      count(*) filter (where a.fecha < (now() at time zone 'America/Montevideo')::date - 2)::int as viejas,
      count(*)::int as total
    from aperturas_caja a
    where a.fecha < (now() at time zone 'America/Montevideo')::date
      and not exists (select 1 from rendiciones r where r.cobrador_id = a.cobrador_id and r.fecha = a.fecha)
  `);
  linea(
    "Jornadas con base y sin acta (>48 h / total)",
    `${r.viejas} / ${r.total}`,
    r.viejas > BASELINE.base_sin_rendir.tope ? "crecen las jornadas sin rendir: plata durmiendo en bolsillos" : null,
  );
}

// ── 5 · Reportes desde la app ───────────────────────────────────────────────
{
  const [r] = await q(`
    select
      (select count(*)::int from incidencias where creado_en > now() - interval '7 days') as bichos,
      (select count(*)::int from incidencias where estado not in ('resuelta','cerrada','descartada')) as abiertas,
      (select count(*)::int from discrepancias_dinero where resuelto_en is null) as discrepancias
  `);
  linea("Incidencias 🐞 (7 días / abiertas)", `${r.bichos} / ${r.abiertas}`);
  linea(
    "Discrepancias de dinero SIN resolver",
    String(r.discrepancias),
    r.discrepancias > 0 ? "hay clientes reportando pagos que el libro no refleja — resolver YA" : null,
  );
}

// ── 6 · Adopción: bases cargadas / cobradores activos ───────────────────────
{
  const [r] = await q(`
    select
      (select count(*)::int from aperturas_caja where fecha = (now() at time zone 'America/Montevideo')::date) as hoy,
      (select count(*)::int from aperturas_caja where fecha = (now() at time zone 'America/Montevideo')::date - 1) as ayer,
      (select count(*)::int from usuarios where rol='cobrador' and activo) as cobradores
  `);
  linea(
    "Bases cargadas hoy / ayer / cobradores",
    `${r.hoy} / ${r.ayer} / ${r.cobradores}`,
    r.ayer < Math.ceil(r.cobradores / 2) ? "menos de la mitad cargó base ayer: la caja vuelve a ser verbal" : null,
  );
}

// ── 7 · Lo que NO vive en la base (recordatorio) ────────────────────────────
console.log("\n  Manuales: drift vs EXPORT de Disapp (nunca contra su dashboard) · ops");
console.log("  atascadas en la cola offline (viven en cada teléfono; el cierre las canta)");
console.log("  · errores [PY-ERROR] en los logs de Vercel.");

await db.end();

console.log("\n═══ VEREDICTO ═══");
if (alarmas.length === 0) {
  console.log("🟢 Tablero en verde: nada se movió fuera de lo conocido.");
} else {
  console.log(`🔴 ${alarmas.length} señal(es) de alarma:`);
  for (const a of alarmas) console.log("   · " + a);
  process.exitCode = 1;
}
