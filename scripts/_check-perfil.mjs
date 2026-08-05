// Verifica en PRODUCCIÓN el perfil operativo del cobrador con sesión real de admin.
// Usa un cobrador CON actividad hoy (Edward Muñoz) para que el día tenga datos.
import { chromium } from "playwright-core";

const ID = process.argv[2] ?? "d7c5c4a9-d08e-4d62-839b-e8664c181759";
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

const r = await page.goto(`https://prestaya.uy/admin/cobrador/${ID}`, { waitUntil: "domcontentloaded" });
console.log("HTTP:", r?.status());
await page.waitForSelector("text=Cómo va el día", { timeout: 45000 }).catch(() => {});
const html = await page.content();
const chk = (etq, s) => console.log(`${etq}: ${html.includes(s) ? "✓" : "✗ FALTA"}`);
chk("bloque 'Cómo va el día'", "Cómo va el día");
chk("avance con meta", "de $");
chk("contador cobrados", "cobrados");
chk("tile 'Debería tener'", "Debería tener");
chk("estado de rendición", "rindió");
chk("recorrido de hoy", "Su recorrido de hoy");
chk("chip Cobrado en una parada", "Cobrado");
chk("chip Falta pasar", "Falta pasar");
chk("sus números / comisión", "Quincena · comisión");
chk("atajos", "Sus cobros");
chk("restablecer clave", "Restablecer contraseña");

// Texto legible del encabezado del día (para ver los números reales)
const t = (await page.textContent("body"))?.replace(/\s+/g, " ") ?? "";
const i = t.indexOf("Cómo va el día");
console.log("\n— lo que se ve —\n" + t.slice(i, i + 420));

// El modal del equipo tiene que ofrecer el perfil
await page.goto("https://prestaya.uy/admin/equipo", { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Vendedores", { timeout: 30000 }).catch(() => {});
const h2 = await page.content();
console.log(`\nequipo → link al perfil: ${h2.includes("/admin/cobrador/") || h2.includes("Ver perfil completo") ? "✓ (se arma al abrir la ficha)" : "· se arma en cliente"}`);
await browser.close();
