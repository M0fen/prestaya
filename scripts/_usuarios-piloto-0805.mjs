// Entregable 08-05: la lista DEFINITIVA del piloto que pasó Carlos, cruzada
// contra la base + prueba de login REAL (anon key, como el navegador) de cada uno.
// node --env-file=.env.local scripts/_usuarios-piloto-0805.mjs
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PASS = "PrestaYa2026!";
const APP = "https://prestaya.uy";

// La lista de Carlos, tal cual la dictó (08-05).
const SLUGS = [
  "angelika.gomez", "anyela.quinonez", "borney.cerezo", "edward.munoz",
  "fatima.cabillon", "fernando.castro", "jorge.ospina", "juan.jose.castro",
  "karent.londono", "leonel.maciel", "maria.artunduaga", "valentina.ramirez",
  "victor.moralez", "yuli.toro",
];
// "Jhon Hernández" = John Albert Hernández · "María Inocencia" = María Curbelo (confirmado por Carlos).
const NOMBRES = ["Daniela Millán", "María Curbelo", "John Albert Hernández", "Alejandro Cardona"];
// Fuera de su lista pero entran igual mañana: supervisor de la zona + oficina.
const OFICINA = ["mauricio.rengifo", "admin", "carolina", "carlos"];

const norm = (s) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const { data: us, error: eUs } = await db
  .from("usuarios")
  .select("id, nombre, rol, zona_id, auth_user_id, activo, comision_pct, clave_cambiada_en, apodo");
if (eUs) throw eUs;
const { data: zonas } = await db.from("zonas").select("id, nombre");
const zonaDe = new Map((zonas ?? []).map((z) => [z.id, z.nombre]));

const authPorId = new Map();
for (let p = 1; p <= 15; p++) {
  const { data } = await db.auth.admin.listUsers({ page: p, perPage: 200 });
  for (const u of data.users) authPorId.set(u.id, u);
  if (data.users.length < 200) break;
}
const emailDe = (u) => authPorId.get(u.auth_user_id)?.email ?? null;

// Cartera activa por cobrador (paginado: PostgREST corta en 1000).
const carteraDe = new Map();
for (let i = 0; ; i++) {
  const { data, error } = await db
    .from("asignaciones").select("cobrador_id").eq("activo", true)
    .order("id", { ascending: true }).range(i * 1000, i * 1000 + 999);
  if (error) throw error;
  for (const a of data ?? []) carteraDe.set(a.cobrador_id, (carteraDe.get(a.cobrador_id) ?? 0) + 1);
  if (!data || data.length < 1000) break;
}

// ── Matching contra la lista de Carlos ──
const porSlug = (slug) => (us ?? []).find((x) => (emailDe(x) ?? "").toLowerCase().startsWith(slug + "@"));
const hallados = new Map(); // usuario.id → etiqueta
const faltantes = [];
for (const slug of SLUGS) {
  const u = porSlug(slug);
  if (u) hallados.set(u.id, slug);
  else faltantes.push(slug);
}
for (const nombre of NOMBRES) {
  const palabras = norm(nombre).split(/\s+/);
  const u = (us ?? []).find((x) => palabras.every((p) => norm(x.nombre).includes(p)));
  if (u && !hallados.has(u.id)) hallados.set(u.id, nombre);
  else if (!u) faltantes.push(nombre);
}
const oficina = new Map();
for (const slug of OFICINA) {
  const u = porSlug(slug);
  if (u) oficina.set(u.id, slug);
}

// ── Prueba de login real, uno por uno (con pausa para no gatillar rate-limit) ──
const probar = async (u) => {
  const email = emailDe(u);
  if (!email) return { email: "(SIN LOGIN)", entra: false, provisoria: false, nota: "sin cuenta en Auth" };
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASS });
  if (!error) await c.auth.signOut();
  await new Promise((r) => setTimeout(r, 300));
  if (!error) return { email, entra: true, provisoria: true, nota: "" };
  const credencial = /invalid login credentials/i.test(error.message);
  return {
    email,
    entra: credencial, // credencial inválida = la cuenta FUNCIONA pero con clave propia
    provisoria: false,
    nota: credencial ? "clave propia" : error.message,
  };
};

const armarFila = async (id) => {
  const u = (us ?? []).find((x) => x.id === id);
  const r = await probar(u);
  return {
    nombre: u.nombre,
    rol: u.rol,
    zona: zonaDe.get(u.zona_id) ?? "—",
    email: r.email,
    activo: u.activo,
    cartera: carteraDe.get(u.id) ?? 0,
    comision: u.rol === "cobrador" ? Number(u.comision_pct ?? 0) : null,
    entra: r.entra,
    provisoria: r.provisoria,
    nota: r.nota,
  };
};
const filas = [];
for (const id of hallados.keys()) filas.push(await armarFila(id));
const filasOficina = [];
for (const id of oficina.keys()) filasOficina.push(await armarFila(id));

// ── Salida ──
filas.sort((a, b) => b.cartera - a.cartera || a.nombre.localeCompare(b.nombre));
const linea = (f) => {
  const extra = f.rol === "cobrador" ? `${String(f.cartera).padStart(4)} clientes · ${f.comision}%` : f.rol.padEnd(10);
  const estado = !f.activo ? "⚠ DE BAJA" : f.provisoria ? "clave de arranque ✓" : f.entra ? "CLAVE PROPIA (no usa la de arranque)" : `✗ ${f.nota}`;
  const nota = f.email.startsWith("maria.curbelo@") ? "   ← “María Inocencia” de tu lista" : "";
  return `  ${f.nombre.padEnd(26)} ${f.email.padEnd(36)} ${extra.padEnd(20)} ${estado}${nota}\n`;
};

let out = `PRESTA YA — USUARIOS DEL PILOTO (Zona Centro · lista de Carlos, 05-08)\n`;
out += `Entrar: ${APP}/ingresar   ·   Login = email + contraseña\n`;
out += `Contraseña de arranque (todos salvo los marcados): ${PASS}\n`;
out += `Al entrar, la app misma les pide: 1) poner clave propia  2) instalar la app en el teléfono.\n`;
out += "=".repeat(100) + "\n";
const conCartera = filas.filter((f) => f.cartera > 0);
const sinCartera = filas.filter((f) => f.cartera === 0);
out += `\n### COBRADORES CON RUTA (${conCartera.length}) — ${conCartera.reduce((s, f) => s + f.cartera, 0)} clientes\n`;
for (const f of conCartera) out += linea(f);
out += `\n### NUEVOS SIN RUTA TODAVÍA (${sinCartera.length}) — ya en Zona Centro; falta asignarles cartera y % de comisión\n`;
for (const f of sinCartera) out += linea(f);
out += `\n### OFICINA — no estaban en tu lista pero también entran\n`;
for (const f of filasOficina) out += linea(f);
if (faltantes.length) {
  out += `\n### ⚠ DE TU LISTA, NO ENCONTRADOS (${faltantes.length})\n`;
  for (const f of faltantes) out += `  · ${f}\n`;
}
out += `\nVista del CLIENTE: sin login — cada cliente entra por su link/QR personal (lo entrega el cobrador).\n`;

writeFileSync("C:/Users/Carlos/Desktop/USUARIOS-PILOTO-0805.txt", out, "utf-8");
console.log(out);
console.log("→ C:/Users/Carlos/Desktop/USUARIOS-PILOTO-0805.txt");
