// ¿Qué le pasa DE VERDAD al supervisor en las pantallas que la sonda marcó mal?
// Se mira la cadena completa de respuestas (redirects incluidos) y el texto final,
// para separar "lo mandaron a otra pantalla" (correcto) de "explotó" (bug).
import { chromium } from "playwright-core";

const BASE = "https://prestaya.uy";
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const RUTAS = [
  ["/admin", "raíz del panel"],
  ["/admin/chat", "Chat (el nav se lo muestra)"],
  ["/admin/notas", "Notas (el nav se lo muestra)"],
  ["/admin/tutorial", "Cómo se usa (el nav se lo muestra)"],
  ["/admin/seguridad", "Seguridad (el nav se lo muestra)"],
  ["/admin/banner-equipo", "Banner al equipo (el nav se lo muestra)"],
  ["/admin/anuncios", "Anuncios al cliente (el nav se lo muestra)"],
  ["/admin/renovaciones", "Pedidos y renovaciones (el nav se lo muestra)"],
  ["/admin/altas", "Altas en la app (el nav se lo muestra)"],
  ["/admin/valor", "Valor (admin-only)"],
  ["/admin/tienda", "Tienda (admin-only)"],
];

const b = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await b.newContext();
const page = await ctx.newPage();
page.setDefaultTimeout(120000);

await page.goto(`${BASE}/ingresar`, { waitUntil: "domcontentloaded" });
await page.fill('input[type="email"]', process.env.SUP_EMAIL || "cesar.rendon@prestaya.uy");
await page.fill('input[type="password"]', "PrestaYa2026!");
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin/, { timeout: 120000 });
console.log("supervisor adentro. Después del login quedó en:", page.url().replace(BASE, ""), "\n");

for (const [ruta, que] of RUTAS) {
  const cadena = [];
  const onResp = (r) => {
    const u = r.url().replace(BASE, "");
    if (u.startsWith("/admin") && r.request().resourceType() === "document") cadena.push(`${r.status()} ${u}`);
  };
  page.on("response", onResp);
  let err = "";
  const t = Date.now();
  try {
    await page.goto(`${BASE}${ruta}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(600);
  } catch (e) {
    err = String(e).split("\n")[0].slice(0, 70);
  }
  const ms = Date.now() - t;
  page.off("response", onResp);
  let texto = "";
  try {
    texto = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
  } catch { texto = "(no se pudo leer)"; }
  const final = page.url().replace(BASE, "");
  const h1 = texto.slice(0, 90);
  console.log(`${ruta}  (${que})`);
  console.log(`   ${ms} ms · terminó en ${final}`);
  console.log(`   cadena: ${cadena.slice(0, 6).join("  →  ") || "(sin documentos)"}${cadena.length > 6 ? ` … ${cadena.length} saltos` : ""}`);
  if (err) console.log(`   navegación: ${err}`);
  console.log(`   pantalla: ${h1 || "(vacía)"}`);
  console.log("");
}
await b.close();
