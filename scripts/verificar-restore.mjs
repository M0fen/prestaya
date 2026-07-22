// ─────────────────────────────────────────────────────────────────────────
//  VERIFICAR RESTORE — valida que una copia RESTAURADA (backup/PITR) esté
//  completa y consistente. Parte del "restore drill": un backup no probado NO
//  es un backup. Read-only en ambas bases.
//
//  Uso: exportá las credenciales de la copia restaurada y (opcional) las de la
//  base viva para comparar, y corré:
//    RESTORE_URL=https://xxxx.supabase.co RESTORE_KEY=<service_role_de_la_copia> \
//    node --env-file=.env.local scripts/verificar-restore.mjs
//
//  (.env.local aporta NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY de la
//   base VIVA para la comparación de completitud; si no están, solo verifica la copia.)
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const rUrl = process.env.RESTORE_URL;
const rKey = process.env.RESTORE_KEY;
if (!rUrl || !rKey) {
  console.error("Faltan RESTORE_URL / RESTORE_KEY (credenciales de la copia restaurada).");
  process.exit(2);
}
const restore = createClient(rUrl, rKey, { auth: { persistSession: false } });

const vivaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const vivaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const viva = vivaUrl && vivaKey ? createClient(vivaUrl, vivaKey, { auth: { persistSession: false } }) : null;

const TABLAS = ["usuarios", "clientes", "prestamos", "pagos", "movimientos_caja", "comisiones_liquidadas", "rendiciones"];

async function contar(db, tabla) {
  const { count, error } = await db.from(tabla).select("*", { count: "exact", head: true });
  return error ? null : count;
}

console.log("⏳ Verificando la copia restaurada…\n");
console.log("═══ 1) CONTEO de filas por tabla (copia vs viva) ═══");
let faltantes = 0;
for (const t of TABLAS) {
  const cr = await contar(restore, t);
  const cv = viva ? await contar(viva, t) : null;
  if (cr == null) { console.log(`  ❌ ${t.padEnd(22)} no legible en la copia`); faltantes++; continue; }
  if (cv == null) { console.log(`  ${t.padEnd(22)} copia ${String(cr).padStart(8)}`); continue; }
  // Una copia PITR es de un punto ANTERIOR → la copia puede tener ≤ filas que la
  // viva (por lo escrito después del punto). Una copia con MÁS filas es anomalía.
  const dif = cr - cv;
  const flag = dif > 0 ? "🔴 copia > viva (?)" : dif === 0 ? "✅ igual" : `🟡 −${-dif} (escrito tras el punto)`;
  console.log(`  ${t.padEnd(22)} copia ${String(cr).padStart(8)}  viva ${String(cv).padStart(8)}  ${flag}`);
}

// 2) Integridad interna de la copia: pagos huérfanos + Σ pagado_acum ≈ Σ pagos.
console.log("\n═══ 2) INTEGRIDAD interna de la copia ═══");
const idsPrestamo = new Set();
{ let d = 0; for (;;) { const { data } = await restore.from("prestamos").select("id").order("id").range(d, d + 999); for (const p of data ?? []) idsPrestamo.add(p.id); if (!data || data.length < 1000) break; d += 1000; } }
let huerfanos = 0, sumaPagosCent = 0;
{ let d = 0; for (;;) { const { data } = await restore.from("pagos").select("prestamo_id, monto").eq("anulado", false).order("id").range(d, d + 999); for (const p of data ?? []) { if (!idsPrestamo.has(p.prestamo_id)) huerfanos++; sumaPagosCent += Math.round(Number(p.monto) * 100); } if (!data || data.length < 1000) break; d += 1000; } }
let acumCent = 0;
{ let d = 0; for (;;) { const { data } = await restore.from("prestamos").select("pagado_acum").order("id").range(d, d + 999); for (const p of data ?? []) acumCent += Math.round(Number(p.pagado_acum || 0) * 100); if (!data || data.length < 1000) break; d += 1000; } }
const driftPesos = Math.round((acumCent - sumaPagosCent) / 100);
console.log(`  Créditos: ${idsPrestamo.size} · pagos huérfanos: ${huerfanos} ${huerfanos === 0 ? "✅" : "🔴"}`);
console.log(`  Σ pagado_acum vs Σ pagos: drift ${driftPesos >= 0 ? "+" : ""}${driftPesos} (agregado) ${Math.abs(driftPesos) < 5000 ? "✅ dentro de tolerancia de baseline" : "🔴 revisar"}`);

console.log("\n═══ VEREDICTO ═══");
if (faltantes === 0 && huerfanos === 0) {
  console.log("✅ La copia restaurada es LEGIBLE, COMPLETA y CONSISTENTE. Anotá el RTO (cuánto tardó el restore) y el RPO (ventana de datos perdidos) en el runbook.");
  process.exit(0);
}
console.log("🔴 Hay problemas en la copia (ver arriba). El backup NO está listo para confiar.");
process.exit(1);
