// Capturas de la tienda pública en PROD (solo lectura, sin login).
import { chromium } from "playwright-core";

const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "https://prestaya.uy";
const OUT = process.argv[2] ?? ".";

const browser = await chromium.launch({ executablePath: CHROME });
try {
  for (const [nombre, vp] of [
    ["movil", { width: 390, height: 844 }],
    ["desktop", { width: 1366, height: 900 }],
  ]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/tienda`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000); // realtime/SW: networkidle no llega
    await page.screenshot({ path: `${OUT}/tienda-${nombre}-arriba.png` });
    // Scroll al catálogo para ver las tarjetas de producto.
    await page.evaluate(() => document.querySelector("#catalogo")?.scrollIntoView());
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/tienda-${nombre}-catalogo.png` });
    // Abrir el primer producto (detalle).
    const prod = page.locator("#catalogo ~ * button, [id='catalogo'] ~ * a").first();
    try {
      await page.mouse.click(vp.width / 2, vp.height / 2);
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${OUT}/tienda-${nombre}-detalle.png` });
    } catch {}
    await ctx.close();
  }
  console.log("capturas listas");
} finally {
  await browser.close();
}
