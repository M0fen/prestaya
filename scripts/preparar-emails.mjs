// ─────────────────────────────────────────────────────────────────────────
//  EMAILS LINDOS: reemplaza los cobrador-<id>@import.prestaya.local por
//  nombre.apellido@prestaya.uy (derivado del nombre ya limpio). Maneja colisiones.
//  Regenera el archivo de credenciales para entregar.
//   Dry:      node --env-file=.env.local scripts/preparar-emails.mjs
//   Aplicar:  node --env-file=.env.local scripts/preparar-emails.mjs --commit
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COMMIT = process.argv.includes("--commit");
const PASS = "PrestaYa2026!";

// "Andrés Duque, Montevideo" -> "andres.duque" (nombre antes de la coma, sin acentos)
function slug(nombre) {
  const base = (nombre || "").split(",")[0].trim();
  const s = base.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, ".");
  return s || "cobrador";
}

const { data: us } = await db.from("usuarios").select("id, nombre, rol, auth_user_id");
const emailPorAuth = new Map();
for (let p = 1; p <= 15; p++) {
  const { data } = await db.auth.admin.listUsers({ page: p, perPage: 200 });
  for (const u of data.users) if (u.email) emailPorAuth.set(u.id, u.email);
  if (data.users.length < 200) break;
}

// Emails ya lindos (ocupados) para evitar colisiones
const ocupados = new Set([...emailPorAuth.values()].filter((e) => !e.includes("@import.")).map((e) => e.toLowerCase()));

const cambios = [];
for (const u of us ?? []) {
  const actual = emailPorAuth.get(u.auth_user_id);
  if (!u.auth_user_id || !actual || !actual.includes("@import.")) continue; // solo los feos
  let base = slug(u.nombre), cand = `${base}@prestaya.uy`, i = 1;
  while (ocupados.has(cand.toLowerCase())) { i++; cand = `${base}.${i}@prestaya.uy`; }
  ocupados.add(cand.toLowerCase());
  cambios.push({ authId: u.auth_user_id, nombre: u.nombre, rol: u.rol, viejo: actual, nuevo: cand });
}

console.log(`URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL} | modo: ${COMMIT ? "COMMIT" : "DRY-RUN"}`);
console.log(`\nEmails a cambiar: ${cambios.length}`);
for (const c of cambios) console.log(`  ${c.nombre.slice(0, 30).padEnd(30)}  ${c.viejo}  ->  ${c.nuevo}`);

if (COMMIT) {
  let ok = 0;
  for (const c of cambios) {
    const { error } = await db.auth.admin.updateUserById(c.authId, { email: c.nuevo, email_confirm: true });
    if (error) { console.log(`  ! ${c.nombre}: ${error.message}`); continue; }
    emailPorAuth.set(c.authId, c.nuevo);
    ok++;
  }
  console.log(`\n✓ ${ok}/${cambios.length} emails actualizados.`);

  // Regenerar credenciales
  const orden = { admin: 0, supervisor: 1, cobrador: 2 };
  const filas = (us ?? []).map((u) => ({ ...u, email: emailPorAuth.get(u.auth_user_id) ?? "(sin login)" }))
    .sort((a, b) => (orden[a.rol] - orden[b.rol]) || a.nombre.localeCompare(b.nombre));
  let out = "CREDENCIALES — Presta Ya (acercamiento)\n";
  out += `Login = email + contraseña.  Contraseña de TODOS: ${PASS}  (salvo el admin Carlos, su clave personal)\n`;
  out += "=".repeat(78) + "\n";
  for (const rol of ["admin", "supervisor", "cobrador"]) {
    const g = filas.filter((f) => f.rol === rol && f.email !== "(sin login)");
    out += `\n### ${rol.toUpperCase()} (${g.length})\n`;
    for (const f of g) out += `  ${f.nombre.padEnd(34)}  ${f.email}\n`;
  }
  writeFileSync("C:/Users/Carlos/Desktop/credenciales-prestaya.txt", out, "utf-8");
  console.log("Credenciales regeneradas -> C:/Users/Carlos/Desktop/credenciales-prestaya.txt");
} else {
  console.log("\nDRY-RUN (no se cambió nada). Corré con --commit.");
}
