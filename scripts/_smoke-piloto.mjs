// Smoke test de SOLO LECTURA en producción (prestaya.uy) con sesión real de
// cobradora. Verifica los marcadores FUNCIONALES del código nuevo — nunca un
// 200 pelado. NO registra pagos ni toca datos.
import { chromium } from "playwright-core";

const BASE = "https://prestaya.uy";
// ⚠️ Un cobrador del PILOTO no sirve de sonda: cuando pone su propia contraseña
// —que es exactamente lo que queremos— el smoke empieza a dar "credenciales
// incorrectas" y parece que se cayó producción. Pasó el 06-08 con Yuli Toro.
// Se usa un cobrador con cartera activa que NO está en el piloto y conserva la
// clave de arranque. Si un día también la cambia, el smoke lo dice explícito.
const EMAIL = process.env.SMOKE_EMAIL || "andres.duque@prestaya.uy";
const PASS = process.env.SMOKE_PASS || "PrestaYa2026!";

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
  // Antes de esperar la navegación: si la sonda cambió su clave, decirlo con todas
  // las letras. Sin esto el smoke moría por timeout y parecía producción caída.
  await page
    .waitForSelector("text=/Correo o contraseña incorrectos/i", { timeout: 6000 })
    .then(() => {
      throw new Error(
        `El usuario del smoke (${EMAIL}) ya no entra con la clave de arranque — cambió la suya. ` +
          `Producción puede estar perfecta. Elegí otro cobrador o pasá SMOKE_EMAIL/SMOKE_PASS.`,
      );
    })
    .catch((e) => {
      if (String(e.message).startsWith("El usuario del smoke")) throw e; // es el nuestro
    });
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

  // 4) Ficha de un cliente: historial nuevo + registro. Se prueban hasta 4
  //    clientes (el primero puede ser "Sin crédito": hay 108 en la zona).
  await page.waitForSelector('a[href*="/cobrador/cliente/"]', { timeout: 30000 });
  const hrefs = await page
    .locator('a[href*="/cobrador/cliente/"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute("href")).filter(Boolean).slice(0, 4));
  let fichaOk = false;
  let histOk = false;
  let cartonOk = false;
  for (const href of hrefs) {
    await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Cuota diaria", { timeout: 30000 }).catch(() => {});
    const ficha = await page.content();
    const conCredito =
      ficha.includes("Registrar pago") || ficha.includes("Crédito saldado") || ficha.includes("adelantar próxima");
    if (!conCredito) continue;
    fichaOk = true;
    histOk = ficha.includes("Historial de pagos");
    cartonOk = ficha.includes("Cuota diaria") || ficha.includes("Saldo");
    break;
  }
  check("ficha: botón de cobro presente (cliente con crédito)", fichaOk);
  check("ficha: '📜 Historial de pagos' (nuevo)", histOk);
  check("ficha: cartón renderizado", cartonOk);

  // 5) Mis números: quincena + apodo (nuevos)
  await page.goto(`${BASE}/cobrador/mis-numeros`, { waitUntil: "domcontentloaded" });
  const mn = await page.content();
  check("mis-números: 'Comisión de esta quincena' (nuevo)", mn.includes("quincena"));
  check("mis-números: 'Tu sobrenombre' (nuevo)", mn.includes("sobrenombre"));
  // "Cobrado por vos" es la CUSTODIA (lo que registró él); la comisión se calcula
  // aparte, sobre su ruta (06-08). Antes acá decía "Recaudado", que mezclaba las
  // dos cosas y era justo la confusión que le costaba la comisión al cobrador.
  check(
    "mis-números: custodia separada de comisión",
    mn.includes("Cobrado por vos") || mn.includes("cobrados en tu ruta"),
  );
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
