// ─────────────────────────────────────────────────────────────────────────
//  DIVERGENCIA vs PUNTO DE REFERENCIA — mide la app de HOY contra un baseline T0
//  congelado (tabla snapshot_credito, ver 0091 y snapshot-baseline.mjs). Da lo que
//  shadow-disapp.py NO puede: la deriva ACUMULADA desde el arranque del parallel
//  run, no contra el export de Disapp de hoy. Ver docs/RUNBOOK-TRANSICION-DISAPP.md §2.
//
//  100% READ-ONLY (no escribe nada). Uso:
//    node --env-file=.env.local scripts/divergencia-vs-baseline.mjs --label t0-centro [--zona <uuid>] [--top 20]
//
//  Reporta por zona:
//   · Δpagado total (positivo = cobranza normal desde T0; NEGATIVO = anomalía: bajó el
//     pagado de un crédito → se anuló/corrigió un pago; a revisar).
//   · créditos NUEVOS desde T0 (no estaban en la foto).
//   · créditos FINALIZADOS/refinanciados desde T0.
//   · top N créditos por |Δpagado| para inspección.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const LABEL = arg("--label");
const ZONA = arg("--zona");
const TOP = Number(arg("--top")) || 20;
if (!LABEL) { console.error("Falta --label (ej: --label t0-centro-2026-08-01)"); process.exit(1); }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(url, key, { auth: { persistSession: false } });
const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-UY")}`;

// ── 1) Foto T0 (snapshot_credito del label) ────────────────────────────────
const t0 = new Map(); // prestamo_id → { pagado, estado, zona, cliente }
{
  let d = 0;
  for (;;) {
    let q = db.from("snapshot_credito")
      .select("prestamo_id, pagado_acum, estado, zona_id, cliente_id")
      .eq("label", LABEL).order("prestamo_id").range(d, d + 999);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data ?? []) {
      if (ZONA && r.zona_id !== ZONA) continue;
      t0.set(r.prestamo_id, { pagado: Number(r.pagado_acum) || 0, estado: r.estado, zona: r.zona_id, cliente: r.cliente_id });
    }
    if (!data || data.length < 1000) break;
    d += 1000;
  }
}
if (t0.size === 0) { console.error(`No hay snapshot para label=${LABEL}${ZONA ? ` zona=${ZONA}` : ""}. ¿Corriste snapshot-baseline.mjs --commit?`); process.exit(1); }
console.log(`Baseline T0 (${LABEL}): ${t0.size} créditos${ZONA ? ` en zona ${ZONA}` : ""}.`);

// ── 2) Estado de HOY (prestamos vivos) ─────────────────────────────────────
const hoy = new Map(); // prestamo_id → { pagado, estado, zona }
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
{
  let d = 0;
  for (;;) {
    const { data, error } = await db.from("prestamos").select("id, cobrador_id, estado, pagado_acum").order("id").range(d, d + 999);
    if (error) throw error;
    for (const p of data ?? []) hoy.set(p.id, { pagado: Number(p.pagado_acum) || 0, estado: p.estado, zona: zonaDe.get(p.cobrador_id) ?? null });
    if (!data || data.length < 1000) break;
    d += 1000;
  }
}

// ── 3) Comparar ────────────────────────────────────────────────────────────
const porZona = new Map();
const zt = (z) => { const k = z ?? "sin-zona"; if (!porZona.has(k)) porZona.set(k, { deltaPos: 0, deltaNeg: 0, nAnomalias: 0, nuevos: 0, finalizados: 0 }); return porZona.get(k); };
const detalle = []; // { prestamo, zona, delta }

for (const [id, base] of t0) {
  const h = hoy.get(id);
  const t = zt(base.zona);
  if (!h) { continue; } // en T0 pero no hoy (raro: prestamos no se borran)
  const delta = Math.round((h.pagado - base.pagado) * 100) / 100;
  if (delta > 0) t.deltaPos += delta;
  if (delta < 0) { t.deltaNeg += delta; t.nAnomalias++; } // pagado BAJÓ = a revisar
  if (base.estado === "activo" && h.estado !== "activo") t.finalizados++;
  if (delta !== 0) detalle.push({ prestamo: id, zona: base.zona, delta, base: base.pagado, hoy: h.pagado });
}
// Créditos NUEVOS desde T0 (en hoy, no en la foto), acotados a la zona pedida.
for (const [id, h] of hoy) {
  if (t0.has(id)) continue;
  if (ZONA && h.zona !== ZONA) continue;
  zt(h.zona).nuevos++;
}

// ── 4) Reporte ─────────────────────────────────────────────────────────────
console.log(`\n═══ Divergencia app-HOY vs baseline ${LABEL} ═══`);
for (const [z, t] of porZona) {
  console.log(`\n  zona ${z}:`);
  console.log(`    Δpagado (cobranza desde T0): +${money(t.deltaPos)}`);
  if (t.deltaNeg < 0) console.log(`    ⚠️  Δpagado NEGATIVO (pagos que bajaron): ${money(t.deltaNeg)} en ${t.nAnomalias} crédito(s) — REVISAR (¿anulaciones?)`);
  console.log(`    créditos nuevos desde T0: ${t.nuevos} · finalizados/refi desde T0: ${t.finalizados}`);
}

// Top por |Δ|.
detalle.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
if (detalle.length) {
  console.log(`\n  Top ${Math.min(TOP, detalle.length)} créditos por |Δpagado|:`);
  for (const d2 of detalle.slice(0, TOP)) {
    console.log(`    ${d2.prestamo}  zona ${d2.zona ?? "—"}  Δ ${d2.delta >= 0 ? "+" : ""}${money(d2.delta)}  (T0 ${money(d2.base)} → hoy ${money(d2.hoy)})`);
  }
}
console.log("\n(Read-only: no se escribió nada.)");
process.exit(0);
