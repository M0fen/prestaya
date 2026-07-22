// ─────────────────────────────────────────────────────────────────────────
//  RECONCILIACIÓN DEL PILOTO (Zona Centro) vs Disapp — go/no-go. Cruce BIDIRECCIONAL
//  por crédito: nuestros activos de los cobradores de Zona Centro vs los activos de
//  Disapp de esos mismos vendedores (disapp_vendedor_id). Objetivo: CERO diferencias
//  en el segmento del piloto. Read-only. Lista exacta de qué corregir.
//    node --env-file=.env.local scripts/reconciliacion-zona-centro.mjs [archivo.xlsx]
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import * as XLSXns from "xlsx";
import { createClient } from "@supabase/supabase-js";

const XLSX = XLSXns.read ? XLSXns : XLSXns.default;
const archivo = process.argv[2] || "creditos_2026-07-22_02-55.xlsx";
const ZONA_CENTRO = "764c2556-4e2d-410a-b39a-63c6dbf984c3";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const fmt = (n) => "$" + Math.round(n).toLocaleString("es-UY");
const num = (s) => (s == null ? 0 : typeof s === "number" ? s : parseFloat(String(s).replace(/\./g, "").replace(",", ".")) || 0);

// ── 1) Cobradores de Zona Centro (id + vendedor Disapp) ─────────────────────
const { data: cobs, error: eC } = await db.from("usuarios")
  .select("id, nombre, disapp_vendedor_id").eq("rol", "cobrador").eq("zona_id", ZONA_CENTRO).eq("activo", true);
if (eC) throw eC;
const cobIds = new Set(cobs.map((c) => c.id));
const vendIds = new Set(cobs.map((c) => c.disapp_vendedor_id).filter(Boolean).map(String));
console.log(`Zona Centro: ${cobs.length} cobradores · ${vendIds.size} con vendedor Disapp`);
console.log("  " + cobs.map((c) => `${c.nombre}(v${c.disapp_vendedor_id ?? "?"})`).join(", ") + "\n");

// ── 2) Nuestros créditos ACTIVOS de esos cobradores ─────────────────────────
const nuestros = new Map(); // disapp_credit_id → {id, pagado, total, principal, cobrador}
let sinLink = 0;
{
  let d = 0;
  for (;;) {
    const { data, error } = await db.from("prestamos")
      .select("id, disapp_credit_id, cobrador_id, monto_prestado, cuota_diaria, total_dias, pagado_acum")
      .eq("estado", "activo").in("cobrador_id", [...cobIds]).order("id").range(d, d + 999);
    if (error) throw error;
    for (const p of data ?? []) {
      const k = p.disapp_credit_id ? String(p.disapp_credit_id).trim() : null;
      if (!k) { sinLink++; continue; }
      nuestros.set(k, { id: p.id, pagado: Math.round(Number(p.pagado_acum) || 0), total: Math.round(Number(p.cuota_diaria) * Number(p.total_dias || 0)), principal: Math.round(Number(p.monto_prestado) || 0), cobrador: p.cobrador_id });
    }
    if (!data || data.length < 1000) break;
    d += 1000;
  }
}
console.log(`Nuestros activos en Zona Centro: ${nuestros.size} (con link) + ${sinLink} sin disapp_id`);

// ── 3) Disapp activos de esos vendedores ────────────────────────────────────
const wb = XLSX.read(readFileSync(archivo));
const filas = XLSX.utils.sheet_to_json(wb.Sheets["Créditos"] ?? wb.Sheets[wb.SheetNames[0]], { defval: null });
const disappCentro = new Map(); // ID Crédito → {pagos,total,principal,saldo,cliente}
const disappTodos = new Map();  // todos los activos (para saber si un crédito nuestro sigue activo en Disapp)
for (const r of filas) {
  if (!/activo/i.test(String(r["Estado"] ?? ""))) continue;
  const id = String(r["ID Crédito"] ?? "").trim();
  if (!id) continue;
  const rec = { pagos: num(r["Pagos"]), total: num(r["Total c/ Intereses"]), principal: num(r["Valor Crédito"]), saldo: num(r["Saldo Pendiente"]), cliente: r["Cliente"] };
  disappTodos.set(id, rec);
  if (vendIds.has(String(r["ID Vendedor"] ?? "").trim())) disappCentro.set(id, rec);
}
console.log(`Disapp activos de vendedores Zona Centro: ${disappCentro.size}\n`);

// ── 4) Cruce ────────────────────────────────────────────────────────────────
const difPago = [], soloNuestros = [], soloDisapp = [];
for (const [id, n] of nuestros) {
  const d = disappTodos.get(id); // ¿sigue activo en Disapp (cualquier vendedor)?
  if (!d) { soloNuestros.push({ id, ...n }); continue; }
  const dif = n.pagado - d.pagos;
  if (Math.abs(dif) >= 1) difPago.push({ id, dif, nuestro: n.pagado, disapp: d.pagos, cli: d.cliente });
}
for (const [id, d] of disappCentro) if (!nuestros.has(id)) soloDisapp.push({ id, ...d });

difPago.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
console.log("═══ RESULTADO — PILOTO (Zona Centro) ═══");

// A) split: saldados (pagado>=total, benigno) vs con saldo (riesgo refi/sobre-cobro).
const aSaldados = soloNuestros.filter((c) => c.pagado >= c.total);
const aConSaldo = soloNuestros.filter((c) => c.pagado < c.total);
console.log(`\nA) Nuestros ACTIVOS que YA NO están activos en Disapp: ${soloNuestros.length}`);
console.log(`   · ${aSaldados.length} ya SALDADOS (pagado≥total) → benigno: solo hay que finalizarlos (el cobrador no cobra un cartón completo).`);
console.log(`   · ${aConSaldo.length} CON SALDO ($${aConSaldo.reduce((s, c) => s + (c.total - c.pagado), 0).toLocaleString("es-UY")} pendiente) → ⚠️ RIESGO REAL: Disapp los cerró/refinanció; si el cobrador cobra, sobre-cobro.`);
for (const c of aConSaldo.slice(0, 15)) console.log(`       · ${c.id} pagado ${fmt(c.pagado)} / total ${fmt(c.total)} (falta ${fmt(c.total - c.pagado)})`);

// B) split: nuevos sin pagos (recién creados) vs con pagos (parcial, falta importar).
const bNuevos = soloDisapp.filter((c) => c.pagos <= 0);
const bParciales = soloDisapp.filter((c) => c.pagos > 0);
console.log(`\nB) Activos de Zona Centro en Disapp que NO tenemos: ${soloDisapp.length} (capital ${fmt(soloDisapp.reduce((s, c) => s + c.principal, 0))})`);
console.log(`   · ${bNuevos.length} SIN pagos → créditos NUEVOS de Disapp sin importar (el cobrador no los ve → sub-cobro).`);
console.log(`   · ${bParciales.length} CON pagos ($${bParciales.reduce((s, c) => s + c.pagos, 0).toLocaleString("es-UY")}) → en curso, sin importar.`);

console.log(`\nC) En AMBOS con diferencia de PAGOS: ${difPago.length} · neto ${fmt(difPago.reduce((s, x) => s + x.dif, 0))}`);
const cInflados = difPago.filter((x) => x.dif < 0); // nuestro < Disapp → saldo inflado en nuestra app → sobre-cobro
console.log(`   · ${cInflados.length} con saldo INFLADO en nuestra app (Disapp cobró más) → ⚠️ el cliente pagó pero le seguimos pidiendo. Falta importar ${fmt(-cInflados.reduce((s, x) => s + x.dif, 0))} en pagos.`);
for (const x of difPago.slice(0, 15)) console.log(`       · ${x.id} ${String(x.cli ?? "").slice(0, 20).padEnd(20)} nuestro ${fmt(x.nuestro).padStart(10)} vs Disapp ${fmt(x.disapp).padStart(10)} → ${x.dif > 0 ? "+" : ""}${fmt(x.dif)}`);

console.log("\n═══ VEREDICTO PILOTO (Zona Centro) ═══");
console.log(`  Para dejar el segmento PERFECTO hay que:`);
console.log(`   1) Finalizar ${aSaldados.length} créditos ya saldados (+ revisar ${aConSaldo.length} con saldo: ¿refi en Disapp?).`);
console.log(`   2) Importar ${soloDisapp.length} créditos de Disapp que faltan (${bNuevos.length} nuevos + ${bParciales.length} en curso).`);
console.log(`   3) Ajustar pagos de ${cInflados.length} créditos con saldo inflado (importar ${fmt(-cInflados.reduce((s, x) => s + x.dif, 0))}).`);
