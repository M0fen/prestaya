// ¿Se siente rápida la app? Mide en PRODUCCIÓN, con sesión real, las pantallas
// que el cobrador y el supervisor abren todo el día. Sin simulaciones: se navega
// y se cronometra lo que tarda en aparecer contenido de verdad.
//   node scripts/_probe-velocidad-0908.mjs
//   node scripts/_probe-velocidad-0908.mjs --lento   (CPU 4x y red 4G floja: el teléfono real)
import { chromium } from "playwright-core";

const BASE = process.env.BASE || "https://prestaya.uy";
const LENTO = process.argv.includes("--lento");
const COB = { email: process.env.SMOKE_EMAIL || "andres.duque@prestaya.uy", pass: process.env.SMOKE_PASS || "PrestaYa2026!" };
const DEV = { email: "carlos@prestaya.uy", pass: "PrestaYa2026!" };

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});

async function sesion(cred, movil) {
  const ctx = await browser.newContext(
    movil
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" }
      : {},
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  if (LENTO) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false, latency: 150, downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (1 * 1024 * 1024) / 8,
    });
  }
  await page.goto(`${BASE}/ingresar`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"], input[name="email"]', cred.email);
  await page.fill('input[type="password"], input[name="password"]', cred.pass);
  const t = Date.now();
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(cobrador|admin)/, { timeout: 90000 });
  return { page, ctx, login: Date.now() - t };
}

/** Navega y espera a que aparezca contenido REAL (no el esqueleto). */
async function medir(page, ruta, esperar) {
  const t = Date.now();
  await page.goto(`${BASE}${ruta}`, { waitUntil: "commit" });
  let ok = true;
  try {
    await page.waitForSelector(esperar, { timeout: 90000 });
  } catch {
    ok = false;
  }
  return { ms: Date.now() - t, ok };
}

const fmt = (n) => `${String(n).padStart(6)} ms`;
console.log(`Midiendo ${BASE}${LENTO ? "  [teléfono flojo: CPU 4x lenta, 4G con 150 ms de latencia]" : "  [laptop, red buena]"}\n`);

try {
  // ── COBRADOR: lo que pasa en la calle ──────────────────────────────────
  const c = await sesion(COB, true);
  console.log(`COBRADOR (${COB.email}, vista de teléfono)`);
  console.log(`  login … ${fmt(c.login)}`);
  const rutas = [
    ["/cobrador", "text=/Hoy|Mi ruta|cobrar/i", "Hoy (su ruta del día)"],
    ["/cobrador/clientes", "text=/Clientes|Buscar/i", "Clientes"],
    ["/cobrador/informes", "text=/Informe|Recaudo|Mis números/i", "Informes"],
    ["/cobrador/menu", "text=/Men|Cerrar|Salir/i", "Menú"],
  ];
  for (const [r, sel, etq] of rutas) {
    const m = await medir(c.page, r, sel);
    console.log(`  ${etq.padEnd(24)} ${fmt(m.ms)} ${m.ok ? "" : "  ← NO apareció el contenido"}`);
  }
  // La ficha del primer cliente de la ruta: el clic más repetido del día.
  await c.page.goto(`${BASE}/cobrador`, { waitUntil: "domcontentloaded" });
  const link = await c.page.$('a[href^="/cobrador/cliente/"]');
  if (link) {
    const href = await link.getAttribute("href");
    const m = await medir(c.page, href, "text=/Cobrar|Registrar|cuota/i");
    console.log(`  ${"Ficha de un cliente".padEnd(24)} ${fmt(m.ms)} ${m.ok ? "" : "  ← NO apareció"}`);
  } else {
    console.log("  Ficha de un cliente        (sin clientes en la ruta de este cobrador)");
  }
  await c.ctx.close();

  // ── ADMIN/DEV: el panel ────────────────────────────────────────────────
  const d = await sesion(DEV, false);
  console.log(`\nADMIN (${DEV.email})`);
  console.log(`  login … ${fmt(d.login)}`);
  for (const [r, sel, etq] of [
    ["/admin", "text=/Resumen|Recaudo|Cartera/i", "Resumen del negocio"],
    ["/admin/clientes", "text=/Clientes|Buscar/i", "Clientes"],
    ["/admin/cobranza", "text=/Cobranza|ruta|zona/i", "Cobranza"],
    ["/admin/recaudos", "text=/Recaudo/i", "Recaudos"],
    ["/admin/mora", "text=/Mora|atras/i", "Mora"],
    ["/admin/jornada", "text=/jornada|Apertura|En vivo/i", "Mi jornada"],
    ["/admin/piloto", "text=/Está sano|Panel del piloto/i", "Panel del piloto (dev)"],
    ["/admin/en-vivo", "text=/En la app ahora/i", "En vivo (dev)"],
  ]) {
    const m = await medir(d.page, r, sel);
    console.log(`  ${etq.padEnd(24)} ${fmt(m.ms)} ${m.ok ? "" : "  ← NO apareció el contenido"}`);
  }
  await d.ctx.close();
} finally {
  await browser.close();
}
