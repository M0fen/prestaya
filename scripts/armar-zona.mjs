// ─────────────────────────────────────────────────────────────────────────
//  ARMAR UNA ZONA (reutilizable): crea la zona si falta, renombra a los nombres
//  reales, asigna los cobradores, y deja al supervisor 1:1 con la zona (él solo
//  la supervisa; ella tiene solo a él). Verifica que cada cobrador tenga ruta.
//  Editá CONFIG y corré:
//   Dry-run:  node --env-file=.env.local scripts/armar-zona.mjs
//   Aplicar:  node --env-file=.env.local scripts/armar-zona.mjs --commit
//  Los que no estén en la base se listan en `faltan` (quedan afuera).
// ─────────────────────────────────────────────────────────────────────────
const CONFIG = {
  zona: "Zona Norte",
  color: "#0E7490",
  supervisor: { target: "Edwin Campo", buscar: ["edwin", "campo"] },
  cobradores: [
    { target: "Luz Angela Idrobo", buscar: ["idrobo"] },
    { target: "David de La Cruz", buscar: ["david", "cruz"] },
    { target: "Pilar Bedoya", buscar: ["bedoya"] },
    { target: "Daniela Torres", buscar: ["daniela", "torres"] },
    { target: "Jahir Mejía", buscar: ["jahir"] },
    { target: "Jessica Pérez", buscar: ["jessica"] },
    { target: "Lorena Torres", buscar: ["lorena"] },
  ],
  faltan: [],
};

import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COMMIT = process.argv.includes("--commit");
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const { data: us } = await db.from("usuarios").select("id, nombre, rol, zona_id, auth_user_id");
const hallar = (buscar, rol) => (us || []).filter((u) => u.rol === rol && buscar.every((t) => norm(u.nombre).includes(t)));

let { data: zonas } = await db.from("zonas").select("id, nombre");
let zona = (zonas || []).find((z) => norm(z.nombre) === norm(CONFIG.zona));
console.log(`${CONFIG.zona}: ${zona ? `existe (${zona.id})` : "NO existe, se creará"} | modo: ${COMMIT ? "COMMIT" : "DRY-RUN"}\n`);

// Rutas
const activosCli = new Set();
for (let off = 0; ; off += 1000) { const { data } = await db.from("prestamos").select("cliente_id").eq("estado", "activo").order("id", { ascending: true }).range(off, off + 999); for (const r of data || []) activosCli.add(r.cliente_id); if (!data || data.length < 1000) break; }
const cliPorCob = new Map();
for (let off = 0; ; off += 1000) { const { data } = await db.from("asignaciones").select("cobrador_id, cliente_id").eq("activo", true).order("id", { ascending: true }).range(off, off + 999); for (const a of data || []) { if (!cliPorCob.has(a.cobrador_id)) cliPorCob.set(a.cobrador_id, new Set()); cliPorCob.get(a.cobrador_id).add(a.cliente_id); } if (!data || data.length < 1000) break; }
const rutaDe = (uid) => { const cs = cliPorCob.get(uid); if (!cs) return 0; let n = 0; for (const c of cs) if (activosCli.has(c)) n++; return n; };

const sc = hallar(CONFIG.supervisor.buscar, "supervisor");
if (sc.length !== 1) { console.error(`✗ Supervisor "${CONFIG.supervisor.target}": ${sc.length} matches -> ${sc.map((x) => x.nombre).join(" | ")}`); process.exit(1); }
const sup = sc[0];
console.log(`SUPERVISOR: "${sup.nombre}" -> "${CONFIG.supervisor.target}"`);

const plan = []; let prob = 0;
for (const c of CONFIG.cobradores) {
  const m = hallar(c.buscar, "cobrador");
  if (m.length !== 1) { console.log(`  ✗ "${c.target}": ${m.length} matches -> ${m.map((x) => x.nombre).join(" | ") || "NINGUNO"}`); prob++; continue; }
  plan.push({ u: m[0], target: c.target }); console.log(`  "${m[0].nombre}" -> "${c.target}"  ruta=${rutaDe(m[0].id)}`);
}
if (CONFIG.faltan.length) console.log(`\nAfuera (no están en la base): ${CONFIG.faltan.join(", ")}`);
if (prob) { console.error(`\n✗ ${prob} sin match único — abortando.`); process.exit(1); }
if (!COMMIT) { console.log("\nDRY-RUN (no se escribió). Corré con --commit."); process.exit(0); }

console.log("\nAplicando…");
if (!zona) {
  const admin = (us || []).find((u) => u.rol === "admin");
  const { data: nz, error } = await db.from("zonas").insert({ nombre: CONFIG.zona, color: CONFIG.color, activo: true, creado_por: admin?.id ?? null }).select("id, nombre").single();
  if (error) { console.error("✗ crear zona:", error.message); process.exit(1); }
  zona = nz; console.log(`  ✓ zona creada (${zona.id})`);
}
for (const p of plan) { const { error } = await db.from("usuarios").update({ nombre: p.target, zona_id: zona.id }).eq("id", p.u.id); if (error) console.log(`  ! ${p.target}: ${error.message}`); }
await db.from("usuarios").update({ nombre: CONFIG.supervisor.target }).eq("id", sup.id);
// Supervisor 1:1 con la zona: él solo la cubre, y ella tiene solo a él.
await db.from("supervisor_zonas").delete().eq("supervisor_id", sup.id);
await db.from("supervisor_zonas").delete().eq("zona_id", zona.id).neq("supervisor_id", sup.id);
await db.from("supervisor_zonas").upsert({ supervisor_id: sup.id, zona_id: zona.id }, { onConflict: "supervisor_id,zona_id" });

const { data: cobsZona } = await db.from("usuarios").select("id, nombre").eq("rol", "cobrador").eq("zona_id", zona.id).order("nombre");
console.log(`\n✓ ${CONFIG.zona} armada. ${CONFIG.supervisor.target} la supervisa. Cobradores: ${(cobsZona || []).length}`);
let sinRuta = 0;
for (const c of cobsZona || []) { const r = rutaDe(c.id); if (r === 0) sinRuta++; console.log(`   ${c.nombre.padEnd(22)} ruta=${r}`); }
console.log(sinRuta ? `⚠ ${sinRuta} sin ruta` : "✓ todos con ruta (día de trabajo listo)");
