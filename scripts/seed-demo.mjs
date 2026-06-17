// ─────────────────────────────────────────────────────────────────────────
//  Carga datos de DEMO en Supabase para probar la vista por token.
//  Crea (o reemplaza) un cliente "María Fernanda" con un crédito activo.
//  Token del link: demo-maria-fernanda  →  /c/demo-maria-fernanda
//
//  Es idempotente: borra el demo anterior (por IDs fijos) y lo vuelve a crear.
//  Ejecutar:  node --env-file=.env.local scripts/seed-demo.mjs
//
//  Para BORRAR el demo:  node --env-file=.env.local scripts/seed-demo.mjs --limpiar
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("✗ Faltan variables en .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const CLIENTE_ID = "00000000-0000-0000-0000-000000000001";
const PRESTAMO_ID = "00000000-0000-0000-0000-0000000000a1";
const ANUNCIO_IDS = [
  "00000000-0000-0000-0000-0000000000b1",
  "00000000-0000-0000-0000-0000000000b2",
  "00000000-0000-0000-0000-0000000000b3",
];
const TOKEN = "demo-maria-fernanda";

function check(label, error) {
  if (error) {
    console.error(`✗ ${label}: ${error.message}`);
    process.exit(1);
  }
  console.log(`✓ ${label}`);
}

// Limpieza del demo anterior (respeta el orden por las llaves foráneas).
async function limpiar() {
  check("borrar pagos demo", (await db.from("pagos").delete().eq("prestamo_id", PRESTAMO_ID)).error);
  check("borrar préstamo demo", (await db.from("prestamos").delete().eq("id", PRESTAMO_ID)).error);
  check("borrar cliente demo", (await db.from("clientes").delete().eq("id", CLIENTE_ID)).error);
  // Los anuncios son opcionales: si la tabla aún no existe (falta 0003),
  // se avisa pero no se aborta el seed.
  const delAnuncio = await db.from("anuncios").delete().in("id", ANUNCIO_IDS);
  if (delAnuncio.error) console.log(`· (anuncios) ${delAnuncio.error.message}`);
}

await limpiar();

if (process.argv.includes("--limpiar")) {
  console.log("\nDemo eliminado ✅");
  process.exit(0);
}

// fecha_inicio = hoy − 11 días  →  hoy es el día 12 del crédito.
const inicio = new Date();
inicio.setHours(0, 0, 0, 0);
inicio.setDate(inicio.getDate() - 11);
const fecha_inicio = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, "0")}-${String(inicio.getDate()).padStart(2, "0")}`;

check(
  "crear cliente",
  (
    await db.from("clientes").insert({
      id: CLIENTE_ID,
      nombre: "María Fernanda",
      documento: "12345678",
      telefono: "099 123 456",
      direccion: "Av. 18 de Julio 1234, Montevideo",
      token_acceso: TOKEN,
      calificacion: "bueno",
      activo: true,
    })
  ).error,
);

check(
  "crear préstamo",
  (
    await db.from("prestamos").insert({
      id: PRESTAMO_ID,
      cliente_id: CLIENTE_ID,
      monto_prestado: 500000,
      cuota_diaria: 20000,
      total_dias: 30,
      fecha_inicio,
      estado: "activo",
    })
  ).error,
);

// Días 1–10 pagados completos + abono parcial el día 12 (hoy).
// Día 11 sin pago → atrasado. Días 13–30 → futuros.
const pagos = [
  ...Array.from({ length: 10 }, (_, i) => ({
    prestamo_id: PRESTAMO_ID,
    dia_credito: i + 1,
    monto: 20000,
  })),
  { prestamo_id: PRESTAMO_ID, dia_credito: 12, monto: 10000 },
];
check("crear pagos", (await db.from("pagos").insert(pagos)).error);

// Anuncios de demo (opcional). Requiere haber corrido la migración 0003.
const anuncio = await db.from("anuncios").insert([
  {
    id: ANUNCIO_IDS[0],
    titulo: "¡Vamos al Mundial 2026! 🏆",
    cuerpo: "Jugá la tanda de penales y, si estás al día, participás del sorteo del mes.",
    cta_texto: "Jugar penales",
    cta_url: "#",
    tema: "azul",
    prioridad: 30,
    activo: true,
    segmento: "todos",
  },
  {
    id: ANUNCIO_IDS[1],
    titulo: "Feriado: cerramos el jueves 18/6 📅",
    cuerpo: "Ese día no pasa el cobrador. Podés adelantar tu cuota el miércoles.",
    tema: "ambar",
    prioridad: 20,
    activo: true,
    segmento: "todos",
  },
  {
    id: ANUNCIO_IDS[2],
    titulo: "Premio a tu constancia 🎁",
    cuerpo: "Pagá 10 días seguidos sin atrasos y accedé a un descuento en tu próximo crédito.",
    cta_texto: "Ver beneficios",
    cta_url: "#",
    tema: "verde",
    prioridad: 10,
    activo: true,
    segmento: "todos",
  },
]);
if (anuncio.error) {
  console.log(`· (anuncios) omitidos: ${anuncio.error.message}`);
  console.log("   → corré la migración 0003_anuncios.sql y volvé a ejecutar.");
} else {
  console.log("✓ crear anuncios (3)");
}

console.log(`\nDemo cargado ✅  Abrí:  /c/${TOKEN}`);
console.log(`(fecha_inicio = ${fecha_inicio}, hoy = día 12)`);
