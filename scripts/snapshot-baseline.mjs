// ─────────────────────────────────────────────────────────────────────────
//  PUNTO DE REFERENCIA (baseline T0) — captura una FOTO INMUTABLE del estado por
//  crédito en el momento de arrancar el parallel run de una zona. Ver
//  docs/RUNBOOK-TRANSICION-DISAPP.md §2 y la migración 0091.
//
//  READ-ONLY sobre la plata: NO toca pagos/prestamos. Solo INSERTA en las tablas de
//  snapshot (append-only). Idempotente por (label, prestamo_id): re-correr con el
//  mismo label no duplica (upsert onConflict).
//
//  Uso:
//    node --env-file=.env.local scripts/snapshot-baseline.mjs --label t0-centro [--zona <uuid>] [--src <creditos_*.xlsx>] [--commit]
//  Sin --commit = DRY-RUN (muestra el resumen, no escribe). --src = export de Disapp
//  para congelar también el lado Disapp (columna "Pagos"). Sin --src, el lado Disapp
//  queda NULL (igual sirve como ancla del lado app).
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const has = (k) => process.argv.includes(k);

const LABEL = arg("--label");
const ZONA = arg("--zona");                 // opcional: acotar a una zona
const SRC = arg("--src") || process.argv.find((a) => a.endsWith(".xlsx")) || null;
const COMMIT = has("--commit");

if (!LABEL) { console.error("Falta --label (ej: --label t0-centro-2026-08-01)"); process.exit(1); }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-UY")}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── 1) Mapa cobrador → zona (para etiquetar cada crédito con su zona) ───────
const zonaDe = new Map();
{
  let d = 0;
  for (;;) {
    const { data, error } = await db.from("usuarios").select("id, zona_id").order("id").range(d, d + 999);
    if (error) throw error;
    for (const u of data ?? []) zonaDe.set(u.id, u.zona_id ?? null);
    if (!data || data.length < 1000) break;
    d += 1000;
  }
}

// ── 2) Lado DISAPP: leer el export si se pasó (pagos por crédito) ───────────
//     Se importa la lib xlsx solo si hace falta (no forzar la dependencia en dry sin src).
const disappPorId = new Map();   // disapp_credit_id → { pagos, saldo }
const disappPorRef = new Map();  // disapp_credit_ref → { pagos, saldo }
let exportTs = null;
if (SRC) {
  const XLSXns = await import("xlsx");
  const XLSX = XLSXns.read ? XLSXns : XLSXns.default;
  const wb = XLSX.read(readFileSync(SRC));
  const hoja = wb.Sheets["Créditos"] ?? wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { defval: null });
  // Detección defensiva de columnas (los nombres de Disapp pueden variar levemente).
  const keys = filas.length ? Object.keys(filas[0]) : [];
  const col = (frag) => keys.find((k) => k.toLowerCase().includes(frag));
  const cId = col("id crédito") || col("id credito") || col("idcrédito");
  const cRef = col("crédito #") || col("credito #") || col("ref");
  const cPagos = col("pagos");
  const cSaldo = col("saldo");
  const parseNum = (v) => {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    // Texto uruguayo "6.000,00" → 6000.00
    return Number(String(v).replace(/\./g, "").replace(",", ".")) || 0;
  };
  for (const r of filas) {
    const pagos = round2(parseNum(cPagos ? r[cPagos] : 0));
    const saldo = round2(parseNum(cSaldo ? r[cSaldo] : 0));
    const rec = { pagos, saldo };
    if (cId && r[cId] != null) disappPorId.set(String(r[cId]).trim(), rec);
    if (cRef && r[cRef] != null) disappPorRef.set(String(r[cRef]).trim(), rec);
  }
  // timestamp del export = del nombre del archivo si se puede, si no now.
  const m = SRC.match(/(\d{4}-\d{2}-\d{2})/);
  exportTs = m ? `${m[1]}T12:00:00-03:00` : null;
  console.log(`Disapp export: ${filas.length} créditos leídos de ${SRC} (por id: ${disappPorId.size}, por ref: ${disappPorRef.size})`);
}

// ── 3) Lado APP: recorrer prestamos (paginado order=id) y armar la foto ─────
const filasSnap = [];
let d = 0;
for (;;) {
  const { data, error } = await db
    .from("prestamos")
    .select("id, disapp_credit_id, disapp_credit_ref, cliente_id, cobrador_id, estado, cuota_diaria, total_dias, pagado_acum")
    .order("id")
    .range(d, d + 999);
  if (error) throw error;
  for (const p of data ?? []) {
    const zona = zonaDe.get(p.cobrador_id) ?? null;
    if (ZONA && zona !== ZONA) continue; // acotar a la zona pedida
    const cuota = round2(p.cuota_diaria);
    const dias = Number(p.total_dias) || 0;
    const totalAPagar = round2(cuota * dias);
    const pagado = round2(p.pagado_acum);
    const saldo = round2(totalAPagar - pagado);
    // Cruce con Disapp: por id, si no por ref.
    const cid = p.disapp_credit_id ? String(p.disapp_credit_id).trim() : null;
    const cref = p.disapp_credit_ref ? String(p.disapp_credit_ref).trim() : null;
    const dz = (cid && disappPorId.get(cid)) || (cref && disappPorRef.get(cref)) || null;
    filasSnap.push({
      label: LABEL,
      prestamo_id: p.id,
      disapp_credit_id: cid,
      disapp_credit_ref: cref,
      cliente_id: p.cliente_id,
      cobrador_id: p.cobrador_id,
      zona_id: zona,
      estado: p.estado,
      cuota_diaria: cuota,
      total_dias: dias,
      total_a_pagar: totalAPagar,
      pagado_acum: pagado,
      saldo,
      // n_pagos / ultimo_pago_en: NULL en v1 (el ancla es pagado_acum; se pueden
      // agregar luego con un scan del libro). Ver runbook §12.
      n_pagos: null,
      ultimo_pago_en: null,
      disapp_pagos: dz ? dz.pagos : null,
      disapp_saldo: dz ? dz.saldo : null,
      export_file: SRC,
      export_ts: exportTs,
    });
  }
  if (!data || data.length < 1000) break;
  d += 1000;
}

// ── 4) Totales de control por zona ─────────────────────────────────────────
const porZona = new Map();
const clientesPorZona = new Map();
for (const f of filasSnap) {
  const z = f.zona_id ?? "sin-zona";
  const t = porZona.get(z) ?? { n_creditos: 0, cartera: 0, pagado: 0, disapp_pagos: 0, conDisapp: false };
  t.n_creditos++; t.cartera += f.saldo; t.pagado += f.pagado_acum;
  if (f.disapp_pagos != null) { t.disapp_pagos += f.disapp_pagos; t.conDisapp = true; }
  porZona.set(z, t);
  (clientesPorZona.get(z) ?? clientesPorZona.set(z, new Set()).get(z)).add(f.cliente_id);
}
const totales = [...porZona.entries()].map(([z, t]) => ({
  label: LABEL,
  zona_id: z === "sin-zona" ? null : z,
  cobrador_id: null,
  n_creditos: t.n_creditos,
  n_clientes: clientesPorZona.get(z)?.size ?? 0,
  cartera: round2(t.cartera),
  pagado: round2(t.pagado),
  disapp_pagos: t.conDisapp ? round2(t.disapp_pagos) : null,
  source: "app",
}));

// ── 5) Resumen ─────────────────────────────────────────────────────────────
console.log(`\n═══ Baseline T0  ·  label=${LABEL}  ·  ${COMMIT ? "COMMIT" : "DRY-RUN"} ═══`);
console.log(`Créditos en la foto: ${filasSnap.length}${ZONA ? ` (zona ${ZONA})` : " (todas las zonas)"}`);
for (const t of totales) {
  console.log(`  zona ${t.zona_id ?? "—"}: ${t.n_creditos} créditos · ${t.n_clientes} clientes · cartera ${money(t.cartera)} · pagado ${money(t.pagado)}${t.disapp_pagos != null ? ` · Disapp pagos ${money(t.disapp_pagos)} (Δ ${money(t.pagado - t.disapp_pagos)})` : ""}`);
}

if (!COMMIT) {
  console.log("\nDRY-RUN: no se escribió nada. Agregá --commit para persistir el punto de referencia.");
  process.exit(0);
}

// ── 6) Persistir (idempotente por label+prestamo_id) ───────────────────────
let escritas = 0;
for (let i = 0; i < filasSnap.length; i += 500) {
  const lote = filasSnap.slice(i, i + 500);
  const { error } = await db.from("snapshot_credito").upsert(lote, { onConflict: "label,prestamo_id", ignoreDuplicates: false });
  if (error) { console.error("Error snapshot_credito:", error.message); process.exit(1); }
  escritas += lote.length;
}
// Totales: se re-insertan (no hay unique). Para no acumular en re-corridas, borrar los
// del mismo label primero — pero snapshot_totales no tiene delete por RLS; con service_role
// sí. Para mantener la inmutabilidad conceptual, insertamos una corrida nueva (corrida_en
// distingue). En la práctica se corre una vez por label.
const { error: eTot } = await db.from("snapshot_totales").insert(totales);
if (eTot) { console.error("Error snapshot_totales:", eTot.message); process.exit(1); }

console.log(`\n✅ Baseline persistido: ${escritas} créditos + ${totales.length} totales por zona (label=${LABEL}).`);
console.log("Ese es tu punto de referencia. Medí divergencias con: node --env-file=.env.local scripts/divergencia-vs-baseline.mjs --label " + LABEL);
process.exit(0);
