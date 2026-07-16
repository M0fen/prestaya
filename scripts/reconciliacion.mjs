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
import { reconciliar, invHuerfanos } from "../lib/reconciliacion.ts";

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
//    IMPORTANTE: se suma en CENTAVOS ENTEROS (monto×100 redondeado) y recién al
//    final se pasa a pesos. NO se redondea peso-por-peso: eso acumularía error y
//    daría "drifts" FALSOS contra el trigger 0063, que mantiene pagado_acum como
//    SUMA NUMÉRICA EXACTA (numeric(14,2)). Así el script coincide con el RPC 0071
//    (que suma en SQL exacto). Entero → sin float (regla de la casa: nunca float $).
const sumaCent = new Map();
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
      const c = Math.round(Number(p.monto) * 100); // centavos exactos de ESTE pago
      sumaCent.set(p.prestamo_id, (sumaCent.get(p.prestamo_id) ?? 0) + c);
      if (!idsPrestamo.has(p.prestamo_id)) huerfanos++;
      pagosVigentes++;
    }
    if (!data || data.length < paso) break;
  }
}
console.log(`   pagos vigentes: ${pagosVigentes}  · huérfanos: ${huerfanos}`);

const creditos = prestamos.map((p) => {
  const acumPesos = N(p.pagado_acum);
  const acumCent = Math.round(Number(p.pagado_acum) * 100); // pagado_acum en centavos exactos
  const sc = sumaCent.get(p.id) ?? 0; // Σ pagos en centavos exactos
  // Criterio IDÉNTICO al RPC 0071 (`abs(pagado_acum − Σmonto) >= 1`): si el desfase
  // CRUDO es < 1 peso, es residuo de redondeo histórico del denormalizado (no
  // corrupción) → se toma consistente. Si es ≥ 1 peso, es drift REAL y se reporta.
  // pesos = round(Σ centavos / 100): redondeo UNA vez sobre el total exacto (como el
  // trigger 0063), nunca peso-por-peso (eso daba drifts falsos).
  const pagosSuma = Math.abs(acumCent - sc) < 100 ? acumPesos : Math.round(sc / 100);
  return {
    id: p.id,
    estado: p.estado,
    pagadoAcum: acumPesos,
    pagosSuma,
    totalAPagar: N(p.cuota_diaria) * Number(p.total_dias || 0),
    cuotaDiaria: N(p.cuota_diaria),
  };
});

// 3) Recaudo de HOY (día de Uruguay, UTC−3) — solo informativo (Σ del libro).
//    NO se compara contra `movimientos_caja`: ahí NO están los cobros (viven en
//    `pagos`); esa tabla tiene gastos/desembolsos/retiros, así que compararla contra
//    el recaudo del libro daba un FALSO "no cuadra" cualquier día con gastos. La
//    consistencia recaudo↔caja bien hecha (libro vs el componente de cobros de la
//    caja) es un follow-up; hasta entonces esta invariante no se corre acá.
const hoyUY = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const desdeHoy = `${hoyUY}T00:00:00-03:00`;
const { data: pagosHoy } = await db.from("pagos").select("monto").eq("anulado", false).gte("registrado_en", desdeHoy);
const recaudoLibro = (pagosHoy ?? []).reduce((s, p) => s + N(p.monto), 0);

// 4) Correr las invariantes de saldo (drift / sobre-cobro / huérfanos).
const extra = [...invHuerfanos(huerfanos)];
const r = reconciliar(creditos, extra);

console.log("\n════════ RESULTADO ════════");
console.log(`créditos verificados: ${r.totalCreditos}`);
console.log(`recaudo de hoy (${hoyUY}): libro $${recaudoLibro.toLocaleString("es-UY")} (informativo)`);
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
