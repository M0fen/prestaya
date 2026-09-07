// Sonda de deploy (06-09): ¿prod sirve fdfefa7 (regla +20% sin tope + nombres)?
// "prod 200" NO prueba el deploy (Vercel estuvo 11 h sin publicar sin error
// visible): se entra con sesión real y se buscan marcadores ASCII de ESTE commit
// en el HTML servido y en los chunks. Sin acentos: el bundle los escapa.
//   fdfefa7 → "Entregale la plata"        (ColocarLista, ambar del +20%)
//   fdfefa7 → "le avisamos a tu supervisor" (ColocarLista / ficha)
//   fdfefa7 → "vos entregale la plata"    (pie de /cobrador/colocar)
//   fdfefa7 → "line-clamp-5"              (ListaRuta, nombres en Hoy)
import { chromium } from "playwright-core";

const BASE = "https://prestaya.uy";
const EMAIL = process.env.SMOKE_EMAIL || "andres.duque@prestaya.uy";
const PASS = process.env.SMOKE_PASS || "PrestaYa2026!";

const MARCADORES = [
  { texto: "Entregale la plata", de: "ambar del +20% en ColocarLista" },
  { texto: "le avisamos a tu supervisor", de: "texto de aviso (ColocarLista/ficha)" },
  { texto: "vos entregale la plata", de: "pie de /cobrador/colocar" },
  { texto: "line-clamp-5", de: "nombres a 5 lineas en Hoy (ListaRuta)" },
];
const VIEJOS = [
  { texto: "lo puede aprobar tu supervisor", de: "TEXTO VIEJO (no deberia estar)" },
  { texto: "la plata se entrega despu", de: "TEXTO VIEJO (no deberia estar)" },
  { texto: "Pedir ", de: "boton viejo 'Pedir ... a mi supervisor'" },
];
const hallados = new Set();
const viejosVistos = new Set();
const chunksVistos = new Set();

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const page = await browser.newPage();
page.setDefaultTimeout(30000);
const mirar = (cuerpo) => {
  for (const m of MARCADORES) if (cuerpo.includes(m.texto)) hallados.add(m.de);
  for (const v of VIEJOS) if (cuerpo.includes(v.texto)) viejosVistos.add(v.de);
};
page.on("response", async (res) => {
  const url = res.url();
  if (!url.includes("/_next/static/") || chunksVistos.has(url)) return;
  chunksVistos.add(url);
  try { mirar(await res.text()); } catch {}
});

try {
  await page.goto(`${BASE}/ingresar`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/cobrador/, { timeout: 45000 });
  console.log("login OK");
  await page.waitForTimeout(1500);
  mirar(await page.content());
  await page.goto(`${BASE}/cobrador/colocar?modo=venta`, { waitUntil: "networkidle" });
  mirar(await page.content());
  await page.goto(`${BASE}/cobrador/colocar?modo=renovar`, { waitUntil: "networkidle" });
  mirar(await page.content());
  await page.waitForTimeout(1500);
} catch (e) {
  console.log("EXCEPCION:", String(e.message).slice(0, 200));
} finally {
  await browser.close();
}

console.log(`chunks mirados: ${chunksVistos.size}`);
for (const m of MARCADORES) console.log(`${hallados.has(m.de) ? "OK " : "--- "} ${m.de}`);
for (const v of VIEJOS) if (viejosVistos.has(v.de)) console.log(`!!! ${v.de}`);
const ok = MARCADORES.every((m) => hallados.has(m.de)) && viejosVistos.size === 0;
console.log(ok ? "DEPLOY VERIFICADO: prod sirve fdfefa7" : "DEPLOY INCOMPLETO o viejo");
process.exit(ok ? 0 : 1);
