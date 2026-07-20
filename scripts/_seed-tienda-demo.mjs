// Siembra 11 productos DEMO de electro (imágenes IA → bucket 'tienda' de Supabase).
//   node --env-file=.env.local scripts/_seed-tienda-demo.mjs           # sembrar
//   node --env-file=.env.local scripts/_seed-tienda-demo.mjs --limpiar # borrar los demo
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(url, key, { auth: { persistSession: false } });
const LIMPIAR = process.argv.includes("--limpiar");

// nombre, marca, categoría (por nombre), precio, antes(0=sin), cuotas, frecuencia, destacado, imgUrl, descripcion
const P = [
  ["Heladera No Frost 300L", "Samsung", "Heladeras y Freezers", 42000, 48000, 12, "semanal", true,
    "https://d8j0ntlcm91z4.cloudfront.net/user_3Egzf10T8W5hBwaQHPK99QV30Tv/hf_20260720_165930_96b908d5-7766-4849-ad9c-e263f793a11b.png",
    "Heladera No Frost de 300 litros, bajo consumo. Amplia, silenciosa y con freezer arriba. Ideal para toda la familia."],
  ["Lavarropas Automático 8kg", "LG", "Lavarropas y Secarropas", 33000, 0, 12, "semanal", false,
    "https://d8j0ntlcm91z4.cloudfront.net/user_3Egzf10T8W5hBwaQHPK99QV30Tv/hf_20260720_165945_9d25c994-75d7-4df8-a14d-6e197ebff3fe.png",
    "Carga frontal de 8 kg, múltiples programas de lavado. Eficiente y fácil de usar."],
  ["Smart TV 50\" 4K UHD", "Samsung", "Televisores", 27000, 31000, 12, "semanal", true,
    "https://d8j0ntlcm91z4.cloudfront.net/user_3Egzf10T8W5hBwaQHPK99QV30Tv/hf_20260720_165948_6e614062-d24e-42f7-a0bc-086117af9644.png",
    "Televisor Smart de 50 pulgadas 4K. Netflix, YouTube y más, con imagen nítida y colores vivos."],
  ["Cocina a Gas 4 Hornallas", "Whirlpool", "Cocinas y Hornos", 21000, 0, 10, "semanal", false,
    "https://d8j0ntlcm91z4.cloudfront.net/user_3Egzf10T8W5hBwaQHPK99QV30Tv/hf_20260720_165950_31c40d9b-6aa5-4965-88b7-daa3188849d4.png",
    "Cocina a gas con horno y 4 hornallas. Encendido automático y acabado en acero inoxidable."],
  ["Aire Split 12.000 BTU Frío/Calor", "LG", "Aire acondicionado", 39000, 44000, 18, "semanal", true,
    "https://d8j0ntlcm91z4.cloudfront.net/user_3Egzf10T8W5hBwaQHPK99QV30Tv/hf_20260720_165952_5afe2435-652a-4c72-a62e-65a7aee98cc8.png",
    "Aire acondicionado split 12.000 BTU frío/calor. Bajo consumo, instalación incluida a consultar."],
  ["Microondas 20L", "BGH", "Microondas", 8500, 0, 8, "semanal", false,
    "https://d8j0ntlcm91z4.cloudfront.net/user_3Egzf10T8W5hBwaQHPK99QV30Tv/hf_20260720_165954_341323c3-fe09-41ae-9be2-c65394d5ae98.png",
    "Microondas de 20 litros con varios niveles de potencia y descongelado rápido."],
  ["Lavavajillas 12 Cubiertos", "Whirlpool", "Lavavajillas", 36000, 0, 15, "semanal", false,
    "https://d8j0ntlcm91z4.cloudfront.net/user_3Egzf10T8W5hBwaQHPK99QV30Tv/hf_20260720_165956_a3071da3-efc3-49cb-b57c-bbcd853b7259.png",
    "Lavavajillas para 12 cubiertos. Deja todo brillante y te ahorra tiempo y agua."],
  ["Termotanque Eléctrico 50L", "James", "Termotanques y Calefones", 12000, 0, 10, "semanal", false,
    "https://d8j0ntlcm91z4.cloudfront.net/user_3Egzf10T8W5hBwaQHPK99QV30Tv/hf_20260720_165958_ee73fa2d-5111-4f67-b9cf-6a8b983e9a83.png",
    "Termotanque eléctrico de 50 litros. Agua caliente segura para toda la casa."],
  ["Celular Smartphone 128GB", "Motorola", "Celulares y Tablets", 16000, 19000, 12, "semanal", true,
    "https://d8j0ntlcm91z4.cloudfront.net/user_3Egzf10T8W5hBwaQHPK99QV30Tv/hf_20260720_170001_f1ae9583-b6a5-44ba-b3cb-74b79da2f78c.png",
    "Smartphone con 128GB, buena cámara y batería para todo el día. Libre para cualquier compañía."],
  ["Notebook 15.6\" Core i5", "Lenovo", "Notebooks y PC", 34000, 0, 18, "semanal", false,
    "https://d8j0ntlcm91z4.cloudfront.net/user_3Egzf10T8W5hBwaQHPK99QV30Tv/hf_20260720_170004_509d281e-0c54-49f2-bda9-1374d580e434.png",
    "Notebook de 15,6 pulgadas, procesador Core i5, ideal para estudiar y trabajar."],
  ["Ventilador de Pie 20\"", "Liliana", "Ventiladores", 3200, 0, 6, "semanal", false,
    "https://d8j0ntlcm91z4.cloudfront.net/user_3Egzf10T8W5hBwaQHPK99QV30Tv/hf_20260720_170006_e891999a-9d6e-4bf0-aad4-256f84c6ec2c.png",
    "Ventilador de pie de 20 pulgadas, 3 velocidades y altura regulable."],
];
const NOMBRES = P.map((p) => p[0]);

async function limpiar() {
  const { data } = await db.from("productos").select("id, fotos").in("nombre", NOMBRES);
  for (const pr of data ?? []) {
    for (const url of pr.fotos ?? []) {
      const m = url.match(/\/tienda\/(.+)$/);
      if (m) await db.storage.from("tienda").remove([m[1]]);
    }
  }
  const { error } = await db.from("productos").delete().in("nombre", NOMBRES);
  console.log(error ? "ERROR: " + error.message : `Borrados ${data?.length ?? 0} productos demo (y sus fotos).`);
}

async function sembrar() {
  // Mapa de categorías por nombre.
  const { data: cats } = await db.from("categorias_producto").select("id, nombre");
  const catId = new Map((cats ?? []).map((c) => [c.nombre.toLowerCase(), c.id]));
  let ok = 0;
  for (let i = 0; i < P.length; i++) {
    const [nombre, marca, cat, precio, antes, cuotas, frecuencia, destacado, imgUrl, descripcion] = P[i];
    // Descargar la imagen IA y subirla al bucket 'tienda'.
    let fotoUrl = null;
    try {
      const resp = await fetch(imgUrl);
      if (!resp.ok) throw new Error("descarga " + resp.status);
      const buf = Buffer.from(await resp.arrayBuffer());
      const path = `demo/${String(i + 1).padStart(2, "0")}-${nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}.png`;
      const up = await db.storage.from("tienda").upload(path, buf, { contentType: "image/png", upsert: true });
      if (up.error) throw up.error;
      fotoUrl = db.storage.from("tienda").getPublicUrl(path).data.publicUrl;
    } catch (e) {
      console.log(`  ⚠️ ${nombre}: imagen falló (${e.message}) — se crea sin foto`);
    }
    const { error } = await db.from("productos").insert({
      nombre, marca, descripcion,
      categoria_id: catId.get(cat.toLowerCase()) ?? null,
      precio, precio_anterior: antes > 0 ? antes : null,
      interes_pct: 0, cuotas, frecuencia,
      fotos: fotoUrl ? [fotoUrl] : [],
      activo: true, destacado, orden: i,
    });
    if (error) console.log(`  ❌ ${nombre}: ${error.message}`);
    else { ok++; console.log(`  ✅ ${nombre}${fotoUrl ? " (con foto)" : ""}`); }
  }
  console.log(`\nSembrados ${ok}/${P.length} productos demo.`);

  // Un token de cliente para el link de prueba (cliente activo con crédito activo).
  const { data: cli } = await db.from("clientes").select("id, nombre, token").eq("activo", true).not("token", "is", null).limit(30);
  let elegido = null;
  for (const c of cli ?? []) {
    const { count } = await db.from("prestamos").select("*", { count: "exact", head: true }).eq("cliente_id", c.id).eq("estado", "activo");
    if ((count ?? 0) > 0) { elegido = c; break; }
  }
  if (elegido) {
    console.log(`\n🔗 LINK DE PRUEBA (cliente ${elegido.nombre}):`);
    console.log(`   Cuenta:  https://prestaya-blush.vercel.app/c/${elegido.token}`);
    console.log(`   Tienda:  https://prestaya-blush.vercel.app/c/${elegido.token}/tienda`);
  } else {
    console.log("\n(No encontré un cliente activo con token para el link — mirá /admin/tienda igual.)");
  }
}

(LIMPIAR ? limpiar() : sembrar()).catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
