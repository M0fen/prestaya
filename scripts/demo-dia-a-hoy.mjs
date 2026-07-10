// ─────────────────────────────────────────────────────────────────────────
//  DEMO · Re-datar el último día operativo a HOY (solo base de PRUEBA).
//
//  Problema que resuelve: la data se carga de noche con los cobros de AYER,
//  así que durante la demo "Recaudado hoy" / "En vivo por cobrador" salen en
//  $0. Este script corre el último día con pagos hacia el día de hoy (UY),
//  manteniendo TODO idéntico (mismo id, mismo disapp_pago_id, mismo monto,
//  mismo dia_credito → el cartón NO cambia; solo cambia registrado_en).
//
//  Cómo lo hace: el trigger de inmutabilidad bloquea UPDATE de registrado_en,
//  así que se hace DELETE + INSERT de la MISMA fila (id incluido) con la fecha
//  corrida. Antes de tocar nada escribe un backup JSON. Deja marca reversible
//  en `origen` ("…|redatado_de:<ISO original>") para poder volver atrás.
//
//  Hora: el export de Disapp no trae hora (el empalme estampa 12:00), pero las
//  vistas de "hoy" cortan en AHORA → a las 9 AM un pago de las 12:00 aún "no
//  existe". Por eso acá cada pago se estampa entre las 06:00 y 10:00 UY
//  (determinístico por id): a cualquier hora de demo el día ya está poblado y
//  la serie "por hora" parece una mañana real de cobro.
//
//  Uso:
//    node --env-file=.env.local scripts/demo-dia-a-hoy.mjs           # a hoy
//    node --env-file=.env.local scripts/demo-dia-a-hoy.mjs --volver  # deshace
//
//  ⚠️ ANTES de cargar un export nuevo de Disapp con el día real, correr
//  --volver: si no, los cobros re-datados y los reales del día se SUMAN.
//  Guard duro: solo corre contra la base de PRUEBA.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const REF_PRUEBA = "kvmqlkqfgjimfpzlwsdt";
if (!URL_.includes(REF_PRUEBA)) {
  console.error(`ABORTADO: este script SOLO corre contra la base de PRUEBA (${REF_PRUEBA}). URL actual: ${URL_ || "(vacía)"}`);
  process.exit(1);
}
const db = createClient(URL_, SR, { auth: { persistSession: false } });
const VOLVER = process.argv.includes("--volver");
const MARCA = "|redatado_de:";
const DIA_MS = 86_400_000;

/** Día calendario de Uruguay (UTC−3, sin DST) de un instante. */
const diaUY = (d) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
/** Medianoche UY de un día "YYYY-MM-DD" en ISO UTC. */
const inicioUY = (dia) => `${dia}T03:00:00.000Z`;
const hoy = diaUY(new Date());

/** Trae todas las filas de un filtro, paginando (PostgREST corta en 1000). */
async function traerTodo(arma) {
  const filas = [];
  for (let d = 0; ; d += 1000) {
    const { data, error } = await arma().range(d, d + 999);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if (!data || data.length < 1000) return filas;
  }
}

/** DELETE + INSERT de las mismas filas con registrado_en/origen nuevos, en lotes chicos.
 *  Si un insert falla, reinserta las originales del lote y aborta. */
async function reinsertar(filas, transformar) {
  let movidas = 0;
  for (let i = 0; i < filas.length; i += 200) {
    const lote = filas.slice(i, i + 200);
    const ids = lote.map((f) => f.id);
    const { error: eDel } = await db.from("pagos").delete().in("id", ids);
    if (eDel) throw new Error(`DELETE falló (nada más se tocó): ${eDel.message}`);
    const nuevas = lote.map(transformar);
    const { error: eIns } = await db.from("pagos").insert(nuevas);
    if (eIns) {
      // Restaurar el lote original para no perder pagos.
      const { error: eRest } = await db.from("pagos").insert(lote);
      throw new Error(`INSERT falló: ${eIns.message}. Restauración del lote: ${eRest ? "FALLÓ — usar el backup JSON" : "OK"}`);
    }
    movidas += lote.length;
  }
  return movidas;
}

function backup(nombre, filas) {
  const dir = "backups-demo";
  mkdirSync(dir, { recursive: true });
  const ruta = `${dir}/${nombre}-${Date.now()}.json`;
  writeFileSync(ruta, JSON.stringify(filas));
  console.log(`   backup → ${ruta} (${filas.length} filas)`);
  return ruta;
}

const suma = (filas) => filas.reduce((s, f) => s + Number(f.monto), 0);

if (!VOLVER) {
  // ── IR: último día con pagos → HOY ────────────────────────────────────────
  const { data: ult, error: eUlt } = await db.from("pagos").select("registrado_en")
    .eq("anulado", false).order("registrado_en", { ascending: false }).limit(1);
  if (eUlt) throw new Error(eUlt.message);
  if (!ult?.length) { console.log("No hay pagos en la base. Nada que hacer."); process.exit(0); }
  const diaSrc = diaUY(new Date(ult[0].registrado_en));
  if (diaSrc === hoy) { console.log(`El último día con pagos YA es hoy (${hoy}). Nada que hacer.`); process.exit(0); }

  const deltaDias = Math.round((Date.parse(inicioUY(hoy)) - Date.parse(inicioUY(diaSrc))) / DIA_MS);
  console.log(`Re-datando ${diaSrc} → ${hoy} (+${deltaDias} día/s) en PRUEBA…`);

  const pagos = await traerTodo(() => db.from("pagos").select("*")
    .gte("registrado_en", inicioUY(diaSrc)).lt("registrado_en", new Date(Date.parse(inicioUY(diaSrc)) + DIA_MS).toISOString()));
  console.log(`   pagos de ${diaSrc}: ${pagos.length} · $${suma(pagos).toLocaleString("es-UY")}`);
  if (!pagos.length) process.exit(0);
  backup(`pagos-${diaSrc}`, pagos);

  // Minuto 0–239 determinístico por id (uuid hex) → 06:00 + eso = 06:00–10:00 UY.
  const minutoDe = (id) => parseInt(String(id).replace(/-/g, "").slice(0, 8), 16) % 240;
  const movidas = await reinsertar(pagos, (f) => ({
    ...f,
    registrado_en: new Date(Date.parse(inicioUY(hoy)) + (6 * 60 + minutoDe(f.id)) * 60_000).toISOString(),
    // Marca reversible; si ya venía re-datado, conserva el origen REAL primero.
    origen: (f.origen ?? "").includes(MARCA) ? f.origen : `${f.origen ?? ""}${MARCA}${f.registrado_en}`,
  }));

  // Rendiciones y cierres de zona del día origen acompañan (UPDATE simple, sin trigger).
  const { data: rend } = await db.from("rendiciones").select("id, cobrador_id").eq("fecha", diaSrc);
  let rendMovidas = 0;
  for (const r of rend ?? []) {
    const { error } = await db.from("rendiciones").update({ fecha: hoy }).eq("id", r.id);
    if (error) console.log(`   rendición ${r.id} NO movida (${error.message})`); else rendMovidas++;
  }
  const { data: cz } = await db.from("cierres_zona").select("id").eq("fecha", diaSrc);
  let czMovidos = 0;
  for (const c of cz ?? []) {
    const { error } = await db.from("cierres_zona").update({ fecha: hoy }).eq("id", c.id);
    if (error) console.log(`   cierre de zona ${c.id} NO movido (${error.message})`); else czMovidos++;
  }

  // Verificación: lo que quedó HOY debe igualar lo que había en el día origen.
  const hoyRows = await traerTodo(() => db.from("pagos").select("id, monto")
    .gte("registrado_en", inicioUY(hoy)).lt("registrado_en", new Date(Date.parse(inicioUY(hoy)) + DIA_MS).toISOString()));
  console.log(`✔ ${movidas} pagos movidos · HOY tiene ${hoyRows.length} pagos / $${suma(hoyRows).toLocaleString("es-UY")}`);
  console.log(`✔ rendiciones movidas: ${rendMovidas} · cierres de zona movidos: ${czMovidos}`);
  console.log(`Para deshacer (antes del próximo empalme): node --env-file=.env.local scripts/demo-dia-a-hoy.mjs --volver`);
} else {
  // ── VOLVER: restaura registrado_en original de las filas marcadas ─────────
  const marcadas = await traerTodo(() => db.from("pagos").select("*").like("origen", `%${MARCA}%`));
  if (!marcadas.length) { console.log("No hay pagos re-datados. Nada que deshacer."); process.exit(0); }
  console.log(`Restaurando ${marcadas.length} pagos re-datados…`);
  backup("pagos-redatados", marcadas);

  // Día actual y día original (para mover también rendiciones/cierres de vuelta).
  const diaActual = diaUY(new Date(marcadas[0].registrado_en));
  const origIso = marcadas[0].origen.split(MARCA)[1];
  const diaOrig = diaUY(new Date(origIso));

  const movidas = await reinsertar(marcadas, (f) => {
    const [origenReal, iso] = [f.origen.slice(0, f.origen.indexOf(MARCA)), f.origen.split(MARCA)[1]];
    return { ...f, registrado_en: iso, origen: origenReal || null };
  });

  const { data: rend } = await db.from("rendiciones").select("id").eq("fecha", diaActual);
  for (const r of rend ?? []) await db.from("rendiciones").update({ fecha: diaOrig }).eq("id", r.id);
  const { data: cz } = await db.from("cierres_zona").select("id").eq("fecha", diaActual);
  for (const c of cz ?? []) await db.from("cierres_zona").update({ fecha: diaOrig }).eq("id", c.id);

  console.log(`✔ ${movidas} pagos restaurados a ${diaOrig} · rendiciones: ${(rend ?? []).length} · cierres: ${(cz ?? []).length}`);
}
