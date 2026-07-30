// ─────────────────────────────────────────────────────────────────────────
//  IMPORTADOR DEL CATÁLOGO DE CURBE (0112). Lee scripts/curbe-catalogo.json
//  (41 productos reales extraídos de curbe.uy: perfumes + joyería oro 18k) y los
//  carga en la Tienda Presta Ya como productos con proveedor='curbe' → cada venta
//  encola un pedido de despacho a Curbe.
//
//  · IDEMPOTENTE: id determinista por slug (md5) → re-correr ACTUALIZA, no duplica.
//  · Rehospeda cada imagen en NUESTRO bucket 'tienda' (la CSP no permite el host
//    de Curbe; así la foto no se bloquea y no dependemos de su blob).
//  · Financiación SEGURA por defecto: interés 0 (nunca cobra por debajo del precio
//    de contado) + cuotas por tramo de precio (cuota diaria razonable). El admin
//    ajusta interés/cuotas por producto cuando quiera.
//
//    Importar:  node --env-file=.env.local scripts/importar-curbe.mjs
//    Ensayo:    node --env-file=.env.local scripts/importar-curbe.mjs --dry
//    Borrador:  node --env-file=.env.local scripts/importar-curbe.mjs --borrador   (activo=false)
//    Quitar:    node --env-file=.env.local scripts/importar-curbe.mjs --limpiar
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const DRY = process.argv.includes("--dry");
const LIMPIAR = process.argv.includes("--limpiar");
const BORRADOR = process.argv.includes("--borrador");
const BUCKET = "tienda";

// UUID determinista por slug → upsert idempotente (re-correr no duplica).
function idDeSlug(slug) {
  const h = createHash("md5").update("curbe:" + slug).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Cuotas por tramo de precio (interés 0) → cuota diaria razonable para cobro diario.
function cuotasDe(precio) {
  if (precio <= 1000) return 30;    // perfume $890 → ~$30/día
  if (precio <= 3000) return 45;    // $2.000 → ~$45/día
  if (precio <= 10000) return 60;   // aretes $7.900-9.900 → ~$130-165/día
  if (precio <= 20000) return 90;   // cadenas/pulseras → ~$160-230/día
  return 120;                        // collar $34.900 → ~$291/día
}

// Orden de categoría (perfumes primero, joyería después).
const ORDEN_CAT = { "Para Ella": 0, "Para Él": 1, "Unisex": 2, "Oro 18k": 3 };

async function ensureCategoria(nombre, orden) {
  const { data } = await db.from("categorias_producto").select("id").eq("nombre", nombre).maybeSingle();
  if (data?.id) return data.id;
  if (DRY) return "(dry)";
  const { data: nueva, error } = await db
    .from("categorias_producto")
    .insert({ nombre, orden, activo: true })
    .select("id")
    .single();
  if (error) throw new Error(`categoría ${nombre}: ${error.message}`);
  return nueva.id;
}

// Descarga la imagen de Curbe y la sube a nuestro bucket → URL pública (CSP-safe).
async function rehospedar(slug, urlFuente) {
  const ruta = `curbe/${slug}.jpg`;
  if (DRY) return db.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
  try {
    const resp = await fetch(urlFuente);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const { error } = await db.storage.from(BUCKET).upload(ruta, buf, {
      contentType: resp.headers.get("content-type") || "image/jpeg",
      upsert: true,
    });
    if (error) throw error;
    return db.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
  } catch (e) {
    console.warn(`  ⚠ imagen ${slug}: ${e.message} (se importa sin foto)`);
    return null;
  }
}

async function main() {
  const productos = JSON.parse(readFileSync(join(__dir, "curbe-catalogo.json"), "utf8"));

  if (LIMPIAR) {
    const { data: viejos } = await db.from("productos").select("id").eq("proveedor", "curbe");
    const ids = (viejos ?? []).map((r) => r.id);
    if (ids.length) {
      const rutas = productos.map((p) => `curbe/${p.slug}.jpg`);
      await db.storage.from(BUCKET).remove(rutas).catch(() => {});
      const { error } = await db.from("productos").delete().in("id", ids);
      if (error) throw error;
    }
    console.log(`✓ Quitados ${ids.length} productos de Curbe.`);
    return;
  }

  console.log(`${DRY ? "[ENSAYO] " : ""}Importando ${productos.length} productos de Curbe${BORRADOR ? " (borrador/inactivos)" : " (activos)"}…`);

  // Categorías (idempotente por nombre).
  const catId = {};
  for (const nombre of Object.keys(ORDEN_CAT)) catId[nombre] = await ensureCategoria(nombre, ORDEN_CAT[nombre]);

  let ok = 0;
  let i = 0;
  for (const p of productos) {
    const id = idDeSlug(p.slug);
    const fotoUrl = await rehospedar(p.slug, p.urlImagen);
    const nombre = p.ml ? `${p.nombre} · ${p.ml}ml` : p.nombre;
    const row = {
      id,
      nombre,
      marca: null,
      descripcion: p.descripcion,
      categoria_id: catId[p.categoria] ?? null,
      precio: Math.round(p.precio),
      precio_anterior: null,
      interes_pct: 0, // financiación al precio de contado (seguro). El admin sube margen si quiere.
      cuotas: cuotasDe(p.precio),
      frecuencia: "diario",
      fotos: fotoUrl ? [fotoUrl] : [],
      video_url: null,
      activo: !BORRADOR,
      destacado: false,
      agotado: false,
      stock: null,
      orden: (ORDEN_CAT[p.categoria] ?? 9) * 100 + i,
      segmento_def: null,
      proveedor: "curbe",
    };
    if (!DRY) {
      const { error } = await db.from("productos").upsert(row, { onConflict: "id" });
      if (error) {
        console.error(`  ✗ ${p.slug}: ${error.message}`);
        i++;
        continue;
      }
    }
    ok++;
    i++;
    console.log(`  ✓ ${nombre} · $${p.precio} · ${p.categoria} · ${cuotasDe(p.precio)} cuotas`);
  }

  console.log(`\n${DRY ? "[ENSAYO] " : ""}Listo: ${ok}/${productos.length} productos de Curbe.`);
  if (!DRY) console.log("Vela en /admin/tienda (badge 💎 Curbe) y en la tienda pública /tienda.");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
