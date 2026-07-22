// ─────────────────────────────────────────────────────────────────────────
//  RECONCILIACIÓN vs DISAPP (fuente de verdad). Compara nuestros AGREGADOS de la
//  cartera ACTIVA contra los del tablero de Disapp y cuantifica cada diferencia
//  en $ y %. Read-only. Objetivo: máxima cohesión; toda diferencia se investiga.
//
//  Los números de Disapp son un snapshot que pasó Carlos (actualizar si cambia).
//    node --env-file=.env.local scripts/reconciliacion-disapp.mjs
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Snapshot de Disapp (tablero) ────────────────────────────────────────────
const DISAPP = {
  activos: 2437,               // Total de ventas activas / Cantidad de créditos
  clientes: 13097,             // Total de clientes
  principal: 88850730,         // Ventas Crédito (capital prestado)
  conInteres: 96963461,        // Con Intereses (total a cobrar)
  recaudo: 29621729.64,        // Recaudo (histórico sobre la cartera activa)
  cartera: 67341731.36,        // Cartera Pendiente / Capital en calle
  porCobrarHoy: 1144722.52,    // Por cobrar hoy
  mora: 506,                   // Ventas en mora
};

const fmt = (n) => "$" + Math.round(n).toLocaleString("es-UY");
async function traerTodo(tabla, select, filtro = (q) => q) {
  const out = []; const paso = 1000;
  for (let d = 0; ; d += paso) {
    const { data, error } = await filtro(db.from(tabla).select(select).order("id").range(d, d + paso - 1));
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < paso) break;
  }
  return out;
}

console.log("⏳ Reconciliación vs Disapp — leyendo la cartera ACTIVA…\n");

// 1) Créditos ACTIVOS + capital/total.
const activos = await traerTodo("prestamos", "id, monto_prestado, cuota_diaria, total_dias, cliente_id",
  (q) => q.eq("estado", "activo"));
const idsAct = new Set(activos.map((p) => p.id));

// 2) Σ pagos vigentes SOBRE créditos activos (centavos exactos).
const pagCent = new Map();
{
  const paso = 1000;
  for (let d = 0; ; d += paso) {
    const { data, error } = await db.from("pagos").select("prestamo_id, monto, anulado")
      .eq("anulado", false).order("id").range(d, d + paso - 1);
    if (error) throw error;
    for (const p of data ?? []) {
      if (!idsAct.has(p.prestamo_id)) continue;
      pagCent.set(p.prestamo_id, (pagCent.get(p.prestamo_id) ?? 0) + Math.round(Number(p.monto) * 100));
    }
    if (!data || data.length < paso) break;
  }
}

let principal = 0, conInteres = 0, recaudo = 0, cartera = 0;
const clientesConActivo = new Set();
for (const p of activos) {
  principal += Number(p.monto_prestado);
  const total = Number(p.cuota_diaria) * Number(p.total_dias || 0);
  const pagado = (pagCent.get(p.id) ?? 0) / 100;
  conInteres += total;
  recaudo += pagado;
  cartera += Math.max(0, total - pagado);
  if (p.cliente_id) clientesConActivo.add(p.cliente_id);
}

const { count: totalClientes } = await db.from("clientes").select("*", { count: "exact", head: true }).eq("activo", true);
const { count: todosClientes } = await db.from("clientes").select("*", { count: "exact", head: true });

// ── Comparación ─────────────────────────────────────────────────────────────
function cmp(label, ours, disapp, money = true) {
  const diff = ours - disapp;
  const pct = disapp ? (diff / disapp) * 100 : 0;
  const v = (x) => (money ? fmt(x) : Math.round(x).toLocaleString("es-UY"));
  const sig = Math.abs(pct) < 0.5 ? "✅" : Math.abs(pct) < 2 ? "🟡" : "🔴";
  console.log(`  ${sig} ${label.padEnd(22)} nuestro ${v(ours).padStart(15)}  vs Disapp ${v(disapp).padStart(15)}  → dif ${v(diff).padStart(13)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`);
}

console.log("═══ CARTERA ACTIVA — nuestro vs Disapp ═══");
cmp("Créditos activos", activos.length, DISAPP.activos, false);
cmp("Capital prestado", principal, DISAPP.principal);
cmp("Total con interés", conInteres, DISAPP.conInteres);
cmp("Recaudo (histórico)", recaudo, DISAPP.recaudo);
cmp("Cartera pendiente", cartera, DISAPP.cartera);
console.log("\n═══ CLIENTES ═══");
cmp("Clientes activos", totalClientes, DISAPP.clientes, false);
console.log(`     (clientes en total, incl. inactivos: ${todosClientes?.toLocaleString("es-UY")} · con crédito activo: ${clientesConActivo.size.toLocaleString("es-UY")})`);

console.log("\n═══ COHERENCIA INTERNA de Disapp (sanity) ═══");
console.log(`  conInteres − recaudo = ${fmt(DISAPP.conInteres - DISAPP.recaudo)}  vs cartera ${fmt(DISAPP.cartera)}  ${Math.abs(DISAPP.conInteres - DISAPP.recaudo - DISAPP.cartera) < 2 ? "✅" : "🔴"}`);
console.log(`  recaudo / conInteres = ${((DISAPP.recaudo / DISAPP.conInteres) * 100).toFixed(1)}%  (Disapp dice 30.5%)`);

console.log("\nNota: 'mora' (Disapp 506) usa otra definición — se concilia aparte (en término vs cartera vencida).");
