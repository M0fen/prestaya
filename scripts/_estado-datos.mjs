// Foto READ-ONLY del estado de datos para planificar el refresco antes del piloto.
//   node --env-file=.env.local scripts/_estado-datos.mjs
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(url, key, { auth: { persistSession: false } });

const cnt = async (tabla, f = (q) => q) => {
  const { count, error } = await f(db.from(tabla).select("*", { count: "exact", head: true }));
  if (error) throw new Error(`${tabla}: ${error.message}`);
  return count ?? 0;
};

// Último pago (fecha máx de registrado_en) — sin traer todo: order desc + limit 1.
const ultimoPago = async () => {
  const { data, error } = await db.from("pagos").select("registrado_en").eq("anulado", false)
    .order("registrado_en", { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0]?.registrado_en ?? null;
};
const primerPagoReciente = async (desdeIso) => {
  const { count } = await db.from("pagos").select("*", { count: "exact", head: true })
    .eq("anulado", false).gte("registrado_en", desdeIso);
  return count ?? 0;
};

// Pagos por día (UY) de los últimos ~10 días para ver hasta dónde llega la data real.
const porDia = async () => {
  const { data, error } = await db.rpc("app_recaudos_rango", {
    desde: new Date(Date.now() - 12 * 864e5).toISOString(), hasta: new Date().toISOString(), vendedor: null,
  }).select?.() ?? { data: null };
  return { data, error: error?.message };
};

const main = async () => {
  console.log("== ESTADO DE DATOS (", new Date().toISOString(), ") ==\n");

  const [clientes, clientesActivos, creditos, creditosActivos, pagos] = await Promise.all([
    cnt("clientes"),
    cnt("clientes", (q) => q.eq("activo", true)),
    cnt("prestamos"),
    cnt("prestamos", (q) => q.eq("estado", "activo")),
    cnt("pagos", (q) => q.eq("anulado", false)),
  ]);
  console.log("clientes:", clientes, "| activos:", clientesActivos);
  console.log("créditos:", creditos, "| activos:", creditosActivos);
  console.log("pagos (no anulados):", pagos);

  const ult = await ultimoPago();
  console.log("\nÚLTIMO pago registrado (registrado_en):", ult);
  const uy = ult ? new Date(ult).toLocaleString("es-UY", { timeZone: "America/Montevideo" }) : "—";
  console.log("  → en hora Uruguay:", uy);

  // Conteo por ventana para ver el "borde" real de la data.
  const hoy = new Date();
  for (let d = 8; d >= 0; d--) {
    const dia = new Date(hoy); dia.setUTCDate(dia.getUTCDate() - d);
    const ymd = dia.toISOString().slice(0, 10);
    // ventana UY del día: [ymd 03:00Z, ymd+1 03:00Z) aprox (UTC-3)
    const desde = `${ymd}T03:00:00.000Z`;
    const hasta = new Date(new Date(desde).getTime() + 864e5).toISOString();
    const { count } = await db.from("pagos").select("*", { count: "exact", head: true })
      .eq("anulado", false).gte("registrado_en", desde).lt("registrado_en", hasta);
    console.log(`  ${ymd} (UY): ${count ?? 0} pagos`);
  }

  // Zona Centro: cobradores y su ruta (para saber si la estructura sigue viva).
  const { data: zc } = await db.from("zonas").select("id, nombre").ilike("nombre", "%centro%");
  console.log("\nZonas 'centro':", (zc ?? []).map((z) => z.nombre).join(", ") || "—");
};
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
