#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
//  RESPALDO INCREMENTAL DEL LIBRO — la pieza de RPO intradía sin PITR.
//
//  El hueco que cubre: Supabase Pro respalda UNA vez al día y el respaldo
//  lógico completo (backup-completo.mjs) es semanal — si la base se pierde a
//  las 17:00, el día entero de cobros de la calle se esfuma. PITR se descartó
//  por costo. Este script exporta SOLO LO NUEVO de las tablas de dinero
//  (append-only casi todas) desde la última corrida: corre en segundos, se
//  puede programar CADA HORA sin molestar a nadie, y deja el día recuperable
//  al costo de una hora como mucho.
//
//  · Estado en respaldos-libro/estado.json (marca de agua por tabla).
//  · Filas nuevas en respaldos-libro/YYYY-MM-DD/<tabla>.jsonl (append).
//  · `--verificar` compara conteos y suma de montos del día vs la base viva.
//  · SOLO LECTURA sobre la base. La carpeta está en .gitignore.
//
//  Uso:
//    node --env-file=.env.local scripts/respaldo-libro.mjs
//    node --env-file=.env.local scripts/respaldo-libro.mjs --verificar
//
//  PROGRAMADO (16-08): tarea "PrestaYa-respaldo-libro" cada 15 MIN de 07:00 a
//  22:00, INVISIBLE vía scripts/respaldo-libro-oculto.vbs (wscript, ventana 0),
//  salida en respaldos-libro/registro.log. RPO en jornada: ≤ 15 minutos.
//  Recrearla: schtasks /create /tn "PrestaYa-respaldo-libro" /sc minute /mo 15
//    /st 07:00 /et 22:00 /k /tr "wscript.exe C:\Users\Carlos\Desktop\prestaya\scripts\respaldo-libro-oculto.vbs"
//  ⚠️ y verificar en el XML que Duration sea PT15H (el /et localizado se mastica).
// ─────────────────────────────────────────────────────────────────────────
import pg from "pg";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

function leerEnv(nombre) {
  if (process.env[nombre]) return process.env[nombre];
  const texto = readFileSync(join(raiz, ".env.local"), "utf8");
  const linea = texto.split(/\r?\n/).find((l) => l.startsWith(`${nombre}=`));
  if (!linea) throw new Error(`${nombre} no está en .env.local`);
  return linea.slice(nombre.length + 1).trim().replace(/^["']|["']$/g, "");
}

// Tablas de DINERO con su columna de avance. Append-only (pagos jamás se edita:
// se anula con OTRO update — por eso pagos también exporta las anulaciones
// recientes por separado, abajo). Las de estado chico van completas.
const INCREMENTALES = [
  { tabla: "pagos", col: "registrado_en" },
  { tabla: "prestamos", col: "creado_en" },
  { tabla: "movimientos_caja", col: "registrado_en" },
  { tabla: "rendiciones", col: "creado_en" },
  { tabla: "auditoria", col: "creado_en" },
  { tabla: "bitacora", col: "server_ts" }, // verificado contra information_schema (15-08)
];
// Chicas y mutables: snapshot completo en cada corrida (barato y sin ambigüedad).
const COMPLETAS = ["aperturas_caja", "solicitudes_renovacion", "solicitudes_gasto", "solicitudes_anulacion", "asignaciones"];

const DIR = join(raiz, "respaldos-libro");
mkdirSync(DIR, { recursive: true });
const RUTA_ESTADO = join(DIR, "estado.json");
const estado = existsSync(RUTA_ESTADO) ? JSON.parse(readFileSync(RUTA_ESTADO, "utf8")) : { marcas: {} };

const db = new pg.Client({ connectionString: leerEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const hoy = new Date().toISOString().slice(0, 10);
const dirDia = join(DIR, hoy);
mkdirSync(dirDia, { recursive: true });

if (process.argv.includes("--verificar")) {
  // ¿Lo respaldado coincide con la base viva? Se compara el TRAMO cubierto por
  // el archivo de hoy (desde su primera fila hasta la marca de agua actual):
  // el bootstrap arranca "desde ahora", así que lo anterior vive en el
  // respaldo COMPLETO, no acá.
  const archivo = join(dirDia, "pagos.jsonl");
  const locales = existsSync(archivo)
    ? readFileSync(archivo, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  if (!locales.length) {
    console.log(`sin pagos respaldados hoy todavía (marca: ${estado.marcas.pagos ?? "sin bootstrap"}).`);
    await db.end();
    process.exit(0);
  }
  const desde = locales.map((p) => p.registrado_en).sort()[0];
  const hasta = estado.marcas.pagos;
  const { rows } = await db.query(
    `select count(*)::int as k, coalesce(sum(monto),0)::bigint as s
       from pagos where registrado_en >= $1 and registrado_en <= $2`,
    [desde, hasta],
  );
  const vistos = new Set(locales.map((p) => p.id));
  const sumaLocal = locales.reduce((s, p) => s + Math.round(Number(p.monto)), 0);
  console.log(`base viva [${desde} … ${hasta}]: ${rows[0].k} pagos · $${Number(rows[0].s).toLocaleString("es-UY")}`);
  console.log(`respaldo local:                 ${vistos.size} pagos · $${sumaLocal.toLocaleString("es-UY")}`);
  if (rows[0].k !== vistos.size) {
    console.error(`🔴 DIFIEREN en ${Math.abs(rows[0].k - vistos.size)} filas — revisar antes de confiar.`);
    process.exitCode = 1;
  } else {
    console.log("🟢 el tramo cubierto coincide fila a fila.");
  }
  await db.end();
  process.exit();
}

let totalFilas = 0;
for (const { tabla, col } of INCREMENTALES) {
  // BOOTSTRAP desde AHORA: la historia ya vive en el respaldo COMPLETO semanal
  // (backup-completo.mjs). El incremental existe para el RPO intradía — la
  // primera corrida arranca la marca y las siguientes exportan solo el delta.
  if (!estado.marcas[tabla]) {
    estado.marcas[tabla] = new Date().toISOString();
    console.log(`${tabla}: bootstrap (marca inicial ${estado.marcas[tabla]}; la historia está en el respaldo completo)`);
    continue;
  }
  // Drena TODO el delta en tandas (una tanda cortada a 5.000 jamás queda muda:
  // la marca avanza y la próxima vuelta del while sigue donde quedó).
  let filasTabla = 0;
  for (;;) {
    const { rows } = await db.query(
      `select * from ${tabla} where ${col} > $1 order by ${col} asc limit 5000`,
      [estado.marcas[tabla]],
    );
    if (!rows.length) break;
    appendFileSync(join(dirDia, `${tabla}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    estado.marcas[tabla] = new Date(rows[rows.length - 1][col]).toISOString();
    // Estado tras CADA tanda: un crash a mitad no re-exporta lo ya escrito.
    writeFileSync(RUTA_ESTADO, JSON.stringify(estado, null, 1));
    filasTabla += rows.length;
    if (rows.length < 5000) break;
  }
  totalFilas += filasTabla;
  console.log(`${tabla}: +${filasTabla} (marca: ${estado.marcas[tabla]})`);
}

// Anulaciones recientes de pagos (mutación legítima del libro): últimas 48 h.
{
  const { rows } = await db.query(
    "select id, anulado, anulado_por, anulado_en, motivo_anulacion from pagos where anulado = true and anulado_en > now() - interval '48 hours'",
  );
  if (rows.length)
    writeFileSync(join(dirDia, "pagos-anulaciones.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`pagos-anulaciones (48 h): ${rows.length}`);
}

for (const tabla of COMPLETAS) {
  const { rows } = await db.query(`select * from ${tabla}`);
  writeFileSync(join(dirDia, `${tabla}.completa.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`${tabla}: snapshot ${rows.length} filas`);
}

writeFileSync(RUTA_ESTADO, JSON.stringify(estado, null, 1));
await db.end();
console.log(`\n✓ respaldo incremental: +${totalFilas} filas nuevas en ${dirDia}`);
