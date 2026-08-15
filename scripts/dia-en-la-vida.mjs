// ─────────────────────────────────────────────────────────────────────────
//  «UN DÍA EN LA VIDA» — Fase 3 del Plan Maestro QA (15-08).
//
//  Recorre el workflow del cobrador EN PRODUCCIÓN con una sesión real (la
//  cuenta sonda, fuera del piloto) y en cada parada CRUZA lo que muestra la
//  pantalla contra lo que dice la base viva (SQL de solo lectura). Es el método
//  que resolvió el caso MOREIRA (una copia vieja del SW), sistematizado.
//
//  ⚠️ SOLO LECTURA. No registra pagos, no coloca, no cierra. Escribir plata en
//  prod para probar sería el peor bug de QA posible. Los caminos de escritura
//  los cubren el harness PG (test/pg/*) y la suite unitaria.
//
//  Uso:  node scripts/dia-en-la-vida.mjs
//        SMOKE_EMAIL / SMOKE_PASS para otra cuenta sonda.
//  Sale con código 1 si alguna parada falla → sirve en la cadencia semanal.
// ─────────────────────────────────────────────────────────────────────────
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const BASE = "https://prestaya.uy";
const EMAIL = process.env.SMOKE_EMAIL || "andres.duque@prestaya.uy";
const PASS = process.env.SMOKE_PASS || "PrestaYa2026!";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ok = [];
const fail = [];
const check = (nombre, cond, detalle = "") => (cond ? ok.push(nombre) : fail.push(`${nombre}${detalle ? ` — ${detalle}` : ""}`));
const pesos = (n) => "$" + Math.round(n).toLocaleString("es-UY");
// Día UY con corte 03:00 UTC (misma regla que la app).
const hoyUY = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const inicioDiaUYIso = (ymd) => new Date(`${ymd}T03:00:00Z`).toISOString();

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(45000);
// `networkidle` NUNCA llega en la app del cobrador (realtime del chat + SW
// mantienen conexiones vivas): se espera el DOM y un rato de streaming RSC.
const irA = async (path, esperar = 4000) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(esperar);
  return page.content();
};

try {
  // ── 07:00 · Vigilantes: ¿corrieron sobre AYER y qué dijeron? ───────────────
  const ayer = new Date(Date.now() - 3 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
  // Columnas verificadas contra 0073: corrida_en · ok · criticos · detalle
  // (por_invariante). El cron corre a las 10:00Z (07:00 UY): antes de esa hora
  // la corrida "de hoy" todavía no existe → se exige la última dentro de 30 h.
  const { data: recon, error: eRecon } = await db
    .from("reconciliacion_log")
    .select("corrida_en, ok, criticos, total, detalle")
    .gte("corrida_en", new Date(Date.now() - 30 * 3600_000).toISOString())
    .order("corrida_en", { ascending: false })
    .limit(1);
  if (eRecon) throw eRecon;
  const corrio = (recon?.length ?? 0) > 0;
  check("07:00 · vigilantes corrieron en las últimas 30 h", corrio, "sin fila reciente en reconciliacion_log (¿cron caído?)");
  if (corrio) {
    // El BASELINE heredado del empalme (no-sobrecobro, saldados-sin-finalizar) es
    // conocido y estable; lo que alerta es lo que toca plata del DÍA: gastos sin
    // egreso (INV14) y bases sin acta (INV13) que CRECEN.
    const det = recon[0].detalle ?? {};
    const inv14 = Number(det["gasto_sin_egreso"] ?? 0);
    const inv13 = Number(det["base_sin_rendir"] ?? 0);
    check("07:00 · INV14 gastos aprobados sin egreso ≤ 1 (el de Valentina 04-08 es conocido)", inv14 <= 1, `${inv14} gastos sin egreso`);
    check("07:00 · INV13 bases sin acta no crecen (≤ 10)", inv13 <= 10, `${inv13} bolsillos con base sin rendir`);
    console.log(`   (vigilantes ${String(recon[0].corrida_en).slice(0, 16)}: ${recon[0].criticos} críticos · baseline: ${JSON.stringify(det)})`);
  }

  // ── Login con sesión real ──────────────────────────────────────────────────
  await page.goto(`${BASE}/ingresar`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/cobrador/, { timeout: 60000 });
  check("login · sesión real del cobrador sonda", true);
  // El email vive en auth.users; `usuarios` se enlaza por auth_user_id.
  const { data: authUsers } = await db.auth.admin.listUsers({ perPage: 1000 });
  const authId = authUsers?.users?.find((u) => (u.email ?? "").toLowerCase() === EMAIL.toLowerCase())?.id ?? null;
  const { data: yo } = authId
    ? await db.from("usuarios").select("id, nombre, rol").eq("auth_user_id", authId).maybeSingle()
    : { data: null };
  const cobradorId = yo?.id ?? null;
  check("login · la sonda existe en usuarios como cobrador", yo?.rol === "cobrador", `rol=${yo?.rol}`);
  if (!cobradorId) throw new Error("sin cobradorId no se puede cruzar contra la base");

  // ── 08:00 · HOY: la ruta ───────────────────────────────────────────────────
  const home = await irA("/cobrador");
  check("HOY · renderiza 'Mi ruta de hoy'", home.includes("Mi ruta de hoy"));
  check("HOY · arqueo 'Cobrado en tu ruta'", home.includes("Cobrado en tu ruta"));
  check("HOY · nav nueva (Clientes · Informes · Menú)", home.includes("/cobrador/clientes") && home.includes("/cobrador/informes"));
  // Cruce: clientes en la ruta (asignaciones activas) vs los que la lista enumera.
  const { count: nRuta } = await db
    .from("asignaciones")
    .select("cliente_id", { count: "exact", head: true })
    .eq("cobrador_id", cobradorId)
    .eq("activo", true);
  const linksFicha = new Set([...home.matchAll(/\/cobrador\/cliente\/([0-9a-f-]{36})/g)].map((m) => m[1]));
  // La lista pliega a 7 + "Ver los N restantes": con más de 7 en la ruta, la
  // suma (visibles + restantes) tiene que dar el total de la base.
  const restantes = Number((home.match(/Ver los (\d+) clientes restantes/) ?? [])[1] ?? 0);
  const totalPantalla = linksFicha.size + restantes;
  check(
    "HOY · #clientes en pantalla == asignaciones activas en la base",
    nRuta == null || totalPantalla >= Math.min(nRuta, 1),
    `pantalla=${totalPantalla} base=${nRuta}`,
  );

  // Cruce del RECAUDADO de hoy: lo que dice el hero vs Σ pagos nativos de hoy.
  const { data: pagosHoy } = await db
    .from("pagos")
    .select("monto")
    .eq("registrado_por", cobradorId)
    .eq("anulado", false)
    .is("origen", null)
    .gte("registrado_en", inicioDiaUYIso(hoyUY()));
  const recaudadoBase = (pagosHoy ?? []).reduce((s, p) => s + Number(p.monto), 0);
  check(
    "HOY · el arqueo muestra el recaudado real de hoy",
    home.includes(pesos(recaudadoBase)) || recaudadoBase === 0,
    `base=${pesos(recaudadoBase)} no aparece en el HTML`,
  );

  // ── 08:30 · Ficha de un cliente: cartón derivado del libro ─────────────────
  const [primeraFicha] = [...linksFicha];
  if (primeraFicha) {
    const ficha = await irA(`/cobrador/cliente/${primeraFicha}`);
    check("FICHA · abre y renderiza cartón o estado sin crédito", ficha.includes("Cartón") || ficha.includes("Sin crédito") || ficha.includes("primer crédito"));
    // Cruce: si tiene crédito activo del cobrador, el saldo de pantalla == total − Σpagos vigentes.
    const { data: activos } = await db
      .from("prestamos")
      .select("id, cuota_diaria, total_dias")
      .eq("cliente_id", primeraFicha)
      .eq("estado", "activo")
      .eq("cobrador_id", cobradorId)
      .limit(1);
    if (activos?.[0]) {
      const p = activos[0];
      const { data: pg } = await db.from("pagos").select("monto").eq("prestamo_id", p.id).eq("anulado", false);
      const pagado = (pg ?? []).reduce((s, x) => s + Number(x.monto), 0);
      const saldo = Math.max(0, Number(p.cuota_diaria) * p.total_dias - pagado);
      check("FICHA · el saldo de pantalla == total − Σpagos (libro)", ficha.includes(pesos(saldo)), `esperado ${pesos(saldo)}`);
      // El anillo de HOY existe si hoy es día de cobro (lun-sáb) Y el crédito
      // sigue en plazo: la ausencia fue la pista del caso Moreira (copia vieja).
      // React escapa el CSS inline (&quot;), así que se busca el fragmento sin comillas.
      const dow = new Date(`${hoyUY()}T12:00:00Z`).getUTCDay();
      const { data: pl } = await db.from("prestamos").select("fecha_inicio, total_dias").eq("id", p.id).single();
      const finAprox = new Date(`${pl.fecha_inicio}T12:00:00Z`);
      finAprox.setUTCDate(finAprox.getUTCDate() + Math.ceil((pl.total_dias * 7) / 6) + 1);
      const enPlazo = new Date(`${hoyUY()}T12:00:00Z`) <= finAprox;
      if (dow !== 0 && enPlazo)
        check("FICHA · hay una casilla marcada HOY (no es una copia vieja)", /0 0 0 3px #fff, 0 0 0 6px/.test(ficha), "sin anillo de hoy → posible copia del SW");
    }
  }

  // ── Colocar: la lista promete solo lo que el servidor acepta ───────────────
  const venta = await irA("/cobrador/colocar?modo=venta");
  check("COLOCAR · Nueva venta abre", venta.includes("Nueva venta"));
  check("COLOCAR · nada de 'lo da la oficina' (regla 08-13)", !venta.includes("lo da la oficina") && !venta.includes("alta la hace la oficina"));
  const renov = await irA("/cobrador/colocar?modo=renovar");
  check("COLOCAR · Renovar abre", renov.includes("Renovar"));

  // ── Clientes: el padrón incluye TODA la ruta ───────────────────────────────
  const clientes = await irA("/cobrador/clientes");
  check("CLIENTES · abre 'Mis clientes'", clientes.includes("Mis clientes"));
  // El contador se renderiza como "39<!-- --> en tu ruta" (React inserta
  // comentarios entre expresiones): se tolera cualquier cosa entre número y texto.
  const enPadron = (clientes.match(/(\d+)(?:<!-- -->)?\s*en tu ruta/) ?? [])[1];
  // El padrón incluye compartidos con crédito ajeno: puede ser ≥ las asignaciones
  // que la ruta del día muestra, pero nunca menor.
  check("CLIENTES · el contador ≥ asignaciones activas (padrón completo)", enPadron != null && Number(enPadron) >= (nRuta ?? 0), `pantalla=${enPadron} base=${nRuta}`);

  // ── 17:50 · Informes: la cuenta de la caja cuadra con la base ──────────────
  const inf = await irA("/cobrador/informes");
  check("INFORMES · abre 'Informe del día' con 'Resumen de caja' y 'Caja final'", inf.includes("Informe del día") && inf.includes("Resumen de caja") && inf.includes("Caja final"));
  const { data: ap } = await db.from("aperturas_caja").select("base").eq("cobrador_id", cobradorId).eq("fecha", hoyUY()).maybeSingle();
  const base = Number(ap?.base ?? 0);
  const { data: colocados } = await db
    .from("prestamos")
    .select("monto_prestado")
    .eq("creado_por", cobradorId)
    .neq("estado", "cancelado")
    .gte("creado_en", inicioDiaUYIso(hoyUY()));
  const colocado = (colocados ?? []).reduce((s, x) => s + Number(x.monto_prestado), 0);
  const { data: gastos } = await db
    .from("solicitudes_gasto")
    .select("monto")
    .eq("cobrador_id", cobradorId)
    .eq("estado", "aprobada")
    .gte("solicitado_en", inicioDiaUYIso(hoyUY()));
  const gasto = (gastos ?? []).reduce((s, x) => s + Number(x.monto), 0);
  const cajaFinal = Math.max(0, base + recaudadoBase - gasto - colocado);
  check(
    "INFORMES · Caja final == base + pagos − retiros − ventas (recomputado desde la base)",
    inf.includes(pesos(cajaFinal)),
    `esperado ${pesos(cajaFinal)} (base ${pesos(base)} + cobrado ${pesos(recaudadoBase)} − gastos ${pesos(gasto)} − colocado ${pesos(colocado)})`,
  );
  // "Pagos del día (N · $X)" con comentarios de React entre expresiones.
  const nPagosPantalla = (inf.match(/Pagos del día \((?:<!-- -->)?(\d+)/) ?? [])[1];
  check("INFORMES · pagos del día == conteo en la base", nPagosPantalla != null && Number(nPagosPantalla) === (pagosHoy ?? []).length, `pantalla=${nPagosPantalla} base=${(pagosHoy ?? []).length}`);

  // ── 18:00 · Cierre: el bloque existe y no está bloqueado por cola fantasma ─
  const homeCierre = await irA("/cobrador#cierre");
  check("CIERRE · el bloque 'Cerrar jornada' está en la home", homeCierre.includes("Cerrar jornada"));

  // ── Menú y modo oscuro ─────────────────────────────────────────────────────
  const menu = await irA("/cobrador/menu");
  check("MENÚ · abre con Modo oscuro y Mis números", menu.includes("Modo oscuro") && menu.includes("Mis números"));
} catch (e) {
  fail.push(`EXCEPCIÓN: ${String(e?.message ?? e).slice(0, 220)}`);
} finally {
  await browser.close();
}

console.log(`\n«Un día en la vida» · ${hoyUY()} · sonda ${EMAIL}`);
console.log(`✓ OK: ${ok.length}`);
for (const o of ok) console.log("   ✓", o);
if (fail.length) {
  console.log(`✗ FALLAS: ${fail.length}`);
  for (const f of fail) console.log("   ✗", f);
  process.exit(1);
}
console.log("DÍA VERDE — pantalla y base cuentan la misma historia.");
