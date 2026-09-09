// SMOKE DEL PANEL: abre TODAS las pantallas con sesión real de ADMIN y de
// SUPERVISOR. Distingue tres cosas que se confunden fácil:
//   · REDIRIGE  → la pantalla es de otro rol y te manda a /admin (correcto)
//   · ERROR     → la pantalla es tuya y explotó
//   · VACÍA     → abre pero no muestra nada útil
// Mide dos veces: la 1ª paga el arranque en frío de la función, la 2ª es la real.
//   node scripts/_smoke-panel-0909.mjs
import { chromium } from "playwright-core";

const BASE = process.env.BASE || "https://prestaya.uy";
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const TODAS = [
  { rol: "ADMIN", email: "carlos@prestaya.uy", pass: "PrestaYa2026!" },
  { rol: "SUPERVISOR", email: process.env.SUP_EMAIL || "cesar.rendon@prestaya.uy", pass: "PrestaYa2026!" },
];
// SOLO=ADMIN o SOLO=SUPERVISOR para correr una sola cuenta.
const CUENTAS = process.env.SOLO ? TODAS.filter((c) => c.rol === process.env.SOLO) : TODAS;

// [ruta, quién debería poder entrar]
const RUTAS = [
  ["/admin", "admin"], ["/admin/jornada", "ambos"], ["/admin/movimientos", "ambos"],
  ["/admin/cierre", "admin"], ["/admin/cobranza", "ambos"], ["/admin/recaudos", "ambos"],
  ["/admin/caja", "ambos"], ["/admin/mora", "ambos"], ["/admin/operacion", "ambos"],
  ["/admin/campo", "ambos"], ["/admin/anulaciones", "ambos"], ["/admin/gastos", "ambos"],
  ["/admin/alertas", "ambos"], ["/admin/clientes", "ambos"], ["/admin/informe-cartera", "admin"],
  ["/admin/renovaciones", "ambos"], ["/admin/altas", "ambos"], ["/admin/scoring", "admin"],
  ["/admin/estadisticas", "admin"], ["/admin/valor", "admin"], ["/admin/comisiones", "ambos"],
  ["/admin/desempeno", "ambos"], ["/admin/capital", "admin"], ["/admin/reportes", "admin"],
  ["/admin/empalme", "admin"], ["/admin/para-clientes", "admin"], ["/admin/tienda", "admin"],
  ["/admin/anuncios", "ambos"], ["/admin/rifa", "admin"], ["/admin/promos", "admin"],
  ["/admin/estrellas", "admin"], ["/admin/juego", "admin"], ["/admin/banner-equipo", "ambos"],
  ["/admin/chat", "ambos"], ["/admin/notas", "ambos"], ["/admin/zonas", "admin"],
  ["/admin/equipo", "ambos"], ["/admin/recibos", "admin"], ["/admin/auditoria", "admin"],
  ["/admin/incidencias", "admin"], ["/admin/tutorial", "ambos"], ["/admin/seguridad", "ambos"],
  ["/admin/dev", "dev"], ["/admin/uso", "dev"], ["/admin/piloto", "dev"], ["/admin/en-vivo", "dev"],
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const out = {};

for (const cuenta of CUENTAS) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  let jsErr = [];
  page.on("pageerror", (e) => jsErr.push(String(e).slice(0, 110)));

  await page.goto(`${BASE}/ingresar`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"], input[name="email"]', cuenta.email);
  await page.fill('input[type="password"], input[name="password"]', cuenta.pass);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(admin|cobrador)/, { timeout: 90000 });
  console.log(`\n${"═".repeat(100)}\n  ${cuenta.rol} · ${cuenta.email}\n${"═".repeat(100)}`);
  console.log(`  ${"pantalla".padEnd(22)} ${"frío".padStart(7)} ${"2ª vez".padStart(7)}  resultado`);

  for (const [ruta, quien] of RUTAS) {
    const medir = async () => {
      jsErr = [];
      const t = Date.now();
      let resp = null;
      try {
        resp = await page.goto(`${BASE}${ruta}`, { waitUntil: "domcontentloaded" });
      } catch {
        /* un redirect en vuelo puede abortar la navegación: se resuelve mirando la URL */
      }
      // Un redirect en vuelo hace que page.content() explote ("the page is
      // navigating"): se espera a que la navegación se asiente y se reintenta.
      await page.waitForTimeout(350);
      let html = "";
      let texto = "";
      for (let i = 0; i < 3; i++) {
        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
          html = await page.content();
          texto = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
          break;
        } catch {
          await page.waitForTimeout(700);
        }
      }
      return { ms: Date.now() - t, url: page.url().replace(BASE, ""), code: resp?.status() ?? 0, html, texto };
    };
    const a = await medir();
    const b = await medir();
    const { url, code, html, texto } = b;

    const esperado = quien === "ambos" || quien === cuenta.rol.toLowerCase() ||
                     (quien === "dev" && cuenta.rol === "ADMIN" && cuenta.email.startsWith("carlos"));
    let estado;
    if (!url.startsWith(ruta)) {
      estado = url.includes("/ingresar") ? "🔴 lo echa al LOGIN" : `↪ redirige a ${url}`;
      if (!esperado) estado = `✅ ${estado.replace("↪ ", "")} (correcto: no es su pantalla)`;
      else estado = `🔴 lo saca de SU pantalla → ${url}`;
    } else if (html.includes("No pudimos cargar") || html.includes("Algo salió mal") || code >= 500) {
      estado = `🔴 EXPLOTÓ${code >= 500 ? ` (HTTP ${code})` : " (error.tsx)"}`;
    } else if (texto.length < 220) {
      estado = `🟡 abre vacía (${texto.length} caracteres)`;
    } else {
      estado = esperado ? "✅" : "🔴 ENTRA a una pantalla que NO es de su rol";
    }
    if (jsErr.length) estado += `  ⚠️ js:${jsErr[0].slice(0, 45)}`;
    (out[ruta] ??= {})[cuenta.rol] = { frio: a.ms, ms: b.ms, estado, esperado };
    console.log(`  ${ruta.replace("/admin", "/").padEnd(22)} ${String(a.ms).padStart(7)} ${String(b.ms).padStart(7)}  ${estado}`);
  }
  await ctx.close();
}

console.log(`\n${"═".repeat(100)}\n  PROBLEMAS\n${"═".repeat(100)}`);
let hay = false;
for (const [ruta, r] of Object.entries(out)) {
  for (const [rol, v] of Object.entries(r)) {
    if (v.estado.startsWith("🔴") || v.estado.startsWith("🟡")) {
      console.log(`  ${ruta.padEnd(26)} ${rol.padEnd(11)} ${v.estado}`);
      hay = true;
    }
  }
}
if (!hay) console.log("  ninguno");

console.log(`\n  LAS MÁS LENTAS (2ª carga, o sea con la función ya caliente)`);
Object.entries(out)
  .flatMap(([ruta, r]) => Object.entries(r).map(([rol, v]) => [ruta, rol, v.ms]))
  .filter(([, , ms]) => ms > 2500)
  .sort((a, b) => b[2] - a[2])
  .forEach(([ruta, rol, ms]) => console.log(`    ${ruta.padEnd(26)} ${rol.padEnd(11)} ${ms} ms`));
await browser.close();
