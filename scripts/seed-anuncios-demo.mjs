// ─────────────────────────────────────────────────────────────────────────
//  SEED de ANUNCIOS (banners) para la vista de cliente. Idempotente (IDs fijos
//  + upsert). Tono amable, sin alarma, sin mencionar al cobrador, sin WhatsApp
//  (reglas de la vista de cliente). Segmentado: al_dia / con_pendientes / todos.
//    Sembrar:  node --env-file=.env.local scripts/seed-anuncios-demo.mjs
//    Borrar:   node --env-file=.env.local scripts/seed-anuncios-demo.mjs --limpiar
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const LIMPIAR = process.argv.includes("--limpiar");
const ID = (n) => `a11ce001-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DESDE = "2026-07-01T00:00:00-03:00";

const ANUNCIOS = [
  { n: 1, segmento: "todos", tema: "azul", prioridad: 100,
    titulo: "Somos tu mejor opción 💙",
    cuerpo: "Gracias por elegir Presta Ya. Estamos para acompañarte en cada paso." },
  { n: 2, segmento: "al_dia", tema: "verde", prioridad: 90,
    titulo: "¡Vas al día! 🎉",
    cuerpo: "Tu constancia te abre la puerta a un préstamo más grande en tu próxima renovación." },
  { n: 3, segmento: "con_pendientes", tema: "ambar", prioridad: 90,
    titulo: "Cada pago suma 💪",
    cuerpo: "Ponete al día de a poco: cada cuota te acerca a tu meta." },
  { n: 4, segmento: "todos", tema: "oscuro", prioridad: 80,
    titulo: "Cobro de lunes a sábado 🗓️",
    cuerpo: "El domingo no se cobra. Organizá tus pagos con tranquilidad." },
  { n: 5, segmento: "al_dia", tema: "azul", prioridad: 70,
    titulo: "Cliente estrella ⭐",
    cuerpo: "Tu buen historial habla por vos. ¡Seguí así!" },
  { n: 6, segmento: "todos", tema: "verde", prioridad: 60,
    titulo: "Renová y crecé 🚀",
    cuerpo: "Cuando termines tu crédito, podés renovar por un monto mayor." },
];

const ids = ANUNCIOS.map((a) => ID(a.n));

if (LIMPIAR) {
  const { error } = await db.from("anuncios").delete().in("id", ids);
  if (error) { console.error("✗", error.message); process.exit(1); }
  console.log(`✓ ${ids.length} anuncios demo eliminados.`);
  process.exit(0);
}

const filas = ANUNCIOS.map((a) => ({
  id: ID(a.n),
  titulo: a.titulo,
  cuerpo: a.cuerpo,
  cta_texto: null,
  cta_url: null,
  imagen_url: null,
  tema: a.tema,
  prioridad: a.prioridad,
  activo: true,
  segmento: a.segmento,
  fecha_inicio: DESDE,
  fecha_fin: null,
  creado_por: null,
}));

const { error } = await db.from("anuncios").upsert(filas, { onConflict: "id" });
if (error) { console.error("✗", error.message); process.exit(1); }
console.log(`✓ ${filas.length} anuncios sembrados/actualizados:`);
for (const a of ANUNCIOS) console.log(`  [${a.segmento.padEnd(15)} · ${a.tema.padEnd(6)}] ${a.titulo}`);
console.log("\nSegmentación: 'todos' se ven siempre; 'al_dia' solo al día; 'con_pendientes' solo con pendientes.");
