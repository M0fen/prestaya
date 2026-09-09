// Captura el crash del dashboard para el SUPERVISOR con todo el detalle que se
// pueda: mensaje, stack, chunk donde ocurre y qué se alcanzó a pintar.
import { chromium } from "playwright-core";

const BASE = "https://prestaya.uy";
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const QUIEN = process.env.SUP_EMAIL || "cesar.rendon@prestaya.uy";

const b = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await b.newContext();
const page = await ctx.newPage();
page.setDefaultTimeout(120000);

const errores = [];
page.on("pageerror", (e) => errores.push({ msg: String(e.message || e).slice(0, 300), stack: String(e.stack || "").slice(0, 1200) }));
const consola = [];
page.on("console", (m) => { if (m.type() === "error") consola.push(m.text().slice(0, 300)); });

await page.goto(`${BASE}/ingresar`, { waitUntil: "domcontentloaded" });
await page.fill('input[type="email"]', QUIEN);
await page.fill('input[type="password"]', "PrestaYa2026!");
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin/, { timeout: 120000 });
await page.waitForTimeout(4000);

console.log("=== SUPERVISOR en", page.url().replace(BASE, ""), "===\n");
const texto = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim()).catch(() => "(no leíble)");
console.log("LO QUE VE:", texto.slice(0, 260) || "(pantalla en blanco)");
console.log("\nERRORES DE PÁGINA:", errores.length);
for (const e of errores) {
  console.log("  ·", e.msg);
  const lineas = e.stack.split("\n").filter((l) => l.includes("_next") || l.includes("at ")).slice(0, 6);
  for (const l of lineas) console.log("      ", l.trim().slice(0, 150));
}
console.log("\nERRORES DE CONSOLA:", consola.length);
for (const c of consola.slice(0, 6)) console.log("  ·", c);

// ¿pasa lo mismo entrando directo a /admin/jornada (su pantalla)?
errores.length = 0; consola.length = 0;
await page.goto(`${BASE}/admin/jornada`, { waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(3500);
const t2 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim()).catch(() => "(no leíble)");
console.log("\n=== /admin/jornada (la pantalla propia del supervisor) ===");
console.log("terminó en:", page.url().replace(BASE, ""));
console.log("LO QUE VE:", t2.slice(0, 200) || "(vacía)");
console.log("errores:", errores.length ? errores[0].msg : "ninguno");
await b.close();
