// ─────────────────────────────────────────────────────────────────────────
//  Seed de DATOS DEMO para ver la mecánica del panel: varios cobradores,
//  varios clientes con crédito activo, historial de pagos repartido en el
//  tiempo (para que día/semana/mes/año y "recaudo por cobrador" se llenen) y
//  algo de mora realista. Idempotente: usa ids fijos y limpia lo suyo antes de
//  reinsertar. Marca los clientes con notas "[demo-seed]".
//
//    node --env-file=.env.local scripts/seed-demo-datos.mjs
//
//  Para BORRAR luego todo lo sembrado:
//    node --env-file=.env.local scripts/seed-demo-datos.mjs --limpiar
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

// Credenciales generadas (supervisor + cobrador demo) para imprimir al final.
const credenciales = [];

// ── Ids fijos (uuid válidos) para poder reejecutar sin duplicar ────────────
const cobId = (n) => `d0c0b000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cliId = (n) => `c1100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const preId = (n) => `b0a00000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const pad = (n) => String(n).padStart(2, "0");
const MS = 86_400_000;

// "Hoy" en el calendario de Uruguay (UTC−3).
const partesHoy = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Montevideo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const [HY, HM, HD] = partesHoy.split("-").map(Number);
const HOY_MS = Date.UTC(HY, HM - 1, HD);

const ymd = (ms) => {
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};
const fechaStr = (ms) => {
  const { y, m, d } = ymd(ms);
  return `${y}-${pad(m)}-${pad(d)}`;
};
/** timestamptz en hora de Uruguay para un día + hora. */
const tsUY = (ms, hora, min) => {
  const { y, m, d } = ymd(ms);
  return `${y}-${pad(m)}-${pad(d)}T${pad(hora)}:${pad(min)}:00-03:00`;
};

// PRNG determinista (mismos datos en cada corrida).
let semilla = 20260702;
const rnd = () => {
  semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
  return semilla / 0x7fffffff;
};
const ent = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const elegir = (arr) => arr[Math.floor(rnd() * arr.length)];

// ── Catálogo demo ──────────────────────────────────────────────────────────
const COBRADORES = [
  { id: cobId(1), nombre: "Martín Olivera" },
  { id: cobId(2), nombre: "Ramón Sosa" },
  { id: cobId(3), nombre: "Sofía Delgado" },
  { id: cobId(4), nombre: "Bruno Cabrera" },
  { id: cobId(5), nombre: "Lucía Méndez" },
];

// ── Jerarquía con login (demo autocontenido del alcance por rol) ────────────
//  Zona demo + supervisor sobre ESA zona + login para el 1er cobrador. Deja ver
//  la regla en vivo: admin ve TODO · supervisor ve SOLO su zona · cobrador ve su
//  ruta. Ids fijos → reejecutable y borrable con --limpiar.
const ZONA_ID = "20a00000-0000-4000-8000-000000000001";
const SUP_ID = "50c0b000-0000-4000-8000-000000000001"; // usuarios.id del supervisor demo
const SUP_EMAIL = "demo-supervisor@prestaya.uy";
const COB_LOGIN_EMAIL = "demo-cobrador@prestaya.uy"; // login para COBRADORES[0]

/** Contraseña temporal legible (sin caracteres ambiguos). */
function generarPass() {
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint32Array(12);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((n) => abc[n % abc.length]).join("");
}
/** Busca un usuario de auth por email (pagina lo suficiente para este volumen). */
async function buscarAuth(email) {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  return (data?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
}
/** Asegura un login (crea o resetea contraseña). Devuelve el auth_user_id. */
async function asegurarLogin(email, password) {
  const ex = await buscarAuth(email);
  if (ex) {
    await db.auth.admin.updateUserById(ex.id, { password, email_confirm: true });
    return ex.id;
  }
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data?.user) throw new Error(`auth ${email}: ${error?.message}`);
  return data.user.id;
}

const NOMBRES = [
  "Ana Belén Rodríguez", "Carlos Machado", "Gabriela Núñez", "Jorge Píriz",
  "Valeria Castro", "Marcelo Techera", "Natalia Fonseca", "Sergio Bentancor",
  "Rosa Ibáñez", "Héctor Silvera", "Mónica Arias", "Fernando Cardozo",
  "Beatriz Lima", "Andrés Villar", "Patricia Duarte", "Raúl Estévez",
];
const DIRS = [
  "Av. 8 de Octubre 3120", "Camino Maldonado 5540", "Bulevar Artigas 1890",
  "Av. Italia 4210", "Cno. Carrasco 2760", "Gral. Flores 3355",
  "Av. Rivera 4980", "Millán 2840", "Av. San Martín 3610", "Propios 2450",
];
const CALIF = ["excelente", "bueno", "bueno", "regular", "nuevo", "riesgo"];
const GPS_BASE = { lat: -34.8721, lng: -56.1645 }; // Montevideo

// Config de clientes activos: fiabilidad de pago (para generar mora variada).
const CLIENTES = NOMBRES.map((nombre, i) => {
  const total = elegir([24, 30, 30, 40]);
  const monto = elegir([8000, 10000, 12000, 15000, 18000, 20000, 25000, 30000]);
  const cuota = Math.round((monto * 1.2) / total); // ~20% de interés
  return {
    idx: i + 1,
    id: cliId(i + 1),
    nombre,
    documento: `DEMO-${1000 + i}`,
    telefono: `09${ent(1, 8)} ${ent(100, 999)} ${ent(100, 999)}`,
    direccion: elegir(DIRS),
    calificacion: CALIF[i % CALIF.length],
    gps_lat: GPS_BASE.lat + (rnd() - 0.5) * 0.08,
    gps_lng: GPS_BASE.lng + (rnd() - 0.5) * 0.08,
    prestamoId: preId(i + 1),
    cobrador: COBRADORES[i % COBRADORES.length],
    monto,
    cuota,
    total,
    // Inicio DENTRO del plazo (crédito en curso) → hay cuota exigible hoy.
    inicioOffset: ent(3, Math.min(total - 2, 48)),
    fiabilidad: [1, 1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.65][i % 8], // % de días pagados
  };
});

// Créditos extra (no activos) para poblar "finalizados"/"incobrables".
const EXTRA = [
  { id: preId(101), cliente: 0, estado: "finalizado", total: 30, monto: 12000, finOffset: 6 },
  { id: preId(102), cliente: 1, estado: "finalizado", total: 24, monto: 9000, finOffset: 14 },
  { id: preId(103), cliente: 4, estado: "finalizado", total: 30, monto: 15000, finOffset: 25 },
  { id: preId(201), cliente: 8, estado: "incobrable", total: 30, monto: 10000, finOffset: 40 },
];

const TODOS_PRESTAMOS = [...CLIENTES.map((c) => c.prestamoId), ...EXTRA.map((e) => e.id)];
const TODOS_CLIENTES = CLIENTES.map((c) => c.id);

async function chunkInsert(tabla, filas, size = 400) {
  for (let i = 0; i < filas.length; i += size) {
    const { error } = await db.from(tabla).insert(filas.slice(i, i + size));
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

async function limpiar() {
  // Orden por FK: pagos/visitas → prestamos → asignaciones.
  await db.from("pagos").delete().in("prestamo_id", TODOS_PRESTAMOS);
  await db.from("visitas").delete().in("prestamo_id", TODOS_PRESTAMOS);
  await db.from("prestamos").delete().in("id", TODOS_PRESTAMOS);
  await db.from("asignaciones").delete().in("cliente_id", TODOS_CLIENTES);
}

async function main() {
  console.log(LIMPIAR ? "Limpiando datos demo…" : "Sembrando datos demo…");
  await limpiar();
  if (LIMPIAR) {
    // Jerarquía con login, en orden por FK: supervisor_zonas → zona_id de los
    // cobradores → zona → usuario supervisor → usuarios de auth.
    try {
      await db.from("supervisor_zonas").delete().eq("supervisor_id", SUP_ID);
      await db.from("usuarios").update({ zona_id: null }).in("id", COBRADORES.map((c) => c.id));
      await db.from("zonas").delete().eq("id", ZONA_ID);
      await db.from("usuarios").delete().eq("id", SUP_ID);
      for (const email of [SUP_EMAIL, COB_LOGIN_EMAIL]) {
        const a = await buscarAuth(email);
        if (a) await db.auth.admin.deleteUser(a.id);
      }
    } catch (e) {
      console.log(`⚠ limpieza de jerarquía parcial: ${e.message}`);
    }
    await db.from("clientes").delete().in("id", TODOS_CLIENTES);
    await db.from("usuarios").delete().in("id", COBRADORES.map((c) => c.id));
    console.log("✓ Datos demo eliminados.");
    return;
  }

  // 1) Cobradores (sin login; solo para ver el control).
  await db.from("usuarios").upsert(
    COBRADORES.map((c) => ({ id: c.id, nombre: c.nombre, rol: "cobrador", activo: true, auth_user_id: null })),
    { onConflict: "id" },
  );
  console.log(`✓ ${COBRADORES.length} cobradores`);

  // 2) Clientes.
  await db.from("clientes").upsert(
    CLIENTES.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      documento: c.documento,
      telefono: c.telefono,
      direccion: c.direccion,
      calificacion: c.calificacion,
      activo: true,
      notas: "[demo-seed]",
      gps_lat: Number(c.gps_lat.toFixed(6)),
      gps_lng: Number(c.gps_lng.toFixed(6)),
    })),
    { onConflict: "id" },
  );
  console.log(`✓ ${CLIENTES.length} clientes`);

  // 3) Préstamos activos + extra.
  const prestamos = [];
  for (const c of CLIENTES) {
    prestamos.push({
      id: c.prestamoId,
      cliente_id: c.id,
      cobrador_id: c.cobrador.id,
      monto_prestado: c.monto,
      cuota_diaria: c.cuota,
      total_dias: c.total,
      fecha_inicio: fechaStr(HOY_MS - c.inicioOffset * MS),
      estado: "activo",
      creado_por: c.cobrador.id,
    });
  }
  for (const e of EXTRA) {
    const cli = CLIENTES[e.cliente];
    const cuota = Math.round((e.monto * 1.2) / e.total);
    prestamos.push({
      id: e.id,
      cliente_id: cli.id,
      cobrador_id: cli.cobrador.id,
      monto_prestado: e.monto,
      cuota_diaria: cuota,
      total_dias: e.total,
      fecha_inicio: fechaStr(HOY_MS - (e.finOffset + e.total + 2) * MS),
      estado: e.estado,
      creado_por: cli.cobrador.id,
      finalizado_en: tsUY(HOY_MS - e.finOffset * MS, 17, 0),
    });
  }
  await chunkInsert("prestamos", prestamos);
  console.log(`✓ ${prestamos.length} préstamos (${CLIENTES.length} activos, ${EXTRA.length} extra)`);

  // 4) Asignaciones (cobrador ↔ cliente).
  await db.from("asignaciones").upsert(
    CLIENTES.map((c) => ({ cobrador_id: c.cobrador.id, cliente_id: c.id, activo: true })),
    { onConflict: "cobrador_id,cliente_id" },
  );
  console.log(`✓ ${CLIENTES.length} asignaciones`);

  // 4b) Jerarquía con login: zona demo + supervisor sobre la zona + login para
  //     el primer cobrador. Con esto se demuestra EN VIVO el alcance por rol
  //     (admin ve todo · supervisor ve SOLO su zona · cobrador ve su ruta).
  //     Degrada si la migración 0030 (zonas) aún no corrió.
  try {
    const supPass = generarPass();
    const supAuthId = await asegurarLogin(SUP_EMAIL, supPass);
    // Usuario supervisor (id fijo para poder limpiarlo).
    await db.from("usuarios").upsert(
      { id: SUP_ID, nombre: "Carola Supervisora (demo)", rol: "supervisor", activo: true, auth_user_id: supAuthId },
      { onConflict: "id" },
    );
    // Zona demo (creado_por = un usuario válido; usamos el supervisor demo).
    await db.from("zonas").upsert(
      {
        id: ZONA_ID,
        nombre: "Zona Demo Centro",
        color: "#1E47C8",
        descripcion: "Zona de demostración (datos [demo-seed]).",
        activo: true,
        creado_por: SUP_ID,
      },
      { onConflict: "id" },
    );
    // Todos los cobradores demo entran en la zona → los ~16 clientes quedan bajo
    // la zona del supervisor.
    await db.from("usuarios").update({ zona_id: ZONA_ID }).in("id", COBRADORES.map((c) => c.id));
    // Supervisor ↔ zona.
    await db.from("supervisor_zonas").upsert(
      { supervisor_id: SUP_ID, zona_id: ZONA_ID, asignado_por: SUP_ID },
      { onConflict: "supervisor_id,zona_id" },
    );
    // Login para el primer cobrador (su ruta = sus clientes asignados).
    const cobPass = generarPass();
    const cobAuthId = await asegurarLogin(COB_LOGIN_EMAIL, cobPass);
    await db.from("usuarios").update({ auth_user_id: cobAuthId }).eq("id", COBRADORES[0].id);
    credenciales.push(
      { rol: "supervisor", email: SUP_EMAIL, password: supPass, quien: "ve SOLO la Zona Demo Centro" },
      { rol: "cobrador", email: COB_LOGIN_EMAIL, password: cobPass, quien: `${COBRADORES[0].nombre} — su ruta` },
    );
    console.log("✓ zona demo + supervisor + login de cobrador");
  } catch (e) {
    console.log(`⚠ jerarquía con login omitida (¿falta la migración 0030?): ${e.message}`);
  }

  // 5) Pagos (historial repartido en el tiempo, atribuido al cobrador).
  const pagos = [];
  // Activos: pagan según su fiabilidad; el día de hoy queda pendiente para varios.
  for (const c of CLIENTES) {
    const elapsed = c.inicioOffset; // días transcurridos desde el inicio
    const hasta = Math.min(c.total, elapsed + 1);
    for (let dia = 1; dia <= hasta; dia++) {
      const diaMs = HOY_MS - (c.inicioOffset - (dia - 1)) * MS;
      const esHoy = diaMs === HOY_MS;
      // Pago según fiabilidad (también hoy): los cumplidores ya pagaron, los
      // flojos quedan pendientes → mora realista, "hoy" con movimiento real.
      if (rnd() > c.fiabilidad) continue;
      const parcial = !esHoy && rnd() < 0.06; // algún abono parcial
      pagos.push({
        prestamo_id: c.prestamoId,
        dia_credito: dia,
        monto: parcial ? Math.round(c.cuota / 2) : c.cuota,
        registrado_por: c.cobrador.id,
        registrado_en: tsUY(diaMs, ent(8, 18), ent(0, 59)),
        gps_lat: Number((c.gps_lat + (rnd() - 0.5) * 0.001).toFixed(6)),
        gps_lng: Number((c.gps_lng + (rnd() - 0.5) * 0.001).toFixed(6)),
      });
    }
  }
  // Extra finalizados: pagados completos en su ventana pasada.
  for (const e of EXTRA) {
    if (e.estado !== "finalizado") continue;
    const cli = CLIENTES[e.cliente];
    const cuota = Math.round((e.monto * 1.2) / e.total);
    const inicioMs = HOY_MS - (e.finOffset + e.total + 2) * MS;
    for (let dia = 1; dia <= e.total; dia++) {
      pagos.push({
        prestamo_id: e.id,
        dia_credito: dia,
        monto: cuota,
        registrado_por: cli.cobrador.id,
        registrado_en: tsUY(inicioMs + (dia - 1) * MS, ent(8, 18), ent(0, 59)),
        gps_lat: Number(cli.gps_lat.toFixed(6)),
        gps_lng: Number(cli.gps_lng.toFixed(6)),
      });
    }
  }
  await chunkInsert("pagos", pagos);
  console.log(`✓ ${pagos.length} pagos repartidos en el tiempo`);

  if (credenciales.length) {
    console.log("\n===== LOGINS DEMO (temporales — para probar el alcance por rol) =====");
    for (const c of credenciales)
      console.log(`${c.rol.padEnd(11)} ${c.email.padEnd(26)} ${c.password}   (${c.quien})`);
    console.log("El admin real (admin@prestaya.uy) ve TODA la operación, incluido lo demo.");
  }

  console.log("\nDatos demo listos ✅  Entrá al panel y probá el selector Día/Semana/Mes/Año.");
  console.log("Para borrarlos: node --env-file=.env.local scripts/seed-demo-datos.mjs --limpiar");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
