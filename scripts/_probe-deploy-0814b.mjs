// Sonda de deploy: ¿prod sirve hasta df4689e (Deshacer venta)?
// Marcadores ASCII (los acentos se escapan en el bundle y dan falso negativo),
// uno por commit relevante del tren:
//   59a6f6b → "/cobrador/informes"       (nav nueva + página Informes)
//   0dd15a8 → "avatar-marca"             (degradado de marca)
//   5645379 → "btn-primario"             (botón primario único)
//   df4689e → "deshacer la venta de"     (DeshacerVenta)
import { chromium } from "playwright-core";

const BASE = "https://prestaya.uy";
const EMAIL = process.env.SMOKE_EMAIL || "andres.duque@prestaya.uy";
const PASS = process.env.SMOKE_PASS || "PrestaYa2026!";

const MARCADORES = [
  { texto: "/cobrador/informes", de: "nav nueva + Informes (59a6f6b)" },
  { texto: "avatar-marca", de: "pasada estetica 1 (0dd15a8)" },
  { texto: "btn-primario", de: "pasada estetica 2 (5645379)" },
  { texto: "deshacer la venta de", de: "Deshacer venta (df4689e)" },
];
const hallados = new Set();
const chunksVistos = new Set();

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const page = await browser.newPage();
page.setDefaultTimeout(30000);
page.on("response", async (res) => {
  const url = res.url();
  if (!url.includes("/_next/static/") || chunksVistos.has(url)) return;
  chunksVistos.add(url);
  try {
    const cuerpo = await res.text();
    for (const m of MARCADORES) if (cuerpo.includes(m.texto)) hallados.add(m.de);
  } catch {}
});

try {
  await page.goto(`${BASE}/ingresar`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/cobrador/, { timeout: 45000 });
  console.log("login OK");

  // El HTML servido también cuenta (clases avatar-marca/btn-primario van inline).
  const revisarHtml = async () => {
    const html = await page.content();
    for (const m of MARCADORES) if (html.includes(m.texto)) hallados.add(m.de);
  };
  await page.waitForTimeout(1500);
  await revisarHtml();
  await page.goto(`${BASE}/cobrador/informes`, { waitUntil: "networkidle" });
  await revisarHtml();
  await page.goto(`${BASE}/cobrador/colocar?modo=venta`, { waitUntil: "networkidle" });
  await revisarHtml();
  await page.waitForTimeout(1500);
} catch (e) {
  console.log("EXCEPCION:", String(e.message).slice(0, 200));
} finally {
  await browser.close();
}

console.log(`recursos revisados: ${chunksVistos.size}`);
let falta = 0;
for (const m of MARCADORES) {
  const ok = hallados.has(m.de);
  if (!ok) falta++;
  console.log(`${ok ? "OK " : "FALTA"} ${m.de}`);
}
if (falta === 0) console.log("PROD SIRVE df4689e — el tren completo esta en la calle.");
else process.exit(1);
