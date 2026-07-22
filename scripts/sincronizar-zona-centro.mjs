// ─────────────────────────────────────────────────────────────────────────
//  SINCRONIZAR ZONA CENTRO (piloto) con Disapp — método DELTA, idempotente y
//  reversible. Deja el saldo de cada cliente EXACTO al de Disapp.
//
//  DRY-RUN por defecto: NO escribe nada, solo muestra el plan. Para aplicar:
//    node --env-file=.env.local scripts/sincronizar-zona-centro.mjs --commit
//  Revertir (borra solo los ajustes 'recon-zc-*'):
//    node --env-file=.env.local scripts/sincronizar-zona-centro.mjs --revertir
//
//  Qué hace (idempotente por disapp_pago_id='recon-zc-<credito>'):
//   C) Créditos con saldo INFLADO (Disapp cobró más): agrega 1 pago de ajuste por
//      la diferencia → el cartón (que usa el acumulado, FIFO) queda correcto.
//   A) Créditos ya SALDADOS que Disapp cerró: los finaliza (estado='finalizado').
//  NO toca: créditos con saldo que Disapp cerró (posible refi → revisión manual) ni
//  la creación de créditos nuevos de Disapp (B, paso aparte).
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import * as XLSXns from "xlsx";
import { createClient } from "@supabase/supabase-js";

const XLSX = XLSXns.read ? XLSXns : XLSXns.default;
const COMMIT = process.argv.includes("--commit");
const REVERTIR = process.argv.includes("--revertir");
const archivo = process.argv.find((a) => a.endsWith(".xlsx")) || "creditos_2026-07-22_02-55.xlsx";
const ZONA_CENTRO = "764c2556-4e2d-410a-b39a-63c6dbf984c3";
const FECHA_AJUSTE = "2026-07-22T12:00:00-03:00"; // fecha del snapshot de Disapp
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const fmt = (n) => "$" + Math.round(n).toLocaleString("es-UY");
const num = (s) => (s == null ? 0 : typeof s === "number" ? s : parseFloat(String(s).replace(/\./g, "").replace(",", ".")) || 0);
const nonce = (id) => `recon-zc-${id}`;

// ── Revertir: borra los ajustes recon-zc-* (reversibilidad total) ────────────
if (REVERTIR) {
  if (!COMMIT) { console.log("Revertir es destructivo: agregá --commit para confirmar. (Borraría los pagos recon-zc-*.)"); process.exit(0); }
  const { data, error } = await db.from("pagos").delete().ilike("disapp_pago_id", "recon-zc-%").select("id");
  if (error) throw error;
  console.log(`✓ Revertidos: ${data?.length ?? 0} pagos de ajuste 'recon-zc-*' eliminados.`);
  process.exit(0);
}

// ── Cobradores Zona Centro ───────────────────────────────────────────────────
const { data: cobs } = await db.from("usuarios").select("id, disapp_vendedor_id").eq("rol", "cobrador").eq("zona_id", ZONA_CENTRO).eq("activo", true);
const cobIds = cobs.map((c) => c.id);

// ── Nuestros activos de Zona Centro ──────────────────────────────────────────
const nuestros = new Map();
{ let d = 0; for (;;) { const { data, error } = await db.from("prestamos").select("id, disapp_credit_id, cobrador_id, cuota_diaria, total_dias, pagado_acum").eq("estado", "activo").in("cobrador_id", cobIds).order("id").range(d, d + 999); if (error) throw error; for (const p of data ?? []) { const k = p.disapp_credit_id ? String(p.disapp_credit_id).trim() : null; if (k) nuestros.set(k, { id: p.id, cobrador: p.cobrador_id, pagado: Math.round(Number(p.pagado_acum) || 0), total: Math.round(Number(p.cuota_diaria) * Number(p.total_dias || 0)) }); } if (!data || data.length < 1000) break; d += 1000; } }

// ── Disapp activos (todos) ───────────────────────────────────────────────────
const wb = XLSX.read(readFileSync(archivo));
const disapp = new Map();
for (const r of XLSX.utils.sheet_to_json(wb.Sheets["Créditos"] ?? wb.Sheets[wb.SheetNames[0]], { defval: null })) {
  if (!/activo/i.test(String(r["Estado"] ?? ""))) continue;
  const id = String(r["ID Crédito"] ?? "").trim();
  if (id) disapp.set(id, { pagos: num(r["Pagos"]), total: num(r["Total c/ Intereses"]) });
}

// ── Planificar ───────────────────────────────────────────────────────────────
const ajustes = [];   // C) pagos de ajuste
const finalizar = []; // A) saldados a finalizar
for (const [cid, n] of nuestros) {
  const d = disapp.get(cid);
  if (d) {
    const delta = Math.round(d.pagos) - n.pagado; // + = Disapp cobró más → falta en nuestra app
    if (delta > 0) ajustes.push({ creditoId: n.id, cid, cobrador: n.cobrador, delta, nuestro: n.pagado, disapp: Math.round(d.pagos), sobrepasa: n.pagado + delta > n.total });
  } else if (n.pagado >= n.total && n.total > 0) {
    finalizar.push({ creditoId: n.id, cid, pagado: n.pagado, total: n.total });
  }
}
const totalAjuste = ajustes.reduce((s, a) => s + a.delta, 0);
const sobrepasan = ajustes.filter((a) => a.sobrepasa);

console.log(`\n${COMMIT ? "🔴 MODO COMMIT (va a ESCRIBIR)" : "🟡 DRY-RUN (no escribe nada)"}\n`);
console.log("═══ PLAN DE SINCRONIZACIÓN — Zona Centro ═══");
console.log(`\nC) Ajuste de pagos (saldo inflado → el cliente ya pagó):`);
console.log(`   ${ajustes.length} créditos · total a agregar ${fmt(totalAjuste)} en pagos de ajuste 'recon-zc-*'`);
console.log(`   ${sobrepasan.length} sobrepasarían el total nuestro (total distinto a Disapp) → se capean al total y se listan:`);
for (const a of sobrepasan.slice(0, 10)) console.log(`      · ${a.cid} nuestro ${fmt(a.nuestro)} + ${fmt(a.delta)} > total ${fmt(nuestros.get(a.cid).total)}`);
console.log(`\nA) Créditos saldados a FINALIZAR (Disapp los cerró, pagado≥total):`);
console.log(`   ${finalizar.length} créditos → estado 'finalizado'`);

if (!COMMIT) {
  console.log("\n(DRY-RUN) No se escribió nada. Revisá el plan. Para aplicar: agregá --commit. Para revertir: --revertir --commit.");
  process.exit(0);
}

// ── Aplicar (idempotente) ────────────────────────────────────────────────────
let insertados = 0, saltados = 0, finalizados = 0;
for (const a of ajustes) {
  const dapId = nonce(a.cid);
  const { data: ya } = await db.from("pagos").select("id").eq("disapp_pago_id", dapId).limit(1);
  if (ya && ya.length) { saltados++; continue; }
  // Capea para no crear un sobre-cobro en NUESTRO sistema (si el total difiere).
  const monto = Math.min(a.delta, Math.max(0, nuestros.get(a.cid).total - a.nuestro)) || a.delta;
  const { error } = await db.from("pagos").insert({
    prestamo_id: a.creditoId, dia_credito: 1, monto, registrado_por: a.cobrador,
    registrado_en: FECHA_AJUSTE, anulado: false, disapp_pago_id: dapId, origen: "reconciliacion_zc",
  });
  if (error) { console.error("✗", a.cid, error.message); continue; }
  insertados++;
}
for (const f of finalizar) {
  const { error } = await db.from("prestamos").update({ estado: "finalizado" }).eq("id", f.creditoId).eq("estado", "activo");
  if (!error) finalizados++;
}
console.log(`\n✓ APLICADO: ${insertados} ajustes insertados · ${saltados} ya existían (idempotente) · ${finalizados} créditos finalizados.`);
console.log("Verificá con: node --env-file=.env.local scripts/reconciliacion-zona-centro.mjs");
