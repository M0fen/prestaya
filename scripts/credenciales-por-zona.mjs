// Entregable: credenciales agrupadas por ZONA (supervisor + cobradores con su login).
// node --env-file=.env.local scripts/credenciales-por-zona.mjs
//
// Además del email de cada persona muestra:
//  · CLIENTES en ruta (asignaciones activas) → distingue una cuenta REAL de un
//    cascarón sin cartera (útil para no repartir logins que no sirven a nadie).
//  · ESTADO del login: baja / sin login / baneado → una credencial que no entra
//    en la app es peor que no darla (el día 1 se pierde en soporte).
//  · Los cobradores SIN ZONA se listan aparte CON su cartera: su efectivo no
//    entra en ningún cierre de zona (custodia en limbo), así que hay que verlo.
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PASS = "PrestaYa2026!";
const APP = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://prestaya-blush.vercel.app";

const { data: us } = await db.from("usuarios").select("id, nombre, rol, zona_id, auth_user_id, activo");
const { data: zonas } = await db.from("zonas").select("id, nombre");
const { data: supZonas } = await db.from("supervisor_zonas").select("supervisor_id, zona_id");

// Cartera por cobrador (asignaciones activas), paginada: PostgREST corta en 1000.
const carteraDe = new Map();
for (let i = 0; ; i++) {
  const { data, error } = await db
    .from("asignaciones").select("cobrador_id").eq("activo", true)
    .order("id", { ascending: true }).range(i * 1000, i * 1000 + 999);
  if (error) throw error;
  for (const a of data ?? []) carteraDe.set(a.cobrador_id, (carteraDe.get(a.cobrador_id) ?? 0) + 1);
  if (!data || data.length < 1000) break;
}

const authPorId = new Map();
for (let p = 1; p <= 15; p++) {
  const { data } = await db.auth.admin.listUsers({ page: p, perPage: 200 });
  for (const u of data.users) authPorId.set(u.id, u);
  if (data.users.length < 200) break;
}
const email = (u) => authPorId.get(u.auth_user_id)?.email ?? "(SIN LOGIN)";
/** Marca los logins que NO van a poder entrar (mejor saberlo antes de repartir). */
const problema = (u) => {
  if (!u.activo) return " ⚠ DE BAJA";
  if (!u.auth_user_id || !authPorId.has(u.auth_user_id)) return " ⚠ SIN LOGIN";
  const a = authPorId.get(u.auth_user_id);
  if (a.banned_until && new Date(a.banned_until) > new Date()) return " ⚠ BANEADO";
  return "";
};
const linea = (u, sangria) => {
  const n = carteraDe.get(u.id) ?? 0;
  return `${sangria}${u.nombre.padEnd(28)}  ${email(u).padEnd(38)}  ${String(n).padStart(4)} clientes${problema(u)}\n`;
};

const supDeZona = new Map();
for (const s of supZonas ?? []) supDeZona.set(s.zona_id, [...(supDeZona.get(s.zona_id) ?? []), s.supervisor_id]);
const vivos = (us ?? []).filter((u) => u.activo);

let out = `PRESTA YA — Usuarios del piloto\n`;
out += `App: ${APP}/ingresar\n`;
out += `Login = email + contraseña.  Contraseña: ${PASS}  (salvo el admin Carlos)\n`;
out += `Cada quien la cambia desde su perfil. Sin 2FA activo.\n`;
out += "=".repeat(88) + "\n";

out += `\n### ADMINISTRADORES (${vivos.filter((u) => u.rol === "admin").length}) — ven todas las zonas\n`;
for (const u of vivos.filter((u) => u.rol === "admin").sort((a, b) => a.nombre.localeCompare(b.nombre)))
  out += linea(u, "  ");

const zonasConCob = (zonas ?? []).filter((z) => vivos.some((u) => u.rol === "cobrador" && u.zona_id === z.id));
for (const z of zonasConCob) {
  const sups = (supDeZona.get(z.id) ?? []).map((id) => vivos.find((u) => u.id === id)).filter(Boolean);
  const cobs = vivos.filter((u) => u.rol === "cobrador" && u.zona_id === z.id).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const total = cobs.reduce((s, c) => s + (carteraDe.get(c.id) ?? 0), 0);
  out += `\n### ${z.nombre.toUpperCase()}  —  supervisor: ${sups.map((s) => s.nombre).join(", ") || "⚠ NINGUNO"} · ${cobs.length} cobradores · ${total} clientes\n`;
  for (const s of sups) out += linea(s, "  [sup] ");
  for (const c of cobs) out += linea(c, "        ");
}

const pool = vivos.filter((u) => u.rol === "cobrador" && !u.zona_id).sort((a, b) => a.nombre.localeCompare(b.nombre));
if (pool.length) {
  const conCartera = pool.filter((c) => (carteraDe.get(c.id) ?? 0) > 0);
  const total = pool.reduce((s, c) => s + (carteraDe.get(c.id) ?? 0), 0);
  out += `\n### SIN ZONA (${pool.length} cobradores · ${total} clientes)\n`;
  out += `⚠ ${conCartera.length} de ellos TIENEN cartera. Al no pertenecer a una zona, su efectivo no entra\n`;
  out += `  en ningún cierre de zona: rinden, pero ningún supervisor sella esa custodia.\n`;
  for (const c of pool) out += linea(c, "        ");
}

const sups = vivos.filter((u) => u.rol === "supervisor");
const sinZonaSup = sups.filter((s) => !(supZonas ?? []).some((sz) => sz.supervisor_id === s.id));
if (sinZonaSup.length) {
  out += `\n### SUPERVISORES SIN ZONA ASIGNADA (${sinZonaSup.length}) — ven TODAS las zonas\n`;
  for (const s of sinZonaSup) out += linea(s, "        ");
}

writeFileSync("C:/Users/Carlos/Desktop/credenciales-prestaya.txt", out, "utf-8");
console.log(out);
console.log("→ C:/Users/Carlos/Desktop/credenciales-prestaya.txt");
