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
  // ⚠️ PILOTO EN PAUSA (Carlos, 15-08): no se está llevando el día a día en la
  // app mientras dure esta etapa, así que "0 bases" es lo ESPERADO y no alarma.
  // Cuando el piloto retome, volver a encender la alarma (< mitad = rojo).
  linea("Bases cargadas hoy / ayer / cobradores", `${r.hoy} / ${r.ayer} / ${r.cobradores}`);
  if (r.ayer < Math.ceil(r.cobradores / 2))
    console.log("     (piloto en pausa — al retomar, esto vuelve a ser señal de alarma)");
}

// ── 6b · Supervisores SIN zona (decisión de Carlos, 15-08: no pueden existir) ─
//  Mientras haya alguno, la rama app_supervisor_sin_zonas() les abre TODO
//  (transición). Cuando este número llegue a 0 y se decida, se quita esa rama
//  de las policies (migración) y el aislamiento zonal queda sin excepciones.
{
  const [r] = await q(`
    select count(*)::int as sin_zona,
           (select count(*)::int from usuarios where rol='supervisor' and activo) as total
    from usuarios u
    where u.rol='supervisor' and u.activo
      and not exists (select 1 from supervisor_zonas sz where sz.supervisor_id = u.id)
  `);
  linea(
    "Supervisores sin zona / total",
    `${r.sin_zona} / ${r.total}`,
    r.sin_zona > 0
      ? `${r.sin_zona} supervisor(es) ven TODO por la rama de transición — asignar zonas y quitar app_supervisor_sin_zonas()`
      : null,
  );
}

//  Espejo para COBRADORES: un cobrador activo sin zona_id genera pedidos que
//  NINGÚN supervisor ve (la RLS 0140 deriva la zona del cliente desde la del
//  cobrador → NULL → solo el admin los ve) y "Recordarle a mi supervisor" no
//  tiene canal de zona (auditoría 21-08).
{
  const [r] = await q(`
    select count(*)::int as sin_zona,
           (select count(*)::int from usuarios where rol='cobrador' and activo) as total
    from usuarios u
    where u.rol='cobrador' and u.activo and u.zona_id is null
  `);
  linea(
    "Cobradores sin zona / total",
    `${r.sin_zona} / ${r.total}`,
    r.sin_zona > 0
      ? `${r.sin_zona} cobrador(es) activos sin zona: sus pedidos de la calle solo los ve el admin — asignarles zona`
      : null,
  );
}

// ── 7 · VIGILANTE DE POLICIES: la base viva vs el snapshot esperado ─────────
//  El incidente 0029-vs-0096 (08-14): el repo decía una policy y la base viva
//  tenía otra — un supervisor podía resolver pedidos de zonas ajenas y ningún
//  test lo veía (el harness aplica las migraciones del REPO). Este check
//  compara pg_policies REAL contra scripts/policies-esperadas.json.
//  Tras aplicar una migración legítima: node scripts/tablero-qa.mjs --regenerar-policies
{
  const rutaSnap = join(raiz, "scripts", "policies-esperadas.json");
  const vivas = (
    await q(`select tablename, policyname, cmd, coalesce(array_to_string(roles,','),'') as roles,
                    md5(coalesce(qual,'') || '|' || coalesce(with_check,'')) as md5
             from pg_policies where schemaname='public' order by tablename, policyname`)
  ).map((r) => ({ tabla: r.tablename, policy: r.policyname, cmd: r.cmd, roles: r.roles, md5: r.md5 }));

  if (process.argv.includes("--regenerar-policies")) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      rutaSnap,
      JSON.stringify(
        {
          generado: new Date().toISOString().slice(0, 10),
          nota: "Snapshot de pg_policies de la base VIVA (tabla, policy, cmd, roles, md5 del using|check). Regenerar tras cada migracion aplicada: node scripts/tablero-qa.mjs --regenerar-policies",
          policies: vivas,
        },
        null,
        1,
      ),
    );
    linea("Policies: snapshot REGENERADO", `${vivas.length} policies`);
  } else {
    const snap = JSON.parse(readFileSync(rutaSnap, "utf8"));
    const clave = (p) => `${p.tabla}.${p.policy}`;
    const esperadas = new Map(snap.policies.map((p) => [clave(p), p]));
    const enVivo = new Map(vivas.map((p) => [clave(p), p]));
    const faltan = [...esperadas.keys()].filter((k) => !enVivo.has(k));
    const sobran = [...enVivo.keys()].filter((k) => !esperadas.has(k));
    const cambiadas = [...esperadas.entries()]
      .filter(([k, e]) => enVivo.has(k))
      .filter(([k, e]) => {
        const v = enVivo.get(k);
        return v.md5 !== e.md5 || v.cmd !== e.cmd || v.roles !== e.roles;
      })
      .map(([k]) => k);
    const drift = faltan.length + sobran.length + cambiadas.length;
    linea(
      `Policies vivas vs snapshot ${snap.generado}`,
      drift === 0 ? `${vivas.length} — sin drift` : `DRIFT: −${faltan.length} +${sobran.length} ~${cambiadas.length}`,
      drift > 0
        ? `pg_policies cambió sin regenerar el snapshot: ${[...faltan.map((k) => "falta " + k), ...sobran.map((k) => "sobra " + k), ...cambiadas.map((k) => "cambió " + k)].slice(0, 6).join(" · ")}`
        : null,
    );
  }
}

// ── 8 · Lo que NO vive en la base (recordatorio) ────────────────────────────
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
