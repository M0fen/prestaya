// Verifica en PRODUCCIÓN que la tarjeta de ARRANQUE DÍA 1 aparece con sesión real.
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const page = await browser.newPage();
page.setDefaultTimeout(30000);
await page.goto("https://prestaya.uy/ingresar", { waitUntil: "domcontentloaded" });
await page.fill('input[type="email"]', "yuli.toro@prestaya.uy");
await page.fill('input[type="password"]', "PrestaYa2026!");
await page.click('button[type="submit"]');
await page.waitForURL(/\/cobrador/, { timeout: 45000 });
await page.waitForSelector("text=Antes de arrancar", { timeout: 45000 }).catch(() => {});
const html = await page.content();
console.log("tarjeta 'Antes de arrancar — 2 pasos':", html.includes("Antes de arrancar") ? "✓ VISIBLE" : "✗ NO APARECE");
console.log("paso 1 (contraseña propia):", html.includes("contraseña propia") ? "✓" : "✗");
console.log("paso 2 (Agregá la app):", html.includes("Agregá la app") ? "✓" : "✗");
await browser.close();
