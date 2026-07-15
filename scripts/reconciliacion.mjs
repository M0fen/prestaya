// ─────────────────────────────────────────────────────────────────────────
//  RECONCILIACIÓN DIARIA de dinero — corre las invariantes de lib/reconciliacion
//  contra la base viva y reporta si la plata CUADRA. Pensado para correr cada
//  mañana (manual o por cron): si algo no cuadra, es un incidente para revisar.
//
//    node --env-file=.env.local scripts/reconciliacion.mjs
//
//  NO escribe nada: solo LEE y verifica. Sale con código 1 si hay hallazgos
//  (para que un cron/CI lo detecte).
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { reconciliar, invRecaudoDia, invHuerfanos } from "../lib/reconciliacion.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

/** Trae TODAS las filas de una tabla (paginado estable por id) — nunca trunca. */
async function traerTodo(tabla, select, filtro = (q) => q) {
  const out = [];
  const paso = 1000;
  for (let desde = 0; ; desde += paso) {
    let q = db.from(tabla).select(select).order("id", { ascending: true }).range(desde, desde + paso - 1);
    q = filtro(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < paso) break;
  }
  return out;
}

const N = (v) => Math.round(Number(v) || 0);

console.log("⏳ Reconciliación de dinero — leyendo la base…");

// 1) Créditos: id, estado, cuota, días, pagado_acum (denormalizado).
const prestamos = await traerTodo("prestamos", "id, estado, cuota_diaria, total_dias, pagado_acum");
console.log(`   créditos: ${prestamos.length}`);

// 2) Σ pagos VIGENTES por préstamo (recalculado desde el libro inmutable).
const sumaPagos = new Map();
let pagosVigentes = 0;
const idsPrestamo = new Set(prestamos.map((p) => p.id));
let huerfanos = 0;
{
  const paso = 1000;
  for (let desde = 0; ; desde += paso) {
    const { data, error } = await db
      .from("pagos")
      .select("prestamo_id, monto")
      .eq("anulado", false)
      .order("id", { ascending: true })
      .range(desde, desde + paso - 1);
    if (error) throw error;
    for (const p of data ?? []) {
      sumaPagos.set(p.prestamo_id, (sumaPagos.get(p.prestamo_id) ?? 0) + N(p.monto));
      if (!idsPrestamo.has(p.prestamo_id)) huerfanos++;
      pagosVigentes++;
    }
    if (!data || data.length < paso) break;
  }
}
console.log(`   pagos vigentes: ${pagosVigentes}  · huérfanos: ${huerfanos}`);

const creditos = prestamos.map((p) => ({
  id: p.id,
  estado: p.estado,
  pagadoAcum: N(p.pagado_acum),
  pagosSuma: N(sumaPagos.get(p.id) ?? 0),
  totalAPagar: N(p.cuota_diaria) * Number(p.total_dias || 0),
  cuotaDiaria: N(p.cuota_diaria),
}));

// 3) Recaudo de HOY (día de Uruguay, UTC−3) — libro de pagos vs caja.
const hoyUY = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const desdeHoy = `${hoyUY}T00:00:00-03:00`;
const { data: pagosHoy } = await db.from("pagos").select("monto").eq("anulado", false).gte("registrado_en", desdeHoy);
const recaudoLibro = (pagosHoy ?? []).reduce((s, p) => s + N(p.monto), 0);
let recaudoCaja = null;
try {
  const { data: mov, error } = await db
    .from("movimientos_caja")
    .select("monto, tipo")
    .gte("creado_en", desdeHoy);
  if (!error && mov) {
    // Ingresos de caja del día (los cobros que entraron a la caja).
    recaudoCaja = mov.filter((m) => (m.tipo ?? "").includes("ingreso") || N(m.monto) > 0)
      .reduce((s, m) => s + Math.abs(N(m.monto)), 0);
  }
} catch { /* movimientos_caja opcional */ }

// 4) Correr las invariantes.
const extra = [
  ...invHuerfanos(huerfanos),
  // Comparo el recaudo del libro con la caja SOLO si hay datos de caja del día.
  ...(recaudoCaja != null && recaudoCaja > 0 ? invRecaudoDia({ pagos: recaudoLibro, caja: recaudoCaja }) : []),
];
const r = reconciliar(creditos, extra);

console.log("\n════════ RESULTADO ════════");
console.log(`créditos verificados: ${r.totalCreditos}`);
console.log(`recaudo de hoy (${hoyUY}): libro $${recaudoLibro.toLocaleString("es-UY")}` +
  (recaudoCaja != null ? ` · caja $${recaudoCaja.toLocaleString("es-UY")}` : " · (sin datos de caja)"));
if (r.ok) {
  console.log("\n✅ LA PLATA CUADRA — todas las invariantes OK.");
  process.exit(0);
}
console.log(`\n🔴 ${r.hallazgos.length} HALLAZGO(S) — peor severidad: ${r.peorSeveridad}`);
console.log("   por invariante:", r.porInvariante);
console.log("\n   primeros 15:");
for (const h of r.hallazgos.slice(0, 15)) {
  console.log(`   · [${h.severidad}] ${h.invariante}${h.creditoId ? " (" + h.creditoId.slice(0, 8) + ")" : ""}: ${h.detalle}`);
}
if (r.hallazgos.length > 15) console.log(`   … y ${r.hallazgos.length - 15} más`);
process.exit(1);
