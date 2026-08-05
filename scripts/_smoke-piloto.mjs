// Smoke test de SOLO LECTURA en producción (prestaya.uy) con sesión real de
// cobradora. Verifica los marcadores FUNCIONALES del código nuevo — nunca un
// 200 pelado. NO registra pagos ni toca datos.
import { chromium } from "playwright-core";

const BASE = "https://prestaya.uy";
const EMAIL = "yuli.toro@prestaya.uy";
const PASS = "PrestaYa2026!";

const ok = [];
const fail = [];
const check = (nombre, cond) => (cond ? ok.push(nombre) : fail.push(nombre));

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const page = await browser.newPage();
page.setDefaultTimeout(30000);

try {
  // 1) Login en el dominio nuevo
  await page.goto(`${BASE}/ingresar`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/cobrador/, { timeout: 45000 });
  check("login en prestaya.uy → /cobrador", true);

  // 2) Home: ESPERAR el render real (streaming/skeleton) antes de leer
  await page.waitForSelector("text=Mi ruta de hoy", { timeout: 45000 }).catch(() => {});
  const home = await page.content();
  check("card 'Tu caja de hoy' (nueva)", home.includes("Tu caja de hoy"));
  check("'Cobrado en tu ruta' (arqueo)", home.includes("Cobrado en tu ruta"));
  check("'Mi ruta de hoy'", home.includes("Mi ruta de hoy"));
  check("menú '+ Agregar' (colocar)", home.includes("Agregar") || home.includes("Renovar"));

  // 3) Lista: Mi orden + Ordenar (nuevos)
  check("chip '📌 Mi orden' (nuevo)", home.includes("Mi orden"));
  check("botón '✏️ Ordenar' (nuevo)", home.includes("Ordenar"));

  // 4) Ficha de un cliente: historial nuevo + registro
  await page.waitForSelector('a[href*="/cobrador/cliente/"]', { timeout: 30000 });
  const linkCliente = await page.locator('a[href*="/cobrador/cliente/"]').first();
  await linkCliente.click();
  await page.waitForURL(/\/cobrador\/cliente\//);
  await page.waitForSelector("text=Historial de pagos", { timeout: 45000 }).catch(() => {});
  await page.waitForSelector("text=Registrar pago", { timeout: 30000 }).catch(() => {});
  const ficha = await page.content();
  check("ficha: botón de cobro presente", ficha.includes("Registrar pago") || ficha.includes("Crédito saldado"));
  check("ficha: '📜 Historial de pagos' (nuevo)", ficha.includes("Historial de pagos"));
  check("ficha: cartón renderizado", ficha.includes("Cuota diaria") || ficha.includes("Saldo"));

  // 5) Mis números: quincena + apodo (nuevos)
  await page.goto(`${BASE}/cobrador/mis-numeros`, { waitUntil: "domcontentloaded" });
  const mn = await page.content();
  check("mis-números: 'Comisión de esta quincena' (nuevo)", mn.includes("quincena"));
  check("mis-números: 'Tu sobrenombre' (nuevo)", mn.includes("sobrenombre"));
  check("mis-números: 'Comisiones cobradas' o sección lista", mn.includes("Comisiones cobradas") || mn.includes("Recaudado"));
} catch (e) {
  fail.push(`EXCEPCIÓN: ${e.message?.slice(0, 200)}`);
} finally {
  await browser.close();
}

console.log("✓ OK:", ok.length);
for (const o of ok) console.log("   ✓", o);
if (fail.length) {
  console.log("✗ FALLAS:", fail.length);
  for (const f of fail) console.log("   ✗", f);
  process.exit(1);
}
console.log("SMOKE VERDE — producción sirve el workflow nuevo con sesión real.");
