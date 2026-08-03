// ─────────────────────────────────────────────────────────────────────────
//  RESPALDO LÓGICO COMPLETO de Presta Ya (datos + auth + inventario de storage).
//
//  Qué hace:
//   1. Enumera TODAS las tablas expuestas (OpenAPI de PostgREST — no una lista a
//      mano que se desactualiza cuando nace una tabla).
//   2. Descarga cada tabla completa, paginada con orden estable, a un archivo
//      `<tabla>.jsonl.gz` (una fila JSON por línea, comprimido).
//   3. Exporta los usuarios de AUTH (id/email/metadata — las contraseñas son
//      hashes internos de Supabase y NO salen por API; ver el runbook).
//   4. Lista los buckets de STORAGE con todos sus archivos (inventario). Con
//      `--con-archivos` además descarga los binarios.
//   5. Escribe `manifest.json` con conteos, bytes y SHA-256 de cada archivo, y
//      registra la corrida en `backups_log` (0126) para que el panel de Empalme
//      pueda gritar si los respaldos dejan de correr.
//
//  Uso:
//    node --env-file=.env.local scripts/backup-completo.mjs
//    node --env-file=.env.local scripts/backup-completo.mjs --con-archivos
//    node --env-file=.env.local scripts/backup-completo.mjs --destino "D:/respaldos"
//    node --env-file=.env.local scripts/backup-completo.mjs --retener 14
//
//  Después de cada respaldo correr SIEMPRE la verificación:
//    node --env-file=.env.local scripts/verificar-backup.mjs backups/<carpeta>
//
//  READ-ONLY sobre los datos (solo INSERTa su registro en backups_log).
//  La carpeta backups/ está en .gitignore: los datos de clientes JAMÁS van a git.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (usá --env-file=.env.local)");
  process.exit(1);
}
const db = createClient(URL_BASE, KEY, { auth: { persistSession: false } });

const arg = (f, d = null) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const CON_ARCHIVOS = process.argv.includes("--con-archivos");
const DESTINO = arg("--destino", "backups");
const RETENER = Number(arg("--retener", "0")) || 0;

// Límite duro de páginas por tabla (5M filas). Si se toca, el manifest queda
// marcado INCOMPLETO y la verificación FALLA — nunca un respaldo truncado mudo.
const MAX_PAGINAS = 5000;
const PAGINA = 1000;

const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
const DIR = join(DESTINO, stamp);
mkdirSync(join(DIR, "tablas"), { recursive: true });

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const manifest = {
  version: 2,
  corrido_en: new Date().toISOString(),
  origen_host: new globalThis.URL(URL_BASE).host,
  tablas: {},
  auth: null,
  storage: null,
  incompleto: false,
  advertencias: [],
};

// ── 1) Enumerar tablas por OpenAPI (la fuente de verdad de lo expuesto) ─────
async function listarTablas() {
  const r = await fetch(`${URL_BASE}/rest/v1/`, {
    headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
  });
  if (!r.ok) throw new Error(`OpenAPI ${r.status}`);
  const spec = await r.json();
  return Object.keys(spec.definitions ?? {}).sort();
}

// ── 2) Volcar una tabla completa con orden estable ──────────────────────────
const CANDIDATOS_ORDEN = ["id", "creado_en", "created_at", "clave", "fecha"];
async function volcarTabla(tabla) {
  // Detectar una columna de orden estable probando candidatos.
  let orden = null;
  for (const col of CANDIDATOS_ORDEN) {
    const { error } = await db.from(tabla).select(col).limit(1);
    if (!error) { orden = col; break; }
  }
  const lineas = [];
  let filas = 0;
  for (let p = 0; p < MAX_PAGINAS; p++) {
    let q = db.from(tabla).select("*");
    if (orden) q = q.order(orden, { ascending: true });
    const { data, error } = await q.range(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) throw new Error(`${tabla}: ${error.code} ${error.message}`);
    for (const fila of data ?? []) lineas.push(JSON.stringify(fila));
    filas += (data ?? []).length;
    if (!data || data.length < PAGINA) {
      const gz = gzipSync(Buffer.from(lineas.join("\n") + (lineas.length ? "\n" : ""), "utf8"));
      const archivo = `tablas/${tabla}.jsonl.gz`;
      writeFileSync(join(DIR, archivo), gz);
      manifest.tablas[tabla] = { filas, bytes: gz.length, sha256: sha256(gz), orden };
      // Sin orden estable y justo 1000 filas: no podemos garantizar completitud.
      if (!orden && filas >= PAGINA) {
        manifest.incompleto = true;
        manifest.advertencias.push(`${tabla}: ${filas} filas SIN columna de orden estable — puede estar truncada`);
      }
      return filas;
    }
    if (!orden) {
      // >1000 filas sin orden estable = paginación no confiable. Cortar y marcar.
      manifest.incompleto = true;
      manifest.advertencias.push(`${tabla}: supera ${PAGINA} filas sin orden estable — respaldo de esa tabla NO confiable`);
      return filas;
    }
  }
  manifest.incompleto = true;
  manifest.advertencias.push(`${tabla}: tocó el tope de ${MAX_PAGINAS} páginas — INCOMPLETA`);
  return filas;
}

// ── 3) Usuarios de auth ─────────────────────────────────────────────────────
async function volcarAuth() {
  const usuarios = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth: ${error.message}`);
    for (const u of data.users) {
      usuarios.push(JSON.stringify({
        id: u.id, email: u.email, phone: u.phone, created_at: u.created_at,
        email_confirmed_at: u.email_confirmed_at, banned_until: u.banned_until ?? null,
        user_metadata: u.user_metadata ?? {}, app_metadata: u.app_metadata ?? {},
      }));
    }
    if (data.users.length < 1000) break;
  }
  const gz = gzipSync(Buffer.from(usuarios.join("\n") + "\n", "utf8"));
  writeFileSync(join(DIR, "auth-users.jsonl.gz"), gz);
  manifest.auth = { usuarios: usuarios.length, bytes: gz.length, sha256: sha256(gz) };
  return usuarios.length;
}

// ── 4) Inventario (y opcionalmente binarios) de storage ─────────────────────
async function volcarStorage() {
  const { data: buckets, error } = await db.storage.listBuckets();
  if (error) { manifest.advertencias.push(`storage: ${error.message}`); return 0; }
  const inventario = [];
  let descargados = 0;
  for (const b of buckets ?? []) {
    // Recorrido BFS de carpetas (list() es por carpeta).
    const cola = [""];
    while (cola.length) {
      const prefijo = cola.shift();
      for (let off = 0; ; off += 1000) {
        const { data: items, error: e2 } = await db.storage.from(b.name).list(prefijo, { limit: 1000, offset: off });
        if (e2) { manifest.advertencias.push(`storage ${b.name}/${prefijo}: ${e2.message}`); break; }
        for (const it of items ?? []) {
          const ruta = prefijo ? `${prefijo}/${it.name}` : it.name;
          if (it.id == null) { cola.push(ruta); continue; } // carpeta
          inventario.push(JSON.stringify({ bucket: b.name, ruta, bytes: it.metadata?.size ?? null, actualizado: it.updated_at ?? null }));
          if (CON_ARCHIVOS) {
            const { data: blob, error: e3 } = await db.storage.from(b.name).download(ruta);
            if (e3) { manifest.advertencias.push(`descarga ${b.name}/${ruta}: ${e3.message}`); continue; }
            const destino = join(DIR, "storage", b.name, ruta.replace(/\//g, "__"));
            mkdirSync(join(DIR, "storage", b.name), { recursive: true });
            writeFileSync(destino, Buffer.from(await blob.arrayBuffer()));
            descargados++;
          }
        }
        if (!items || items.length < 1000) break;
      }
    }
  }
  const gz = gzipSync(Buffer.from(inventario.join("\n") + (inventario.length ? "\n" : ""), "utf8"));
  writeFileSync(join(DIR, "storage-inventario.jsonl.gz"), gz);
  manifest.storage = { archivos: inventario.length, descargados, sha256: sha256(gz) };
  return inventario.length;
}

// ── Correr ──────────────────────────────────────────────────────────────────
const t0 = Date.now();
console.log(`RESPALDO → ${DIR}  (origen: ${manifest.origen_host})`);

const tablas = await listarTablas();
console.log(`tablas expuestas: ${tablas.length}`);
let filasTotal = 0;
for (const t of tablas) {
  const filas = await volcarTabla(t);
  filasTotal += filas;
  console.log(`  ${t.padEnd(32)} ${String(filas).padStart(8)} filas`);
}
const nAuth = await volcarAuth();
console.log(`  ${"auth.users".padEnd(32)} ${String(nAuth).padStart(8)} usuarios`);
const nStorage = await volcarStorage();
console.log(`  ${"storage (inventario)".padEnd(32)} ${String(nStorage).padStart(8)} archivos${CON_ARCHIVOS ? " (binarios descargados)" : ""}`);

manifest.duracion_seg = Math.round((Date.now() - t0) / 1000);
manifest.filas_total = filasTotal;
const bytesTotal = Object.values(manifest.tablas).reduce((s, t) => s + t.bytes, 0) + (manifest.auth?.bytes ?? 0);
manifest.bytes_total = bytesTotal;
writeFileSync(join(DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

// Registro en la app (0126): si la tabla aún no existe, avisar sin romper.
try {
  const { error } = await db.from("backups_log").insert({
    origen: "script",
    tablas: tablas.length,
    filas_total: filasTotal,
    bytes: bytesTotal,
    destino: DIR,
    verificado: false, // lo marca verificar-backup.mjs
    incompleto: manifest.incompleto,
    detalle: { advertencias: manifest.advertencias, duracion_seg: manifest.duracion_seg, auth: nAuth, storage: nStorage },
  });
  if (error) throw error;
  console.log("registro en backups_log ✓");
} catch (e) {
  console.log(`⚠ no se registró en backups_log (${e.code ?? ""} ${e.message ?? e}) — ¿corrió la 0126?`);
}

// Retención local: conservar los últimos N (0 = no borrar nada).
if (RETENER > 0) {
  const carpetas = readdirSync(DESTINO).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort();
  for (const vieja of carpetas.slice(0, Math.max(0, carpetas.length - RETENER))) {
    rmSync(join(DESTINO, vieja), { recursive: true, force: true });
    console.log(`retención: borrado ${vieja}`);
  }
}

console.log(`\n${manifest.incompleto ? "🔴 RESPALDO INCOMPLETO — revisar advertencias del manifest" : "✅ Respaldo completo"}: ${filasTotal.toLocaleString("es-UY")} filas · ${(bytesTotal / 1024 / 1024).toFixed(1)} MB · ${manifest.duracion_seg}s`);
console.log(`Ahora VERIFICALO:  node --env-file=.env.local scripts/verificar-backup.mjs "${DIR}"`);
if (manifest.incompleto) process.exit(1);
