// Sonda: ¿qué renderiza /admin/auditoria?rango=30d&tipo=gestion en producción?
import { chromium } from "playwright-core";
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const page = await browser.newPage();
page.setDefaultTimeout(30000);
await page.goto("https://prestaya.uy/ingresar", { waitUntil: "domcontentloaded" });
await page.fill('input[type="email"]', "carlos@prestaya.uy");
await page.fill('input[type="password"]', "PrestaYa2026!");
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin/, { timeout: 45000 });
const r = await page.goto("https://prestaya.uy/admin/auditoria?rango=30d&tipo=gestion", { waitUntil: "networkidle" });
console.log("HTTP:", r?.status());
const txt = (await page.textContent("body"))?.replace(/\s+/g, " ").slice(0, 900);
console.log(txt);
await browser.close();
