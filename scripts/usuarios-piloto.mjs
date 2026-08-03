// Entregable del PILOTO: Zona Centro (supervisor + cobradores) + admins.
// Verifica el login REAL de cada uno (anon key, como el navegador) antes de repartir.
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PASS = "PrestaYa2026!";
const APP = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://prestaya-blush.vercel.app";
const ZONA = "Zona Centro";

const { data: zonas } = await db.from("zonas").select("id, nombre");
const z = (zonas ?? []).find((x) => x.nombre === ZONA);
if (!z) throw new Error(`No existe la zona ${ZONA}`);
const { data: supZ } = await db.from("supervisor_zonas").select("supervisor_id").eq("zona_id", z.id);
const supIds = new Set((supZ ?? []).map((s) => s.supervisor_id));
const { data: us } = await db.from("usuarios").select("id, nombre, rol, zona_id, auth_user_id, activo");
const auth = new Map();
for (let p = 1; p <= 15; p++) {
  const { data } = await db.auth.admin.listUsers({ page: p, perPage: 200 });
  for (const u of data.users) auth.set(u.id, u);
  if (data.users.length < 200) break;
}
const carteraDe = new Map();
for (let i = 0; ; i++) {
  const { data } = await db.from("asignaciones").select("cobrador_id").eq("activo", true).order("id").range(i * 1000, i * 1000 + 999);
  for (const a of data ?? []) carteraDe.set(a.cobrador_id, (carteraDe.get(a.cobrador_id) ?? 0) + 1);
  if (!data || data.length < 1000) break;
}
const vivos = (us ?? []).filter((u) => u.activo);
const admins = vivos.filter((u) => u.rol === "admin").sort((a, b) => a.nombre.localeCompare(b.nombre));
const sups = vivos.filter((u) => u.rol === "supervisor" && supIds.has(u.id));
const cobs = vivos.filter((u) => u.rol === "cobrador" && u.zona_id === z.id).sort((a, b) => a.nombre.localeCompare(b.nombre));

// Prueba de login real, uno por uno.
const probar = async (u) => {
  const email = auth.get(u.auth_user_id)?.email;
  if (!email) return { email: "(SIN LOGIN)", ok: false, nota: "no tiene cuenta en Auth" };
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASS });
  if (!error) await c.auth.signOut();
  const mfa = data?.user?.factors?.filter((f) => f.status === "verified").length ?? 0;
  return { email, ok: !error, nota: error ? error.message : mfa > 0 ? `⚠ tiene 2FA (${mfa})` : "" };
};
const fila = async (u, tag) => {
  const r = await probar(u);
  const n = carteraDe.get(u.id) ?? 0;
  return `${tag}${u.nombre.padEnd(24)}  ${r.email.padEnd(36)}  ${String(n).padStart(3)} clientes  ${r.ok ? "✓ entra" : "✗ NO ENTRA"} ${r.nota}\n`;
};

let out = `PRESTA YA — USUARIOS DEL PILOTO (${ZONA})\n`;
out += `App: ${APP}/ingresar\n`;
out += `Login = email + contraseña.   Contraseña: ${PASS}\n`;
out += `Sin 2FA. Cada persona la puede cambiar después desde su perfil.\n`;
out += "=".repeat(92) + "\n";
out += `\n### SUPERVISOR DEL PILOTO — ve toda ${ZONA}, cierra la caja de la zona\n`;
for (const s of sups) out += await fila(s, "  ");
out += `\n### COBRADORES DE ${ZONA.toUpperCase()} (${cobs.length}) — ${cobs.reduce((a, c) => a + (carteraDe.get(c.id) ?? 0), 0)} clientes en total\n`;
for (const c of cobs) out += await fila(c, "  ");
out += `\n### ADMINISTRADORES (oficina — ven todas las zonas)\n`;
for (const a of admins) out += await fila(a, "  ");
out += `\nVista del CLIENTE: no lleva login. Cada cliente entra por su link/QR personal\n`;
out += `(el cobrador se lo entrega desde la ficha; también sale impreso en el cartón).\n`;
writeFileSync("C:/Users/Carlos/Desktop/usuarios-piloto-zona-centro.txt", out, "utf-8");
console.log(out);
console.log("→ C:/Users/Carlos/Desktop/usuarios-piloto-zona-centro.txt");
