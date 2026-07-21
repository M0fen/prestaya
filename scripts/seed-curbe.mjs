// ─────────────────────────────────────────────────────────────────────────
//  Aviso de CURBE (anunciante) en los dos banners. Idempotente (IDs fijos +
//  upsert). Rehospeda la foto de curbe en NUESTRO bucket `anuncios` porque la
//  CSP (img-src) no permite el host de curbe → si no, la imagen se bloquea.
//    Sembrar:  node --env-file=.env.local scripts/seed-curbe.mjs
//    Quitar:   node --env-file=.env.local scripts/seed-curbe.mjs --limpiar
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const LIMPIAR = process.argv.includes("--limpiar");

// Contenido REAL de curbe.uy.
const LINK = "https://curbe.uy";
const IMG_FUENTE = "https://gwmtadnxp4vehblf.public.blob.vercel-storage.com/products/la-vida-es-bella-1780431196149.jpg";
const IMG_FALLBACK = "https://gwmtadnxp4vehblf.public.blob.vercel-storage.com/sections/banner-para-ella-mobile-1780436557809.jpg";
const RUTA_BUCKET = "curbe/curbe-portada.jpg"; // nombre fijo → re-subir sobreescribe

const ID_ANUNCIO = "c0b0e000-0000-4000-8000-000000000001"; // cliente (carrusel)
const ID_BANNER = "c0b0e000-0000-4000-8000-000000000002"; // cobrador (oferta)

async function main() {
  if (LIMPIAR) {
    const a = await db.from("anuncios").delete().eq("id", ID_ANUNCIO);
    const b = await db.from("banner_cobrador").delete().eq("id", ID_BANNER);
    await db.storage.from("anuncios").remove([RUTA_BUCKET]).catch(() => {});
    if (a.error) console.error("anuncio:", a.error.message);
    if (b.error) console.error("banner:", b.error.message);
    console.log("✓ Aviso de curbe quitado (cliente + cobrador).");
    return;
  }

  // 1) Rehospedar la imagen en nuestro bucket (CSP-friendly). Si falla, seguimos sin imagen.
  let imagenUrl = null;
  for (const fuente of [IMG_FUENTE, IMG_FALLBACK]) {
    try {
      const resp = await fetch(fuente);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      const up = await db.storage
        .from("anuncios")
        .upload(RUTA_BUCKET, buf, { contentType: "image/jpeg", upsert: true });
      if (up.error) throw up.error;
      imagenUrl = db.storage.from("anuncios").getPublicUrl(RUTA_BUCKET).data.publicUrl;
      console.log("✓ Imagen rehospedada:", imagenUrl);
      break;
    } catch (e) {
      console.warn(`… no se pudo con ${fuente}: ${e.message}`);
    }
  }
  if (!imagenUrl) console.warn("⚠ Sin imagen: el aviso queda en modo texto (igual se ve premium).");

  // 2) Cliente — anuncio del carrusel (tema dorado + etiqueta "Publicidad").
  const anuncio = {
    id: ID_ANUNCIO,
    titulo: "curbe — perfumería y oro 18k",
    cuerpo: "Esencias inspiradas y oro italiano 18k. Perfumes 50ml desde $890.",
    cta_texto: "Ver curbe",
    cta_url: LINK,
    imagen_url: imagenUrl,
    etiqueta: "Publicidad",
    tema: "dorado",
    prioridad: 40, // moderada: no tapa nuestros propios mensajes de aliento
    activo: true,
    segmento: "todos",
    fecha_inicio: "2026-07-01T00:00:00-03:00",
    fecha_fin: null,
    creado_por: null,
  };
  const ra = await db.from("anuncios").upsert(anuncio, { onConflict: "id" });
  if (ra.error) throw new Error("anuncio: " + ra.error.message);

  // 3) Cobrador — oferta para compartir (texto client-facing → se ve bien al enviarlo).
  const banner = {
    id: ID_BANNER,
    titulo: "curbe — perfumería y oro 18k",
    texto: "Perfumes inspirados y oro italiano 18k, desde $890. Mirá la tienda 👇",
    tema: "azul", // la tarjeta de oferta usa su propio look dorado; el tema no aplica
    activo: true,
    creado_por: null,
    expira_en: null,
    imagen_url: imagenUrl,
    cta_texto: "Compartir con el cliente",
    cta_url: LINK,
  };
  const rb = await db.from("banner_cobrador").upsert(banner, { onConflict: "id" });
  if (rb.error) throw new Error("banner: " + rb.error.message);

  console.log("\n✓ Aviso de curbe ACTIVO en los dos banners:");
  console.log("  · Cliente  → carrusel, tema dorado, etiqueta 'Publicidad', link", LINK);
  console.log("  · Cobrador → oferta 'Compartir con el cliente' (Web Share → WhatsApp)");
  console.log("\nPausar/editar sin código: /admin/anuncios y /admin/banner-equipo.");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
