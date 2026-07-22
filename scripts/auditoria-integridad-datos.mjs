// ─────────────────────────────────────────────────────────────────────────
//  AUDITORÍA DE INTEGRIDAD DE DATOS (read-only). Extiende reconciliacion.mjs con
//  las preguntas que un equipo serio hace ANTES de abrir en manos reales:
//   1) Sobre-cobros: ¿cuántos en créditos ACTIVOS (riesgo vivo) vs FINALIZADOS
//      (baseline del import, benigno)? ¿cuánto $ de exposición?
//   2) Comisiones: ¿hay doble-liquidación HISTÓRICA (rangos solapados por cobrador)?
//   3) Anomalías de datos: montos ≤0, cuota/días inválidos, fechas imposibles,
//      documentos/disapp_id duplicados, créditos activos sin cobrador.
//   4) Caja: movimientos con monto ≤0 o sin op_id (idempotencia).
//  NO escribe nada. Sale 1 si hay hallazgos MATERIALES en créditos activos o
//  doble-comisión (lo accionable); el resto es informativo.
//    node --env-file=.env.local scripts/auditoria-integridad-datos.mjs
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Faltan credenciales."); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });

const N = (v) => Math.round(Number(v) || 0);
const $ = (n) => "$" + N(n).toLocaleString("es-UY");

async function traerTodo(tabla, select, filtro = (q) => q) {
  const out = [];
  const paso = 1000;
  for (let desde = 0; ; desde += paso) {
    let q = db.from(tabla).select(select).order("id", { ascending: true }).range(desde, desde + paso - 1);
    const { data, error } = await filtro(q);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < paso) break;
  }
  return out;
}

// ── Rango de fechas de una periodo_key (réplica de lib/data/comisiones) ─────
function rangoDePeriodoKey(key) {
  const [tipo, valor] = (key ?? "").split(":");
  if (!valor) return null;
  const fmt = (d) => d.toISOString().slice(0, 10);
  if (tipo === "dia") return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? { desde: valor, hasta: valor } : null;
  if (tipo === "semana") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
    return { desde: valor, hasta: fmt(new Date(new Date(`${valor}T00:00:00Z`).getTime() + 6 * 86400000)) };
  }
  if (tipo === "mes") {
    if (!/^\d{4}-\d{2}$/.test(valor)) return null;
    const [y, m] = valor.split("-").map(Number);
    const ult = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { desde: `${valor}-01`, hasta: `${valor}-${String(ult).padStart(2, "0")}` };
  }
  if (tipo === "anio") return /^\d{4}$/.test(valor) ? { desde: `${valor}-01-01`, hasta: `${valor}-12-31` } : null;
  return null;
}
const seSolapan = (a, b) => a.desde <= b.hasta && b.desde <= a.hasta;

console.log("⏳ Auditoría de integridad de datos — leyendo la base viva…\n");

// ═══════════ 1) SOBRE-COBROS por ESTADO + $ ═══════════
const prestamos = await traerTodo(
  "prestamos",
  "id, estado, cuota_diaria, total_dias, cobrador_id, cliente_id, fecha_inicio",
);
const idsPrestamo = new Set(prestamos.map((p) => p.id));

// Σ pagos vigentes por crédito (centavos exactos) + anomalías de pagos.
const sumaCent = new Map();
let pagosVigentes = 0, pagosMontoNoPos = 0, huerfanos = 0;
{
  const paso = 1000;
  for (let desde = 0; ; desde += paso) {
    const { data, error } = await db.from("pagos")
      .select("prestamo_id, monto, anulado").order("id", { ascending: true }).range(desde, desde + paso - 1);
    if (error) throw error;
    for (const p of data ?? []) {
      if (p.anulado) continue;
      sumaCent.set(p.prestamo_id, (sumaCent.get(p.prestamo_id) ?? 0) + Math.round(Number(p.monto) * 100));
      if (Number(p.monto) <= 0) pagosMontoNoPos++;
      if (!idsPrestamo.has(p.prestamo_id)) huerfanos++;
      pagosVigentes++;
    }
    if (!data || data.length < paso) break;
  }
}

const buckets = {}; // estado → { n, exceso$, materialN, material$, ids:[] }
const b = (e) => (buckets[e] ??= { n: 0, exceso: 0, materialN: 0, material: 0, ids: [] });
for (const p of prestamos) {
  const pagado = Math.round((sumaCent.get(p.id) ?? 0) / 100);
  const total = N(p.cuota_diaria) * Number(p.total_dias || 0);
  const exceso = pagado - total;
  if (exceso < 1) continue;
  const cuota = N(p.cuota_diaria);
  const material = (cuota > 0 && exceso >= cuota) || (total > 0 && exceso >= total * 0.05);
  const bk = b(p.estado || "?");
  bk.n++; bk.exceso += exceso;
  if (material) { bk.materialN++; bk.material += exceso; if (bk.ids.length < 8) bk.ids.push(`${p.id.slice(0, 8)} +${exceso}`); }
}
console.log("═══ 1) SOBRE-COBROS (pagado > total) por estado del crédito ═══");
let materialActivos = 0, materialActivos$ = 0;
for (const [estado, v] of Object.entries(buckets)) {
  const activo = estado === "activo";
  if (activo) { materialActivos = v.materialN; materialActivos$ = v.material; }
  console.log(`  ${estado.padEnd(11)}: ${v.n} crédito(s), exceso total ${$(v.exceso)} · MATERIAL ${v.materialN} (${$(v.material)})${v.materialN && activo ? "  ⚠️ RIESGO VIVO" : ""}`);
  if (v.materialN && activo) console.log(`      muestra: ${v.ids.join(" · ")}`);
}
console.log(`  → Sobre-cobro MATERIAL en créditos ACTIVOS: ${materialActivos} (${$(materialActivos$)}) ${materialActivos === 0 ? "✅ (los demás son baseline en finalizados)" : "⚠️ INVESTIGAR"}`);
console.log(`  → Pagos huérfanos: ${huerfanos} · pagos vigentes con monto ≤0: ${pagosMontoNoPos}`);

// ═══════════ 2) DOBLE-COMISIÓN HISTÓRICA (rangos solapados) ═══════════
console.log("\n═══ 2) COMISIONES: solapamiento histórico por cobrador (doble pago) ═══");
let comisSolapadas = 0;
try {
  const liq = await traerTodo("comisiones_liquidadas", "id, cobrador_id, periodo_key, monto");
  const porCob = new Map();
  for (const l of liq) {
    const r = rangoDePeriodoKey(l.periodo_key);
    if (!r) continue;
    let arr = porCob.get(l.cobrador_id);
    if (!arr) { arr = []; porCob.set(l.cobrador_id, arr); }
    arr.push({ ...r, key: l.periodo_key, monto: N(l.monto) });
  }
  for (const [cob, rangos] of porCob) {
    for (let i = 0; i < rangos.length; i++)
      for (let j = i + 1; j < rangos.length; j++)
        if (seSolapan(rangos[i], rangos[j])) {
          comisSolapadas++;
          console.log(`  ⚠️ cobrador ${cob.slice(0, 8)}: "${rangos[i].key}" (${$(rangos[i].monto)}) solapa "${rangos[j].key}" (${$(rangos[j].monto)})`);
        }
  }
  console.log(`  Liquidaciones: ${liq.length} · pares solapados: ${comisSolapadas} ${comisSolapadas === 0 ? "✅ (sin doble-pago histórico)" : "⚠️ REVISAR (posible egreso doble antes de 0083)"}`);
} catch (e) {
  console.log(`  (no se pudo leer comisiones_liquidadas: ${e.message})`);
}

// ═══════════ 3) ANOMALÍAS DE DATOS ═══════════
console.log("\n═══ 3) ANOMALÍAS DE DATOS ═══");
const hoy = new Date().toISOString().slice(0, 10);
let cuotaMala = 0, diasMalos = 0, fechaMala = 0, sinCobrador = 0;
for (const p of prestamos) {
  if (p.estado !== "activo") continue;
  if (N(p.cuota_diaria) <= 0) cuotaMala++;
  if (Number(p.total_dias || 0) <= 0) diasMalos++;
  const f = (p.fecha_inicio || "").slice(0, 10);
  if (f && (f < "2015-01-01" || f > hoy)) fechaMala++;
  if (!p.cobrador_id) sinCobrador++;
}
console.log(`  Créditos ACTIVOS con cuota_diaria ≤0: ${cuotaMala}`);
console.log(`  Créditos ACTIVOS con total_dias ≤0: ${diasMalos}`);
console.log(`  Créditos ACTIVOS con fecha_inicio imposible (<2015 o futura): ${fechaMala}`);
console.log(`  Créditos ACTIVOS sin cobrador asignado: ${sinCobrador}`);

// Duplicados de documento / disapp_id en clientes.
const clientes = await traerTodo("clientes", "id, documento, disapp_id, activo");
const dupDoc = new Map(), dupDisapp = new Map();
for (const c of clientes) {
  const d = (c.documento ?? "").trim();
  if (d) dupDoc.set(d, (dupDoc.get(d) ?? 0) + 1);
  if (c.disapp_id != null) dupDisapp.set(String(c.disapp_id), (dupDisapp.get(String(c.disapp_id)) ?? 0) + 1);
}
const docsDuplicados = [...dupDoc.values()].filter((n) => n > 1).length;
const disappDuplicados = [...dupDisapp.values()].filter((n) => n > 1).length;
console.log(`  Clientes: ${clientes.length} · documentos duplicados: ${docsDuplicados} · disapp_id duplicados: ${disappDuplicados}`);

// ═══════════ 4) CAJA: anomalías ═══════════
console.log("\n═══ 4) CAJA (movimientos_caja) ═══");
try {
  const mov = await traerTodo("movimientos_caja", "id, tipo, monto, op_id");
  const montoNoPos = mov.filter((m) => Number(m.monto) <= 0).length;
  const sinOpId = mov.filter((m) => !m.op_id).length;
  const porTipo = {};
  for (const m of mov) porTipo[m.tipo] = (porTipo[m.tipo] ?? 0) + N(m.monto);
  console.log(`  Movimientos: ${mov.length} · con monto ≤0: ${montoNoPos} · sin op_id (idempotencia): ${sinOpId}`);
  console.log(`  Neto por tipo:`, Object.fromEntries(Object.entries(porTipo).map(([k, v]) => [k, $(v)])));
} catch (e) {
  console.log(`  (no se pudo leer movimientos_caja: ${e.message})`);
}

// ═══════════ VEREDICTO ═══════════
console.log("\n════════ VEREDICTO ════════");
const accionable = materialActivos > 0 || comisSolapadas > 0 || huerfanos > 0 || pagosMontoNoPos > 0 || cuotaMala > 0 || diasMalos > 0;
if (!accionable) {
  console.log("✅ SIN HALLAZGOS ACCIONABLES: los sobre-cobros son baseline en finalizados, sin doble-comisión, sin anomalías materiales.");
  process.exit(0);
}
console.log("⚠️ Hay hallazgos accionables (ver arriba). Revisar antes/durante el piloto.");
process.exit(1);
