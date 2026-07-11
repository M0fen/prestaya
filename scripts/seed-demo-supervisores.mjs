// ─────────────────────────────────────────────────────────────────────────
//  SEED DEMO "supervisores para inmersión total": arma 3 supervisores con su
//  cobrador destacado (con LOGIN real), cada uno en su zona poblada por un
//  EQUIPO de cobradores reales (con cartera y recaudo de verdad), para que al
//  entrar cada supervisor vea una operación viva y creíble.
//
//    Sembrar:  node --env-file=.env.local scripts/seed-demo-supervisores.mjs
//    Borrar:   node --env-file=.env.local scripts/seed-demo-supervisores.mjs --limpiar
//
//  Usa la service_role (ignora RLS). Idempotente. NO fabrica pagos (la data de
//  recaudo del día ya está cargada): solo organiza zonas/logins/equipos y agrega
//  rendiciones + compromisos (tablas aparte) para que Cierre y el mini-CRM luzcan.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("✗ Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const LIMPIAR = process.argv.includes("--limpiar");
const PASS = "PrestaYa2026!";

// ── IDs fijos (prefijo "dede…" = demo-supervisores) ────────────────────────
const Z = (n) => `dede0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SUPID = (n) => `dede5000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ── Fecha "hoy" en Uruguay ──────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
const partesHoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const [HY, HM, HD] = partesHoy.split("-").map(Number);
const HOY = `${HY}-${pad(HM)}-${pad(HD)}`;
const inicioHoyIso = `${HOY}T00:00:00-03:00`;
const tsHoy = (h, m) => `${HOY}T${pad(h)}:${pad(m)}:00-03:00`;

// ── Los 3 pares (cobradores reales, por su ID actual en la base) ────────────
const PARES = [
  {
    zonaNombre: "Pando", color: "#1E47C8",
    sup: { id: SUPID(1), nombre: "César Rendón", email: "cesar.rendon@prestaya.uy" },
    cob: { id: "d24ef58e-8b03-4e8c-ad73-d51ef409662c", nombre: "Santiago Castro", email: "santiago.castro@prestaya.uy" },
  },
  {
    zonaNombre: "Salto", color: "#1FA971",
    sup: { id: SUPID(2), nombre: "Mauricio Rengifo", email: "mauricio.rengifo@prestaya.uy" },
    cob: { id: "d42b23e8-d66e-45c0-a9ba-f2bd7b5516ec", nombre: "Angie Quiñónez", email: "angie.quinonez@prestaya.uy" },
  },
  {
    zonaNombre: "Rivera", color: "#7A4DD6",
    sup: { id: SUPID(3), nombre: "Edwin Campo", email: "edwin.campo@prestaya.uy" },
    cob: { id: "1669a9bf-203d-4666-b20d-e94450f0d7fc", nombre: "Lorena Torres", email: "lorena.torres@prestaya.uy" },
  },
];
const FEATURED_IDS = PARES.map((p) => p.cob.id);
const ZONAS_IDS = PARES.map((p) => Z(PARES.indexOf(p) + 1));
const SUP_IDS = PARES.map((p) => p.sup.id);

// ── Auth: mapa email→id (una sola pasada) ───────────────────────────────────
async function cargarAuth() {
  const mapa = new Map();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) if (u.email) mapa.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 200) break;
  }
  return mapa;
}
async function ensureLoginNuevo(authMap, email, nombre) {
  const ex = authMap.get(email.toLowerCase());
  if (ex) {
    await db.auth.admin.updateUserById(ex, { password: PASS, email_confirm: true });
    return ex;
  }
  const { data, error } = await db.auth.admin.createUser({ email, password: PASS, email_confirm: true, user_metadata: { nombre } });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  authMap.set(email.toLowerCase(), data.user.id);
  return data.user.id;
}
// Cobrador que YA existe: le ponemos email/clave amigables sobre su auth actual.
async function loginCobradorExistente(authMap, cobId, email) {
  const { data: u } = await db.from("usuarios").select("auth_user_id").eq("id", cobId).maybeSingle();
  const authId = u?.auth_user_id ?? null;
  if (authId) {
    const { error } = await db.auth.admin.updateUserById(authId, { email, password: PASS, email_confirm: true });
    if (error && !/already been registered|already exists/i.test(error.message)) throw new Error(`update cob ${email}: ${error.message}`);
    authMap.set(email.toLowerCase(), authId);
    return authId;
  }
  const nuevo = await ensureLoginNuevo(authMap, email, email);
  await db.from("usuarios").update({ auth_user_id: nuevo }).eq("id", cobId);
  return nuevo;
}

async function limpiar() {
  // Rendiciones + gestiones demo.
  await db.from("rendiciones").delete().eq("fecha", HOY).in("cobrador_id", await cobradoresDeZonasDemo());
  await db.from("gestiones_cobranza").delete().in("gestor_id", SUP_IDS);
  // Sacar a los cobradores de las zonas demo (volver a sin-zona).
  await db.from("usuarios").update({ zona_id: null }).in("zona_id", ZONAS_IDS);
  // supervisor_zonas + supervisores demo + zonas demo.
  await db.from("supervisor_zonas").delete().in("supervisor_id", SUP_IDS);
  await db.from("usuarios").delete().in("id", SUP_IDS);
  await db.from("zonas").delete().in("id", ZONAS_IDS);
}
async function cobradoresDeZonasDemo() {
  const { data } = await db.from("usuarios").select("id").in("zona_id", ZONAS_IDS);
  return [...new Set([...(data ?? []).map((u) => u.id), ...FEATURED_IDS])];
}

async function main() {
  if (LIMPIAR) {
    console.log("Limpiando seed de supervisores demo…");
    await limpiar();
    console.log("✓ Seed demo eliminada (zonas/supervisores/asignaciones demo + rendiciones/gestiones de hoy).");
    return;
  }

  console.log(`Sembrando (hoy UY = ${HOY})…\n`);
  await limpiar(); // idempotente: parte de cero cada corrida
  const authMap = await cargarAuth();

  // 1) Equipos: distribuir TODO el roster real de cobradores SIN zona entre las 3
  //    zonas, BALANCEADO por tamaño de cartera (round-robin sobre el orden por
  //    activos), para que cada supervisor tenga un equipo grande y creíble —
  //    alimentado con el resto de la data real. Excluye placeholders y los 3
  //    destacados (que se fijan aparte como protagonistas).
  const { data: libres } = await db
    .from("usuarios")
    .select("id, nombre")
    .eq("rol", "cobrador")
    .eq("activo", true)
    .is("zona_id", null);
  const candidatos = (libres ?? []).filter(
    (u) => !FEATURED_IDS.includes(u.id) && !/^CARTERA|^ADMINISTRADOR/i.test(u.nombre),
  );
  const activosDe = new Map();
  for (const c of candidatos) {
    const { count } = await db
      .from("prestamos")
      .select("*", { count: "exact", head: true })
      .eq("cobrador_id", c.id)
      .eq("estado", "activo");
    activosDe.set(c.id, count ?? 0);
  }
  // Solo cobradores con cartera de verdad (deja fuera restos de "cartera" chicos).
  const reales = candidatos
    .filter((c) => (activosDe.get(c.id) ?? 0) >= 15)
    .sort((a, b) => (activosDe.get(b.id) ?? 0) - (activosDe.get(a.id) ?? 0));
  const extrasPorZona = [[], [], []];
  reales.forEach((c, i) => extrasPorZona[i % 3].push(c)); // round-robin → equipos parejos
  console.log(`  ${reales.length} cobradores reales repartidos (~${Math.ceil(reales.length / 3)} por zona)`);

  // 2) Zonas demo.
  await db.from("zonas").upsert(
    PARES.map((p, i) => ({ id: Z(i + 1), nombre: p.zonaNombre, color: p.color, activo: true })),
    { onConflict: "id" },
  );
  console.log("✓ 3 zonas:", PARES.map((p) => p.zonaNombre).join(", "));

  // 3) Por cada par: supervisor (login) + cobrador destacado (login) + equipo.
  const credenciales = [];
  for (let i = 0; i < PARES.length; i++) {
    const p = PARES[i];
    const zonaId = Z(i + 1);

    // Supervisor: login + usuarios + zona.
    const supAuth = await ensureLoginNuevo(authMap, p.sup.email, p.sup.nombre);
    await db.from("usuarios").upsert(
      { id: p.sup.id, nombre: p.sup.nombre, rol: "supervisor", activo: true, auth_user_id: supAuth, zona_id: null, comision_pct: 0 },
      { onConflict: "id" },
    );
    await db.from("supervisor_zonas").delete().eq("supervisor_id", p.sup.id);
    await db.from("supervisor_zonas").insert({ supervisor_id: p.sup.id, zona_id: zonaId });

    // Cobrador destacado: nombre limpio + login + zona.
    await loginCobradorExistente(authMap, p.cob.id, p.cob.email);
    await db.from("usuarios").update({ nombre: p.cob.nombre, zona_id: zonaId, activo: true }).eq("id", p.cob.id);

    // Equipo extra de la zona (sin login, solo para inmersión).
    const equipo = extrasPorZona[i];
    if (equipo.length) await db.from("usuarios").update({ zona_id: zonaId }).in("id", equipo.map((e) => e.id));

    credenciales.push({ zona: p.zonaNombre, sup: p.sup, cob: p.cob, equipo: equipo.map((e) => e.nombre) });
  }

  // 4) Rendiciones de HOY para dar vida al Cierre: los EQUIPOS extra rinden (uno
  //    con faltante), los DESTACADOS quedan "en ruta" (para cerrar en vivo en la demo).
  const rendir = [];
  for (let i = 0; i < 3; i++) {
    // Solo algunos rinden a mediodía; el resto (+ destacado) sigue en ruta.
    const equipo = extrasPorZona[i].slice(0, 4);
    for (let j = 0; j < equipo.length; j++) {
      const cob = equipo[j];
      const { data: pg } = await db.from("pagos").select("monto")
        .eq("registrado_por", cob.id).eq("anulado", false).gte("registrado_en", inicioHoyIso);
      const recaudado = Math.round((pg ?? []).reduce((s, r) => s + Number(r.monto), 0));
      if (recaudado <= 0) continue; // sin recaudo hoy no hay qué rendir
      const gastos = [0, 300, 450][j % 3];
      const faltante = j === 1 ? 200 : 0; // un faltante por zona → historia anti-fuga
      rendir.push({
        cobrador_id: cob.id, fecha: HOY, recaudado, cobros_cantidad: (pg ?? []).length,
        gastos, entregado: recaudado - gastos - faltante, diferencia: -faltante,
        notas: faltante ? "Faltante leve (demo)" : "Cuadró (demo)", registrado_por: cob.id,
      });
    }
  }
  if (rendir.length) {
    await db.from("rendiciones").delete().eq("fecha", HOY).in("cobrador_id", rendir.map((r) => r.cobrador_id));
    await db.from("rendiciones").insert(rendir);
  }
  console.log(`✓ ${rendir.length} rendiciones de hoy (equipos), destacados quedan en ruta`);

  // 5) Compromisos de pago (mini-CRM) para la Apertura de cada supervisor: un
  //    cliente del cobrador destacado con promesa (vence hoy) → aparece en Jornada.
  const gestiones = [];
  for (let i = 0; i < PARES.length; i++) {
    const p = PARES[i];
    const { data: asg } = await db.from("asignaciones").select("cliente_id").eq("cobrador_id", p.cob.id).eq("activo", true).limit(3);
    const clientes = (asg ?? []).map((a) => a.cliente_id);
    if (!clientes.length) continue;
    // préstamo activo de ese cliente (para linkear).
    const { data: pr } = await db.from("prestamos").select("id, cliente_id, cuota_diaria").in("cliente_id", clientes).eq("estado", "activo").limit(2);
    for (let k = 0; k < (pr ?? []).length; k++) {
      const row = pr[k];
      gestiones.push({
        cliente_id: row.cliente_id, prestamo_id: row.id, gestor_id: p.sup.id, gestor_nombre: p.sup.nombre,
        tipo: "compromiso", resultado: "Se compromete a ponerse al día",
        monto_compromiso: Math.max(200, Math.round(Number(row.cuota_diaria) * (k === 0 ? 2 : 3))),
        fecha_compromiso: HOY, // vence hoy → aparece en "Compromisos" de la Apertura
      });
    }
  }
  if (gestiones.length) await db.from("gestiones_cobranza").insert(gestiones);
  console.log(`✓ ${gestiones.length} compromisos de pago (mini-CRM)`);

  // ── Credenciales ──────────────────────────────────────────────────────────
  console.log("\n════════════ CREDENCIALES (clave común: " + PASS + ") ════════════");
  for (const c of credenciales) {
    console.log(`\n▓ Zona ${c.zona}  (${c.equipo.length + 1} cobradores en el equipo)`);
    console.log(`  Supervisor : ${c.sup.nombre.padEnd(18)} → ${c.sup.email}`);
    console.log(`  Cobrador★  : ${c.cob.nombre.padEnd(18)} → ${c.cob.email}`);
    console.log(`  Equipo     : ${c.equipo.slice(0, 4).join(" · ")}${c.equipo.length > 4 ? ` … (+${c.equipo.length - 4})` : ""}`);
  }
  console.log("\n✅ Seed lista. Cada supervisor entra y ve su equipo con recaudo real de hoy.");
  console.log("   Borrar: node --env-file=.env.local scripts/seed-demo-supervisores.mjs --limpiar");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
