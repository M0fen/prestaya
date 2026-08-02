// ─────────────────────────────────────────────────────────────────────────
//  REPARACIÓN DE RUTAS (08-02) — cierra los 2 hallazgos de datos de la auditoría:
//   (1) Créditos ACTIVOS cuyo cliente NO tiene ninguna asignación activa
//       → plata en la calle que NINGÚN cobrador ve en su ruta. El crédito ya
//       trae `cobrador_id` (el que lo colocó): se crea/activa esa asignación.
//   (2) Créditos ACTIVOS con `cobrador_id` distinto del cobrador de la ruta
//       (asignación activa) → la comisión se atribuye a la persona equivocada.
//       Se alinea `prestamos.cobrador_id` con la ruta real (regla de d29f854,
//       aplicada retroactivamente a los que quedaron de antes).
//
//  USO:
//    node --env-file=.env.local scripts/reparar-rutas-sueltas.mjs           ← DRY-RUN (no escribe)
//    node --env-file=.env.local scripts/reparar-rutas-sueltas.mjs --commit  ← aplica
//
//  Reversible: el dry-run imprime el estado previo exacto (para deshacer a mano).
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const COMMIT = process.argv.includes("--commit");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function traerTodo(build, maxPag = 30) {
  const out = [];
  for (let i = 0; i < maxPag; i++) {
    const { data, error } = await build(i * 1000, i * 1000 + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

console.log(COMMIT ? "⚠ MODO COMMIT — se van a ESCRIBIR cambios\n" : "DRY-RUN (no escribe nada; usá --commit para aplicar)\n");

const asg = await traerTodo((d, h) => db.from("asignaciones").select("id, cliente_id, cobrador_id, activo").order("id").range(d, h));
const activasDe = new Map(); // cliente → [cobrador_id activos]
for (const a of asg) if (a.activo) activasDe.set(a.cliente_id, [...(activasDe.get(a.cliente_id) ?? []), a.cobrador_id]);
const filaDe = new Map(); // `${cliente}|${cobrador}` → fila (para reactivar en vez de duplicar)
for (const a of asg) filaDe.set(`${a.cliente_id}|${a.cobrador_id}`, a);

const prs = await traerTodo((d, h) => db.from("prestamos").select("id, cliente_id, cobrador_id").eq("estado", "activo").order("id").range(d, h));

// ── (1) Créditos sin ruta: crear/activar la asignación del cobrador del crédito ──
const sinRuta = prs.filter((p) => !(activasDe.get(p.cliente_id)?.length > 0));
console.log(`(1) Créditos activos SIN ruta: ${sinRuta.length}`);
let creadas = 0, reactivadas = 0, imposibles = 0;
for (const p of sinRuta) {
  if (!p.cobrador_id) { imposibles++; console.log(`   ✗ crédito ${p.id} sin cobrador_id — requiere decisión humana (asignar a mano)`); continue; }
  const previa = filaDe.get(`${p.cliente_id}|${p.cobrador_id}`);
  if (previa) {
    console.log(`   ↻ reactivar asignación ${previa.id} (cliente ${p.cliente_id.slice(0, 8)}… → cobrador ${p.cobrador_id.slice(0, 8)}…) [antes: activo=false]`);
    if (COMMIT) {
      const { error } = await db.from("asignaciones").update({ activo: true }).eq("id", previa.id);
      if (error) throw error;
    }
    reactivadas++;
  } else {
    console.log(`   + crear asignación cliente ${p.cliente_id.slice(0, 8)}… → cobrador ${p.cobrador_id.slice(0, 8)}… [antes: no existía]`);
    if (COMMIT) {
      const { error } = await db.from("asignaciones").upsert({ cliente_id: p.cliente_id, cobrador_id: p.cobrador_id, activo: true }, { onConflict: "cobrador_id,cliente_id" });
      if (error) throw error;
    }
    creadas++;
  }
  activasDe.set(p.cliente_id, [...(activasDe.get(p.cliente_id) ?? []), p.cobrador_id]);
}
console.log(`   → a crear=${creadas} · a reactivar=${reactivadas} · requieren humano=${imposibles}\n`);

// ── (2) cobrador_id del crédito ≠ ruta: alinear al de la ruta (comisión al que cobra) ──
// Solo cuando la ruta tiene UN solo cobrador activo (si hay varios —diseño 0038—,
// no se adivina: se deja para decisión humana).
const stale = prs.filter((p) => {
  const r = activasDe.get(p.cliente_id) ?? [];
  return r.length > 0 && p.cobrador_id && !r.includes(p.cobrador_id);
});
console.log(`(2) Créditos con cobrador_id ≠ ruta: ${stale.length}`);
let alineados = 0, ambiguos = 0;
for (const p of stale) {
  const r = activasDe.get(p.cliente_id) ?? [];
  if (r.length !== 1) { ambiguos++; console.log(`   ? crédito ${p.id} — ruta con ${r.length} cobradores, decidir a mano`); continue; }
  console.log(`   → crédito ${p.id.slice(0, 8)}…: cobrador_id ${p.cobrador_id.slice(0, 8)}… → ${r[0].slice(0, 8)}… [antes: ${p.cobrador_id}]`);
  if (COMMIT) {
    const { error } = await db.from("prestamos").update({ cobrador_id: r[0] }).eq("id", p.id).eq("estado", "activo");
    if (error) throw error;
  }
  alineados++;
}
console.log(`   → a alinear=${alineados} · ambiguos (humano)=${ambiguos}`);
console.log(COMMIT ? "\n✅ CAMBIOS APLICADOS" : "\n(nada escrito — dry-run)");
