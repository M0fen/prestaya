// ─────────────────────────────────────────────────────────────────────────
//  Importa las fotos generadas con HIGGSFIELD (16-08) al bucket `tienda` y
//  actualiza `productos.fotos` con la galería de 3 tomas por producto:
//  [héroe frontal, ángulo 3/4, lifestyle]. También sube el banner OG.
//
//  · Idempotente: upsert al Storage y update del array completo.
//  · Solo toca los 11 productos PROPIOS listados (por nombre EXACTO).
//  · Uso: node --env-file=.env.local scripts/importar-fotos-higgsfield-0815.mjs
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CF = "https://d8j0ntlcm91z4.cloudfront.net/user_3Egzf10T8W5hBwaQHPK99QV30Tv";
const A = `${CF}/hf_20260816_020343`; // lote A: héroes
const B = `${CF}/hf_20260816_020424`; // lote B: ángulo 3/4
const C = `${CF}/hf_20260816_020506`; // lote C: lifestyle

/** nombre EXACTO en la base → slug de archivo → [héroe, ángulo, lifestyle] */
const PRODUCTOS = [
  ["Heladera No Frost 300L", "heladera-no-frost-300l", [`${A}_b7055dca-6d6a-4eff-8fe3-50ff7aa4218a.png`, `${B}_5afffdec-0142-49c9-a123-69c6e49301eb.png`, `${C}_ddb401f8-57e3-4d1a-96a0-4a65c57278b5.png`]],
  ['Smart TV 50" 4K UHD', "smart-tv-50-4k-uhd", [`${A}_b3464418-b883-442f-964d-e70b3bd3186c.png`, `${B}_342372bc-477a-4345-bf7d-704b3a5f1007.png`, `${C}_72dccfef-2c0c-450e-8b98-e9d624948c68.png`]],
  ["Lavarropas Automático 8kg", "lavarropas-automatico-8kg", [`${A}_4d275939-1350-49d2-b742-7f8beae66040.png`, `${B}_558c2ece-165e-416e-b104-440556a46e4e.png`, `${C}_5184f42b-97f3-40e2-a5c0-00e62961bce7.png`]],
  ["Cocina a Gas 4 Hornallas", "cocina-a-gas-4-hornallas", [`${A}_b337a891-df5c-4b1f-ba3b-7dac03d57d4f.png`, `${B}_b92bf1c3-344d-441e-89e3-1ad094cfd246.png`, `${C}_f8280d12-916e-4067-8c55-ea260ffac6a7.png`]],
  ["Aire Split 12.000 BTU Frío/Calor", "aire-split-12000-btu", [`${A}_3b668bb1-06a1-4252-80d5-b5bc1e88d725.png`, `${B}_7c94842d-ebe2-461f-a69b-927c16e9039c.png`, `${C}_0386c81c-d273-407b-80c6-9d9529022df8.png`]],
  ["Microondas 20L", "microondas-20l", [`${A}_d8d69e1f-5be9-4554-971b-23227002fdf0.png`, `${B}_85cbe7ea-a9b2-4689-b454-c67d42990d12.png`, `${C}_9bb0efde-cb27-4407-b8b0-cf413dade5f1.png`]],
  ["Lavavajillas 12 Cubiertos", "lavavajillas-12-cubiertos", [`${A}_8ba8d241-d667-47e0-b1b3-3e8b42139bd9.png`, `${B}_5978e4fe-40c9-4be8-9bce-7118874e6d6f.png`, `${C}_df022d0a-8369-4d8b-9fa4-4ef904099012.png`]],
  ["Termotanque Eléctrico 50L", "termotanque-electrico-50l", [`${A}_401bdec4-4819-40d7-ba85-34b5483e99cd.png`, `${B}_d2276231-0ccb-4dd1-80e1-159ccec50d82.png`, `${C}_9d21e237-baeb-4633-b4d4-4b559c76bf87.png`]],
  ["Celular Smartphone 128GB", "celular-smartphone-128gb", [`${A}_187303aa-6a41-4f53-b51e-4c3611d9118a.png`, `${B}_a82b0058-58ea-4510-81ca-edd368424761.png`, `${C}_e70b3c55-e6e9-498d-b97b-02819ae646a0.png`]],
  ['Notebook 15.6" Core i5', "notebook-156-core-i5", [`${A}_f1bac999-fc89-4330-b396-f074e014cfef.png`, `${B}_545ca17b-e4a5-43ce-981c-3a69b12d359a.png`, `${C}_2aa0a23f-8169-4f8f-8fd4-000c613b1dc4.png`]],
  ['Ventilador de Pie 20"', "ventilador-de-pie-20", [`${A}_202f8a5a-bb67-4d6d-af94-75ac89c9203a.png`, `${B}_dd6d13bd-5a69-4a04-a12d-5f79eaaaaf57.png`, `${C}_2e1ca378-dbca-4a90-bef1-d805062a9741.png`]],
];
const OG_BANNER = `${A}_dbc20cd8-6bca-438a-8956-98d6d9cb6f92.png`;

/** Reintenta CUALQUIER paso de red (la descarga Y la subida): la red de hoy
 *  viene con timeouts intermitentes hacia los dos lados. */
async function conReintentos(etiqueta, fn, intentos = 5) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= intentos) throw e;
      console.log(`  · blip de red en ${etiqueta} (${i}/${intentos}), reintento…`);
      await new Promise((res) => setTimeout(res, 3000 * i));
    }
  }
}

async function subir(origen, destino) {
  const buf = await conReintentos(`descarga ${destino}`, async () => {
    const r = await fetch(origen);
    if (!r.ok) throw new Error(`descarga ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  });
  await conReintentos(`subida ${destino}`, async () => {
    const { error } = await db.storage.from("tienda").upload(destino, buf, {
      contentType: "image/png",
      upsert: true,
    });
    if (error) throw error;
  });
  return { url: db.storage.from("tienda").getPublicUrl(destino).data.publicUrl, kb: Math.round(buf.length / 1024) };
}

let totalKb = 0;
for (const [nombre, slug, urls] of PRODUCTOS) {
  const { data: prod, error } = await conReintentos(`buscar ${nombre}`, () =>
    db.from("productos").select("id, nombre, fotos").eq("nombre", nombre).maybeSingle(),
  );
  if (error) throw error;
  if (!prod) { console.log(`⚠️  NO ENCONTRADO en la base: ${nombre} — salto`); continue; }
  // REANUDABLE: si este producto ya tiene su galería nueva completa, saltar.
  if (Array.isArray(prod.fotos) && prod.fotos.length === 3 && prod.fotos.every((f) => f.includes(`/productos/${slug}-`))) {
    console.log(`○ ${nombre}: ya migrado — salto`);
    continue;
  }
  const fotos = [];
  for (let i = 0; i < urls.length; i++) {
    const toma = ["01", "02", "03"][i];
    const { url, kb } = await subir(urls[i], `productos/${slug}-${toma}.png`);
    fotos.push(url);
    totalKb += kb;
  }
  const { error: e2 } = await conReintentos(`update ${nombre}`, () =>
    db.from("productos").update({ fotos }).eq("id", prod.id),
  );
  if (e2) throw e2;
  console.log(`✓ ${nombre}: galería de ${fotos.length} fotos`);
}

const og = await subir(OG_BANNER, "og/og-tienda.png");
console.log(`✓ Banner OG de portada: ${og.url}`);
console.log(`\nListo: ${PRODUCTOS.length} productos · ${Math.round(totalKb / 1024)} MB subidos al bucket.`);
