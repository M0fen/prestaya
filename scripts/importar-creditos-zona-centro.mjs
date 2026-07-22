// ─────────────────────────────────────────────────────────────────────────
//  IMPORTAR créditos faltantes de Zona Centro desde Disapp (paso B) + finalizar
//  los que Disapp cerró (refis, paso A-con-saldo). Deja nuestra cartera ACTIVA
//  de Zona Centro == la de Disapp. Idempotente y REVERSIBLE (log de revert).
//
//  DRY-RUN por defecto. Aplicar:  ... importar-creditos-zona-centro.mjs --commit
//  Revertir:                      ... importar-creditos-zona-centro.mjs --revertir scripts/_import_zc_revert_<ts>.json
//
//  Crea, por cada crédito activo de Disapp (vendedor de Zona Centro) que no
//  tengamos: el cliente (si falta, por disapp_id), el préstamo (estado activo,
//  con disapp_credit_id) y —si tiene pagos— un pago de ajuste 'recon-zc-<id>'
//  (el cartón usa el acumulado FIFO → saldo correcto). Y finaliza los créditos
//  nuestros activos-con-saldo que Disapp ya cerró (para no duplicar en refis).
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs";
import * as XLSXns from "xlsx";
import { createClient } from "@supabase/supabase-js";

const XLSX = XLSXns.read ? XLSXns : XLSXns.default;
const COMMIT = process.argv.includes("--commit");
const revIdx = process.argv.indexOf("--revertir");
const ZONA = "764c2556-4e2d-410a-b39a-63c6dbf984c3";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-UY");
const num = (s) => (s == null ? 0 : typeof s === "number" ? s : parseFloat(String(s).replace(/\./g, "").replace(",", ".")) || 0);
const FREC = { diaria: "diario", semanal: "semanal", quincenal: "quincenal", mensual: "mensual", personalizado: "diario" };
const fechaISO = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? "").trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// ── REVERTIR ─────────────────────────────────────────────────────────────────
if (revIdx >= 0) {
  const log = JSON.parse(readFileSync(process.argv[revIdx + 1], "utf8"));
  if (!COMMIT) { console.log(`Revertiría: ${log.creditos.length} créditos (+sus pagos), ${log.clientes.length} clientes, ${log.finalizados.length} finalizaciones. Agregá --commit.`); process.exit(0); }
  for (const cid of log.creditos) { await db.from("pagos").delete().eq("prestamo_id", cid); await db.from("prestamos").delete().eq("id", cid); }
  for (const cid of log.clientes) await db.from("clientes").delete().eq("id", cid);
  for (const f of log.finalizados) await db.from("prestamos").update({ estado: f.estado }).eq("id", f.id);
  console.log("✓ Revertido.");
  process.exit(0);
}

// ── Cobradores Zona Centro (vendedor → cobrador_id) ──────────────────────────
const { data: cobs } = await db.from("usuarios").select("id, disapp_vendedor_id").eq("rol", "cobrador").eq("zona_id", ZONA).eq("activo", true);
const vendACob = new Map(cobs.map((c) => [String(c.disapp_vendedor_id), c.id]));
const cobIds = cobs.map((c) => c.id);

// Nuestros disapp_credit_id (cualquier estado) de esos cobradores → para no duplicar.
const tenemos = new Set();
{ let d = 0; for (;;) { const { data } = await db.from("prestamos").select("disapp_credit_id").in("cobrador_id", cobIds).order("id").range(d, d + 999); for (const p of data ?? []) if (p.disapp_credit_id) tenemos.add(String(p.disapp_credit_id)); if (!data || data.length < 1000) break; d += 1000; } }
// clientes disapp_id → id
const cliDe = new Map();
{ let d = 0; for (;;) { const { data } = await db.from("clientes").select("id, disapp_id").not("disapp_id", "is", null).order("id").range(d, d + 999); for (const c of data ?? []) cliDe.set(String(c.disapp_id), c.id); if (!data || data.length < 1000) break; d += 1000; } }

// Nuestros activos-con-saldo que Disapp ya cerró (para finalizar; refis).
const disappActivosIds = new Set();
const wb = XLSX.read(readFileSync("creditos_2026-07-22_02-55.xlsx"));
const filas = XLSX.utils.sheet_to_json(wb.Sheets["Créditos"], { defval: null });
for (const r of filas) if (/activo/i.test(String(r["Estado"] ?? ""))) disappActivosIds.add(String(r["ID Crédito"] ?? "").trim());
const aFinalizar = [];
{ let d = 0; for (;;) { const { data } = await db.from("prestamos").select("id, disapp_credit_id, cuota_diaria, total_dias, pagado_acum").eq("estado", "activo").in("cobrador_id", cobIds).order("id").range(d, d + 999); for (const p of data ?? []) { const k = p.disapp_credit_id ? String(p.disapp_credit_id) : null; const total = Math.round(Number(p.cuota_diaria) * Number(p.total_dias || 0)); const pagado = Math.round(Number(p.pagado_acum) || 0); if (k && !disappActivosIds.has(k) && pagado < total) aFinalizar.push({ id: p.id, estado: "activo" }); } if (!data || data.length < 1000) break; d += 1000; } }

// ── Planear import de faltantes ──────────────────────────────────────────────
const crear = [];
const clientesACrear = new Map(); // disapp_id → datos
let saltadosPersonalizado = 0;
for (const r of filas) {
  if (!/activo/i.test(String(r["Estado"] ?? ""))) continue;
  const cob = vendACob.get(String(r["ID Vendedor"] ?? ""));
  if (!cob) continue; // no es de Zona Centro
  const cid = String(r["ID Crédito"] ?? "").trim();
  if (!cid || tenemos.has(cid)) continue; // ya lo tenemos
  const modal = String(r["Modalidad"] ?? "").toLowerCase();
  const frecuencia = FREC[modal] ?? "diario";
  if (modal === "personalizado") saltadosPersonalizado++;
  const cliDisapp = String(r["ID Cliente"] ?? "");
  crear.push({
    cid, ref: String(r["Crédito #"] ?? ""), cob, cliDisapp,
    principal: Math.round(num(r["Valor Crédito"])), total: Math.round(num(r["Total c/ Intereses"])),
    cuota: Math.round(num(r["Valor Cuota"])), cuotas: Number(r["Cuotas"]) || 0,
    pagos: Math.round(num(r["Pagos"])), fecha: fechaISO(r["Fecha Crédito"]), frecuencia,
    interes: Math.round(num(String(r["Tasa %"] ?? "0").replace("%", ""))),
  });
  if (!cliDe.has(cliDisapp) && !clientesACrear.has(cliDisapp))
    clientesACrear.set(cliDisapp, { disapp_id: cliDisapp, nombre: r["Cliente"], documento: r["Documento"] != null ? String(r["Documento"]) : null, telefono: r["Teléfono"] != null ? String(r["Teléfono"]) : null });
}

console.log(`\n${COMMIT ? "🔴 MODO COMMIT" : "🟡 DRY-RUN (no escribe)"}\n`);
console.log("═══ PLAN — Importar faltantes de Zona Centro ═══");
console.log(`  Créditos a CREAR: ${crear.length} (capital ${fmt(crear.reduce((s, c) => s + c.principal, 0))}, pagos ya hechos ${fmt(crear.reduce((s, c) => s + c.pagos, 0))})`);
console.log(`  Clientes a CREAR: ${clientesACrear.size} (los demás ya existen)`);
console.log(`  Créditos a FINALIZAR (activos-con-saldo que Disapp cerró = refis): ${aFinalizar.length}`);
console.log(`  Sin fecha válida: ${crear.filter((c) => !c.fecha).length} · modalidad 'Personalizado' (→diario): ${saltadosPersonalizado}`);
if (!COMMIT) { console.log("\n(DRY-RUN) Nada escrito. Aplicar: --commit. Se guardará un log para revertir."); process.exit(0); }

// ── Aplicar ──────────────────────────────────────────────────────────────────
const log = { creditos: [], clientes: [], finalizados: [] };
// 1) Clientes nuevos
for (const [disId, c] of clientesACrear) {
  const { data, error } = await db.from("clientes").insert({ nombre: c.nombre ?? "Cliente", documento: c.documento, telefono: c.telefono, disapp_id: disId, origen: "oficina", activo: true }).select("id").single();
  if (error) { console.error("✗ cliente", disId, error.message); continue; }
  cliDe.set(disId, data.id); log.clientes.push(data.id);
}
// 2) Créditos + pago de ajuste
let okC = 0, okP = 0;
for (const c of crear) {
  const clienteId = cliDe.get(c.cliDisapp);
  if (!clienteId) { console.error("✗ sin cliente", c.cid); continue; }
  const { data, error } = await db.from("prestamos").insert({
    cliente_id: clienteId, cobrador_id: c.cob, monto_prestado: c.principal, cuota_diaria: c.cuota,
    total_dias: c.cuotas, fecha_inicio: c.fecha ?? "2026-07-01", frecuencia: c.frecuencia, estado: "activo",
    interes_pct: c.interes, disapp_credit_id: c.cid, disapp_credit_ref: c.ref,
  }).select("id").single();
  if (error) { console.error("✗ crédito", c.cid, error.message); continue; }
  okC++; log.creditos.push(data.id);
  if (c.pagos > 0) {
    const { error: eP } = await db.from("pagos").insert({ prestamo_id: data.id, dia_credito: 1, monto: c.pagos, registrado_por: c.cob, registrado_en: (c.fecha ?? "2026-07-01") + "T12:00:00-03:00", anulado: false, disapp_pago_id: `recon-zc-${c.cid}`, origen: "reconciliacion_zc" });
    if (!eP) okP++;
  }
}
// 3) Finalizar refis
let okF = 0;
for (const f of aFinalizar) { const { error } = await db.from("prestamos").update({ estado: "finalizado" }).eq("id", f.id).eq("estado", "activo"); if (!error) { okF++; log.finalizados.push(f); } }

const logFile = `scripts/_import_zc_revert_${Date.now()}.json`;
writeFileSync(logFile, JSON.stringify(log, null, 1));
console.log(`\n✓ APLICADO: ${okC} créditos creados · ${okP} pagos de ajuste · ${log.clientes.length} clientes · ${okF} finalizados.`);
console.log(`  Log de revert: ${logFile}  (revertir: --revertir ${logFile} --commit)`);
console.log("  Verificá: node --env-file=.env.local scripts/reconciliacion-zona-centro.mjs");
