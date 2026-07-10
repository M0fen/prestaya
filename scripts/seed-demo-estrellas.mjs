// ─────────────────────────────────────────────────────────────────────────
//  DEMO · Sembrar CANJES de estrellas pendientes (solo base de PRUEBA).
//
//  Las estrellas se DERIVAN de los pagos (1 pago = 1 fragmento; 5 = 1 estrella),
//  así que los clientes ya las tienen ganadas. Lo que está vacío es la tabla de
//  redenciones (solicitudes de canje) → /admin/estrellas sale sin nada. Este
//  script inserta solicitudes 'pendiente' para clientes que DE VERDAD tienen
//  estrellas suficientes (>= 10 pagos vigentes), así el flujo de aprobación se
//  puede mostrar en la demo con datos legítimos (no truqueados).
//
//  Uso:
//    node --env-file=.env.local scripts/seed-demo-estrellas.mjs           # sembrar
//    node --env-file=.env.local scripts/seed-demo-estrellas.mjs --limpiar # borrar los demo
//
//  Reversible: cada canje demo lleva la marca 🧪 en `nota`. --limpiar borra solo esos.
//  Guard duro: solo corre contra la base de PRUEBA.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const REF_PRUEBA = "kvmqlkqfgjimfpzlwsdt";
if (!URL_.includes(REF_PRUEBA)) {
  console.error(`ABORTADO: solo PRUEBA (${REF_PRUEBA}). URL: ${URL_ || "(vacía)"}`);
  process.exit(1);
}
const db = createClient(URL_, SR, { auth: { persistSession: false } });
const LIMPIAR = process.argv.includes("--limpiar");
const MARCA = "🧪 Demo";
const CICLO = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 7); // "YYYY-MM" UY

if (LIMPIAR) {
  const { data, error } = await db.from("estrellas_redenciones").delete().like("nota", `${MARCA}%`).select("id");
  if (error) { console.error("Error al limpiar:", error.message); process.exit(1); }
  console.log(`✔ Borrados ${data?.length ?? 0} canjes demo.`);
  process.exit(0);
}

// ¿Ya hay canjes demo? (idempotente: no duplicar).
const { count: yaHay } = await db.from("estrellas_redenciones")
  .select("id", { count: "exact", head: true }).like("nota", `${MARCA}%`);
if ((yaHay ?? 0) > 0) {
  console.log(`Ya hay ${yaHay} canjes demo sembrados. Para rehacer: --limpiar y volver a correr.`);
  process.exit(0);
}

// Candidatos: créditos activos; contamos pagos vigentes por crédito hasta juntar
// ~12 clientes con estrellas de sobra (>= 10 pagos = >= 2 estrellas).
const { data: pres, error: eP } = await db.from("prestamos")
  .select("id, cliente_id").eq("estado", "activo").limit(150);
if (eP) { console.error(eP.message); process.exit(1); }

const elegidos = [];
const vistos = new Set();
for (const p of pres ?? []) {
  if (elegidos.length >= 12) break;
  if (vistos.has(p.cliente_id)) continue;
  vistos.add(p.cliente_id);
  const { count } = await db.from("pagos").select("id", { count: "exact", head: true })
    .eq("prestamo_id", p.id).eq("anulado", false);
  const estrellasGanadas = Math.floor((count ?? 0) / 5);
  if (estrellasGanadas >= 2) {
    elegidos.push({ clienteId: p.cliente_id, ganadas: estrellasGanadas });
  }
}

if (elegidos.length === 0) {
  console.log("No se encontraron clientes con estrellas suficientes. Nada sembrado.");
  process.exit(0);
}

// Nombres (para el log) + inserción. Pide 1..min(3, ganadas) estrellas por cliente,
// variando por índice (determinístico, sin Math.random).
const ids = elegidos.map((e) => e.clienteId);
const { data: cs } = await db.from("clientes").select("id, nombre").in("id", ids);
const nombre = new Map((cs ?? []).map((c) => [c.id, c.nombre]));

const NOTAS = ["Quiere el sorteo", "Canje de premio", "Pidió por WhatsApp", "Cliente fiel"];
const filas = elegidos.map((e, i) => {
  const pedido = Math.min(e.ganadas, (i % 3) + 1); // 1,2,3,1,2,3…
  return {
    cliente_id: e.clienteId,
    estrellas: pedido,
    ciclo: CICLO,
    estado: "pendiente",
    nota: `${MARCA} · ${NOTAS[i % NOTAS.length]}`,
  };
});

const { error: eIns } = await db.from("estrellas_redenciones").insert(filas);
if (eIns) { console.error("Error al insertar:", eIns.message); process.exit(1); }

console.log(`✔ Sembrados ${filas.length} canjes PENDIENTES (ciclo ${CICLO}):`);
for (const f of filas) console.log(`   · ${nombre.get(f.cliente_id) ?? f.cliente_id}: ${f.estrellas} ⭐`);
console.log(`Para deshacer: node --env-file=.env.local scripts/seed-demo-estrellas.mjs --limpiar`);
