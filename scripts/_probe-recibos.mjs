// ¿La pantalla de Recibos aparenta funcionar aunque su tabla no exista?
// (0046 crea `recibos`, pero la tabla NO está en la base: getRecibos degrada a []
//  y la pantalla abre igual, con su formulario, como si emitir fuera a andar.)
import { chromium } from "playwright-core";

const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const b = await chromium.launch({ executablePath: CHROME, headless: true });
const p = await b.newPage();
p.setDefaultTimeout(60000);
const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));

await p.goto("https://prestaya.uy/ingresar", { waitUntil: "domcontentloaded" });
await p.fill('input[type="email"]', "carlos@prestaya.uy");
await p.fill('input[type="password"]', "PrestaYa2026!");
await p.click('button[type="submit"]');
await p.waitForURL(/\/admin/, { timeout: 60000 });

await p.goto("https://prestaya.uy/admin/recibos", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
const html = await p.content();
console.log("abre sin caer al error.tsx :", !html.includes("No pudimos cargar"));
console.log("muestra el título 'Recibos' :", html.includes("Recibos"));
console.log("ofrece emitir uno           :", /emitir|concepto|monto/i.test(html));
console.log("avisa que no está disponible:", /no disponible|falta la migraci|no se pudo/i.test(html));
console.log("botón de emitir presente    :", !!(await p.$('button:has-text("Emitir"), button[type="submit"]')));
console.log("errores de consola          :", errs.length ? errs.slice(0, 2) : "ninguno");
await b.close();
