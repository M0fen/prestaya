// Verifica en PRODUCCIÓN la auditoría nueva con sesión real de admin.
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const page = await browser.newPage();
page.setDefaultTimeout(30000);
await page.goto("https://prestaya.uy/ingresar", { waitUntil: "domcontentloaded" });

// 1) "¿Olvidaste tu contraseña?" → al expandir tiene que aparecer el WhatsApp de soporte.
await page.click("text=¿Olvidaste tu contraseña?").catch(() => console.log("trigger olvido: ✗ NO ESTÁ"));
await page.waitForSelector("text=Escribir por WhatsApp", { timeout: 8000 }).catch(() => {});
const wa = await page.$('a[href*="wa.me/573122143556"]');
console.log(`WhatsApp de soporte (+57 312 214 3556): ${wa ? "✓ botón activo" : "✗ NO APARECE"}`);

await page.fill('input[type="email"]', "carlos@prestaya.uy");
await page.fill('input[type="password"]', "PrestaYa2026!");
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin/, { timeout: 45000 });
await page.goto("https://prestaya.uy/admin/auditoria", { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Cobros de hoy", { timeout: 45000 }).catch(() => {});
const html = await page.content();
const chk = (etq, s) => console.log(`${etq}: ${html.includes(s) ? "✓" : "✗ FALTA"}`);
chk("resumen 'Cobros de hoy'", "Cobros de hoy");
chk("tile 'Esperan aval'", "Esperan aval");
chk("filtros de período", ">7 días<");
chk("filtro por tipo", "Cajas y gastos");
chk("timeline con cobros", "cobró a");
chk("agrupado por día", "Hoy · ");
// Filtro "30 días" para ver historia + gestión
await page.goto("https://prestaya.uy/admin/auditoria?rango=30d&tipo=gestion", { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Cobros de hoy", { timeout: 30000 }).catch(() => {});
const h2 = await page.content();
console.log(`filtro gestión 30d: ${h2.includes("Cambió su contraseña") || h2.includes("Sin movimientos") ? "✓ responde" : "✗"}`);
await browser.close();
