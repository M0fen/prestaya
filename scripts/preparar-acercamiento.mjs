// ─────────────────────────────────────────────────────────────────────────
//  PREPARAR ACERCAMIENTO: deja la base lista para presentar.
//   1) Nombres LEGIBLES: título-case de los nombres importados (MAYÚSCULAS de
//      Disapp). Los nombres ya "lindos" (admins, supervisores) se dejan igual.
//   2) SIN ZONAS: zona_id = null en todos los usuarios (operación plana; los
//      supervisores pasan a ver todo). No borra la tabla de zonas (reversible).
//   3) LOGIN para TODOS los cobradores: password = PrestaYa2026! (los que ya
//      tienen cuenta auth del import; se lista email+clave al final).
//   4) BANNERS de bienvenida (anuncios) idempotentes.
//   Dry-run:  node --env-file=.env.local scripts/preparar-acercamiento.mjs
//   Aplicar:  node --env-file=.env.local scripts/preparar-acercamiento.mjs --commit
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const COMMIT = process.argv.includes("--commit");
const PASS = "PrestaYa2026!";
const log = (...a) => console.log(...a);

// ── Título-case legible (preserva acentos). Solo se aplica si el nombre está en
//    MAYÚSCULAS (importado de Disapp); si ya tiene minúsculas, se respeta. ──────
function limpiarNombre(n) {
  if (!n) return n;
  const t = n.trim().replace(/\s+/g, " ").replace(/[.,\s]+$/, ""); // colapsa espacios, saca coma/punto final
  // "de Disapp" = MAYORÍA de letras en mayúscula (tolera un acento minúsculo suelto
  // como "FáTIMA"); los nombres ya "lindos" (César, Angie…) tienen minúsculas y se dejan.
  const upper = (t.match(/[A-ZÁÉÍÓÚÑÜ]/g) || []).length;
  const lower = (t.match(/[a-záéíóúñü]/g) || []).length;
  const esMayus = upper > 0 && upper >= lower;
  if (!esMayus) return n === t ? n : t; // ya lindo: solo recorto basura de borde
  return t
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

log("URL:", process.env.NEXT_PUBLIC_SUPABASE_URL, "| modo:", COMMIT ? "COMMIT" : "DRY-RUN");

// ── Cargar usuarios + emails de auth ────────────────────────────────────────
const { data: us, error: eus } = await db.from("usuarios").select("id, nombre, rol, zona_id, auth_user_id");
if (eus) { console.error("usuarios ERR:", eus.message); process.exit(1); }

const emailPorAuth = new Map();
for (let page = 1; page <= 15; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) { console.error("listUsers:", error.message); break; }
  for (const u of data.users) if (u.email) emailPorAuth.set(u.id, u.email);
  if (data.users.length < 200) break;
}

// ── 1+2) Nombres + zonas ────────────────────────────────────────────────────
let renombrados = 0, zonasLimpias = 0;
const credenciales = [];
for (const u of us ?? []) {
  const nuevo = limpiarNombre(u.nombre);
  const cambiaNombre = nuevo && nuevo !== u.nombre;
  const cambiaZona = u.zona_id != null;
  if (cambiaNombre) renombrados++;
  if (cambiaZona) zonasLimpias++;
  if (cambiaNombre) log(`  nombre: "${u.nombre}"  ->  "${nuevo}"`);
  if (COMMIT && (cambiaNombre || cambiaZona)) {
    const patch = { zona_id: null };
    if (cambiaNombre) patch.nombre = nuevo;
    const { error } = await db.from("usuarios").update(patch).eq("id", u.id);
    if (error) log(`   ! update ${u.id}: ${error.message}`);
  }
  // Recolecta credenciales de cobradores (para el listado + reset de clave)
  if (u.rol === "cobrador") {
    credenciales.push({ nombre: nuevo || u.nombre, email: emailPorAuth.get(u.auth_user_id) ?? "(sin auth)", authId: u.auth_user_id });
  }
}
log(`\n[1] nombres a limpiar: ${renombrados}`);
log(`[2] zonas a limpiar (zona_id->null): ${zonasLimpias}`);

// ── 3) Login para todos los cobradores (password = PrestaYa2026!) ────────────
let claves = 0, sinAuth = 0;
for (const c of credenciales) {
  if (!c.authId) { sinAuth++; continue; }
  if (COMMIT) {
    const { error } = await db.auth.admin.updateUserById(c.authId, { password: PASS });
    if (error) { log(`   ! clave ${c.nombre}: ${error.message}`); continue; }
  }
  claves++;
}
log(`\n[3] cobradores con login (clave=${PASS}): ${claves}  (sin cuenta auth: ${sinAuth})`);

// ── 4) Banners de bienvenida ────────────────────────────────────────────────
const BID = (n) => `b1e0c0de-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BIENVENIDA = [
  { n: 1, segmento: "todos", tema: "azul", prioridad: 100, titulo: "¡Bienvenido a Presta Ya! 💙", cuerpo: "Somos tu mejor opción. Acá ves tu crédito, tus pagos y tu progreso, siempre a mano." },
  { n: 2, segmento: "al_dia", tema: "verde", prioridad: 90, titulo: "¡Vas al día! 🎉", cuerpo: "Tu constancia te acerca a un préstamo más grande en tu próxima renovación." },
  { n: 3, segmento: "con_pendientes", tema: "ambar", prioridad: 90, titulo: "Cada pago suma 💪", cuerpo: "Ponete al día de a poco: cada cuota te acerca a tu meta." },
  { n: 4, segmento: "todos", tema: "oscuro", prioridad: 80, titulo: "Cobro de lunes a sábado 🗓️", cuerpo: "El domingo no se cobra. Organizá tus pagos con tranquilidad." },
  { n: 5, segmento: "todos", tema: "verde", prioridad: 60, titulo: "Renová y crecé 🚀", cuerpo: "Cuando termines tu crédito, podés renovar por un monto mayor." },
];
if (COMMIT) {
  const filas = BIENVENIDA.map((b) => ({
    id: BID(b.n), segmento: b.segmento, tema: b.tema, prioridad: b.prioridad,
    titulo: b.titulo, cuerpo: b.cuerpo, activo: true, desde: "2026-07-01T00:00:00-03:00",
  }));
  const { error } = await db.from("anuncios").upsert(filas, { onConflict: "id" });
  if (error) log("   ! anuncios:", error.message); else log(`\n[4] banners de bienvenida: ${filas.length} (upsert)`);
} else {
  log(`\n[4] banners de bienvenida a sembrar: ${BIENVENIDA.length}`);
}

// ── Listado de credenciales (para entregar) ─────────────────────────────────
log(`\n=== CREDENCIALES COBRADORES (clave = ${PASS}) ===`);
for (const c of credenciales.sort((a, b) => a.nombre.localeCompare(b.nombre)))
  log(`  ${c.nombre.slice(0, 32).padEnd(32)}  ${c.email}`);

log(COMMIT ? "\n✓ APLICADO." : "\nDRY-RUN (no se escribió). Corré con --commit para aplicar.");
