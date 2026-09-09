// Sonda REAL de las dos pantallas dev nuevas (08-09), con sesión de Carlos.
// "prod 200" no prueba nada: acá se entra de verdad, se espera el render del
// servidor y se busca contenido que SOLO existe si la página se armó entera
// (si una consulta explota, Next pinta el error.tsx del segmento y no aparece).
// Mide además cuánto tarda cada una: el panel del piloto hace ~17 consultas.
//   node scripts/_probe-paneles-dev-0908.mjs
import { chromium } from "playwright-core";

const BASE = process.env.BASE || "https://prestaya.uy";
const EMAIL = process.env.DEV_EMAIL || "carlos@prestaya.uy";
const PASS = process.env.DEV_PASS || "PrestaYa2026!";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const page = await browser.newPage();
page.setDefaultTimeout(60000);

const errores = [];
page.on("console", (m) => {
  if (m.type() === "error") errores.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => errores.push("pageerror: " + String(e).slice(0, 200)));

let fallos = 0;
const chk = (etq, ok, extra = "") => {
  if (!ok) fallos++;
  console.log(`${ok ? "OK " : "MAL"} ${etq}${extra ? "  " + extra : ""}`);
};

try {
  await page.goto(`${BASE}/ingresar`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin/, { timeout: 60000 });
  console.log("login OK (dev)");

  // ── 1) EN VIVO ────────────────────────────────────────────────────────
  let t0 = Date.now();
  await page.goto(`${BASE}/admin/en-vivo`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("h1", { timeout: 60000 });
  const msEnVivo = Date.now() - t0;
  const h1 = (await page.textContent("h1")) ?? "";
  const enVivo = await page.content();
  chk("/admin/en-vivo rinde (no cayó al error.tsx)", !enVivo.includes("No pudimos cargar") && h1.includes("En vivo"), `${msEnVivo} ms · h1="${h1.trim()}"`);
  chk("grupo 'En la app ahora'", enVivo.includes("En la app ahora"));
  chk("columna 'Qué están haciendo'", enVivo.includes("Qué están haciendo"));
  chk("reloj de actualización", /actualizad[oa]|pausado|sin respuesta/.test(enVivo));
  chk("filtros del feed (Hechos/Navegación)", enVivo.includes("Hechos (") && enVivo.includes("Navegación ("));
  chk("nav con el grupo Desarrollo", enVivo.includes("Desarrollo"));

  // El endpoint que consume el poll, con la MISMA sesión.
  const api = await page.evaluate(async () => {
    const t = performance.now();
    const r = await fetch("/api/dev/en-vivo", { cache: "no-store" });
    const ms = Math.round(performance.now() - t);
    if (!r.ok) return { status: r.status, ms };
    const j = await r.json();
    return {
      status: r.status,
      ms,
      personas: Array.isArray(j.personas) ? j.personas.length : -1,
      feed: Array.isArray(j.feed) ? j.feed.length : -1,
      resumen: j.resumen ?? null,
    };
  });
  chk("GET /api/dev/en-vivo con sesión dev", api.status === 200 && api.personas > 0, JSON.stringify(api));

  // ── 2) PANEL DEL PILOTO ───────────────────────────────────────────────
  t0 = Date.now();
  await page.goto(`${BASE}/admin/piloto`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("h1", { timeout: 90000 });
  const msPiloto = Date.now() - t0;
  const piloto = await page.content();
  const h1p = (await page.textContent("h1")) ?? "";
  chk("/admin/piloto rinde (no cayó al error.tsx)", !piloto.includes("No pudimos cargar") && h1p.includes("Panel del piloto"), `${msPiloto} ms`);
  for (const [etq, txt] of [
    ["semáforo '¿Está sano?'", "¿Está sano?"],
    ["build en prod", "Build en prod"],
    ["adopción 14 días", "¿Lo usan?"],
    ["barras de recaudo nativo", "Recaudo nativo por día"],
    ["tabla del equipo", "Cobrador · última semana"],
    ["plata cuidada", "¿La plata está cuidada?"],
    ["espejo con Disapp", "Espejo con Disapp"],
    ["pendientes editables", "Pendientes y decisiones"],
    ["bitácora de hitos", "Bitácora del piloto"],
  ]) chk(etq, piloto.includes(txt));
  const caidas = piloto.includes("Fuentes que no respondieron");
  console.log(`${caidas ? "⚠  " : "OK "} fuentes lentas: ${caidas ? "HAY (el panel lo dice)" : "ninguna"}`);
  const shaEnPantalla = (piloto.match(/>([0-9a-f]{7})</g) || []).map((s) => s.slice(1, 8));
  console.log(`    commit que dice servir: ${shaEnPantalla[0] ?? "?"}`);

  // ── 3) La pantalla vieja sigue viva ───────────────────────────────────
  await page.goto(`${BASE}/admin/uso`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("h1", { timeout: 60000 });
  chk("/admin/uso (adopción) sigue funcionando", (await page.content()).includes("Auditoría de uso del personal"));

  console.log(errores.length ? `⚠  errores de consola: ${errores.slice(0, 5).join(" | ")}` : "OK  sin errores de consola");
  console.log(fallos === 0 ? "PANELES DEV VERIFICADOS EN PROD" : `FALLARON ${fallos} chequeos`);
  process.exitCode = fallos === 0 ? 0 : 1;
} catch (e) {
  console.log("EXPLOTÓ la sonda:", String(e).slice(0, 400));
  process.exitCode = 1;
} finally {
  await browser.close();
}
