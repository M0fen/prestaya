// ─────────────────────────────────────────────────────────────────────────
//  SEED DEMO "para el operador": llena CADA sección del sitio con datos de
//  prueba para que Mauricio abra el panel y vea que "pasa algo" en todos lados
//  (dashboard, mora, caja, comisiones, cobranza/mapa, control de campo, chat,
//  anulaciones, renovaciones, zonas, anuncios, auditoría, notas…).
//
//  TODO va marcado como DEMO (nombres con 🧪, notas "[demo-operador]") y con
//  IDs fijos, así se BORRA de un saque cuando el admin dé el visto bueno.
//
//    Sembrar:  node --env-file=.env.local scripts/seed-demo-operador.mjs
//    Borrar:   node --env-file=.env.local scripts/seed-demo-operador.mjs --limpiar
//
//  Usa la service_role (ignora RLS). Idempotente: limpia lo suyo y reinserta.
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

// ── IDs fijos (hex válidos, prefijo "de…" = demo) ──────────────────────────
const Z = (n) => `de20a000-0000-4000-8000-${String(n).padStart(12, "0")}`; // zonas
const U = (n) => `de50a000-0000-4000-8000-${String(n).padStart(12, "0")}`; // usuarios demo
const C = (n) => `dec1a000-0000-4000-8000-${String(n).padStart(12, "0")}`; // clientes
const P = (n) => `deb0a000-0000-4000-8000-${String(n).padStart(12, "0")}`; // prestamos
const AN = (n) => `dea0a000-0000-4000-8000-${String(n).padStart(12, "0")}`; // anuncios
const PAGO_ANUL = "dead0000-0000-4000-8000-000000000001"; // pago fijo para la anulación

// ── Fecha "hoy" en Uruguay (UTC−3) + helpers ───────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
const MS = 86_400_000;
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
const tsUY = (ms, h, min) => {
  const { y, m, d } = ymd(ms);
  return `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}:00-03:00`;
};

// PRNG determinista (mismos datos en cada corrida).
let semilla = 20260707;
const rnd = () => {
  semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
  return semilla / 0x7fffffff;
};
const ent = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// ── Catálogo demo ──────────────────────────────────────────────────────────
const ZONAS = [
  { id: Z(1), nombre: "🧪 Centro (demo)", color: "#1E47C8" },
  { id: Z(2), nombre: "🧪 Cerro (demo)", color: "#1FA971" },
];
const SUP = { id: U(1), nombre: "🧪 Sofía · supervisora (demo)" };
const COBRADORES = [
  { id: U(2), nombre: "🧪 Martín · cobrador (demo)", zona: Z(1), comision: 8 },
  { id: U(3), nombre: "🧪 Ramón · cobrador (demo)", zona: Z(1), comision: 10 },
  { id: U(4), nombre: "🧪 Lucía · cobrador (demo)", zona: Z(2), comision: 7 },
];
const GPS = { lat: -34.8721, lng: -56.1645 };

// Clientes: idx, cobrador, fiabilidad (para mora), estado del préstamo.
const CLIENTES = [
  { n: 1, nombre: "🧪 Ana Belén Rodríguez", cob: 0, fiab: 1.0, moroso: false },
  { n: 2, nombre: "🧪 Carlos Machado", cob: 0, fiab: 0.72, moroso: false },
  { n: 3, nombre: "🧪 Gabriela Núñez", cob: 1, fiab: 0.55, moroso: true },
  { n: 4, nombre: "🧪 Jorge Píriz", cob: 1, fiab: 0.95, moroso: false },
  { n: 5, nombre: "🧪 Valeria Castro", cob: 2, fiab: 0.8, moroso: false },
  { n: 6, nombre: "🧪 Marcelo Techera", cob: 2, fiab: 0.9, moroso: false },
  { n: 7, nombre: "🧪 Natalia Fonseca", cob: 0, fiab: 0.85, moroso: false },
].map((c, i) => {
  const cobrador = COBRADORES[c.cob];
  const total = [24, 30, 30, 40][i % 4];
  const monto = [8000, 12000, 15000, 20000, 10000, 18000, 9000][i];
  const cuota = Math.round((monto * 1.2) / total);
  return {
    ...c,
    id: C(c.n),
    prestamoId: P(c.n),
    cobrador,
    monto,
    cuota,
    total,
    inicioOffset: ent(6, Math.min(total - 2, 22)), // días transcurridos
    gps_lat: Number((GPS.lat + (rnd() - 0.5) * 0.08).toFixed(6)),
    gps_lng: Number((GPS.lng + (rnd() - 0.5) * 0.08).toFixed(6)),
    documento: `DEMO-${2000 + c.n}`,
    telefono: `09${ent(1, 8)} ${ent(100, 999)} ${ent(100, 999)}`,
  };
});
// Cliente 8: SOLO crédito finalizado (candidato a renovación).
const CLI_RENOV = {
  n: 8,
  id: C(8),
  nombre: "🧪 Sergio Bentancor",
  prestamoId: P(9),
  cobrador: COBRADORES[1],
  monto: 12000,
  total: 30,
  documento: "DEMO-2008",
  gps_lat: Number((GPS.lat + 0.01).toFixed(6)),
  gps_lng: Number((GPS.lng - 0.01).toFixed(6)),
};

const TODOS_USUARIOS = [SUP.id, ...COBRADORES.map((c) => c.id)];
const TODAS_ZONAS = ZONAS.map((z) => z.id);
const TODOS_CLIENTES = [...CLIENTES.map((c) => c.id), CLI_RENOV.id];
const TODOS_PRESTAMOS = [...CLIENTES.map((c) => c.prestamoId), CLI_RENOV.prestamoId];

async function ins(tabla, filas, opts) {
  if (!filas || filas.length === 0) return;
  for (let i = 0; i < filas.length; i += 400) {
    const q = db.from(tabla);
    const r = opts?.upsert
      ? await q.upsert(filas.slice(i, i + 400), { onConflict: opts.onConflict })
      : await q.insert(filas.slice(i, i + 400));
    if (r.error) {
      // Degradar si la tabla/columna aún no existe (migración sin correr).
      const m = r.error.message || "";
      if (/does not exist|schema cache|could not find/i.test(m)) {
        console.log(`· (${tabla}) omitido: ${m.split("\n")[0]}`);
        return;
      }
      throw new Error(`${tabla}: ${m}`);
    }
  }
}

async function del(tabla, col, valores) {
  const r = await db.from(tabla).delete().in(col, valores);
  if (r.error && !/does not exist|schema cache|could not find/i.test(r.error.message))
    console.log(`· (borrar ${tabla}) ${r.error.message}`);
}

async function limpiar() {
  // Hijos primero (respetando FKs), luego padres.
  await db.from("solicitudes_anulacion").delete().in("solicitado_por", TODOS_USUARIOS);
  await db.from("solicitudes_anulacion").delete().eq("pago_id", PAGO_ANUL);
  await del("solicitudes_renovacion", "cliente_id", TODOS_CLIENTES);
  await db.from("mensajes").delete().in("autor_id", TODOS_USUARIOS);
  await db.from("mensajes").delete().in("zona_id", TODAS_ZONAS);
  await db.from("chat_lecturas").delete().in("usuario_id", TODOS_USUARIOS);
  await del("notas_cliente", "cliente_id", TODOS_CLIENTES);
  await del("mora_notas", "cliente_id", TODOS_CLIENTES);
  await db.from("bitacora").delete().in("actor_id", TODOS_USUARIOS);
  await db.from("auditoria").delete().in("actor_id", TODOS_USUARIOS);
  await db.from("movimientos_caja").delete().in("registrado_por", TODOS_USUARIOS);
  await db.from("rendiciones").delete().in("cobrador_id", TODOS_USUARIOS);
  await del("pagos", "prestamo_id", TODOS_PRESTAMOS);
  await del("visitas", "prestamo_id", TODOS_PRESTAMOS);
  await del("solicitudes_renovacion", "prestamo_anterior_id", TODOS_PRESTAMOS);
  await del("prestamos", "id", TODOS_PRESTAMOS);
  await del("asignaciones", "cliente_id", TODOS_CLIENTES);
  await del("anuncios", "id", ZONAS.map((_, i) => AN(i + 1)));
  await db.from("supervisor_zonas").delete().in("supervisor_id", TODOS_USUARIOS);
  await del("clientes", "id", TODOS_CLIENTES);
  await del("usuarios", "id", TODOS_USUARIOS);
  await del("zonas", "id", TODAS_ZONAS);
}

async function main() {
  if (LIMPIAR) {
    console.log("Limpiando datos demo del operador…");
    await limpiar();
    console.log("✓ Datos demo eliminados. El sitio queda limpio.");
    return;
  }

  console.log("Sembrando datos demo para el operador…");
  await limpiar(); // idempotente

  // 1) Zonas
  await ins("zonas", ZONAS.map((z) => ({ id: z.id, nombre: z.nombre, color: z.color, activo: true })));
  console.log(`✓ ${ZONAS.length} zonas`);

  // 2) Usuarios (supervisor + cobradores). Sin login (auth_user_id null): son
  //    para ver los datos; el admin entra con su cuenta y los ve a todos.
  await ins("usuarios", [
    { id: SUP.id, nombre: SUP.nombre, rol: "supervisor", activo: true, auth_user_id: null, zona_id: null, comision_pct: 0 },
    ...COBRADORES.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      rol: "cobrador",
      activo: true,
      auth_user_id: null,
      zona_id: c.zona,
      comision_pct: c.comision,
    })),
  ]);
  console.log(`✓ 1 supervisor + ${COBRADORES.length} cobradores`);

  // 3) Supervisor cubre la zona Centro (así el chat de zona y el aislamiento se ven).
  await ins("supervisor_zonas", [{ supervisor_id: SUP.id, zona_id: Z(1) }]);

  // 4) Clientes (activos + el de renovación).
  await ins("clientes", [
    ...CLIENTES.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      documento: c.documento,
      telefono: c.telefono,
      direccion: "🧪 Dirección demo",
      calificacion: c.moroso ? "riesgo" : ["excelente", "bueno", "bueno", "nuevo"][c.n % 4],
      activo: true,
      notas: "[demo-operador]",
      gps_lat: c.gps_lat,
      gps_lng: c.gps_lng,
    })),
    {
      id: CLI_RENOV.id,
      nombre: CLI_RENOV.nombre,
      documento: CLI_RENOV.documento,
      direccion: "🧪 Dirección demo",
      calificacion: "bueno",
      activo: true,
      notas: "[demo-operador]",
      gps_lat: CLI_RENOV.gps_lat,
      gps_lng: CLI_RENOV.gps_lng,
    },
  ]);
  console.log(`✓ ${TODOS_CLIENTES.length} clientes`);

  // 5) Préstamos (activos + 1 finalizado para renovación).
  const prestamos = CLIENTES.map((c) => ({
    id: c.prestamoId,
    cliente_id: c.id,
    cobrador_id: c.cobrador.id,
    monto_prestado: c.monto,
    cuota_diaria: c.cuota,
    total_dias: c.total,
    fecha_inicio: fechaStr(HOY_MS - c.inicioOffset * MS),
    estado: "activo",
    creado_por: c.cobrador.id,
  }));
  prestamos.push({
    id: CLI_RENOV.prestamoId,
    cliente_id: CLI_RENOV.id,
    cobrador_id: CLI_RENOV.cobrador.id,
    monto_prestado: CLI_RENOV.monto,
    cuota_diaria: Math.round((CLI_RENOV.monto * 1.2) / CLI_RENOV.total),
    total_dias: CLI_RENOV.total,
    fecha_inicio: fechaStr(HOY_MS - (CLI_RENOV.total + 8) * MS),
    estado: "finalizado",
    creado_por: CLI_RENOV.cobrador.id,
    finalizado_en: tsUY(HOY_MS - 6 * MS, 17, 0),
  });
  await ins("prestamos", prestamos);
  console.log(`✓ ${prestamos.length} préstamos`);

  // 6) Asignaciones.
  await ins("asignaciones", [
    ...CLIENTES.map((c) => ({ cobrador_id: c.cobrador.id, cliente_id: c.id, activo: true })),
    { cobrador_id: CLI_RENOV.cobrador.id, cliente_id: CLI_RENOV.id, activo: true },
  ]);

  // 7) Pagos (historial en el tiempo + varios HOY con movimiento).
  const pagos = [];
  for (const c of CLIENTES) {
    const hasta = Math.min(c.total, c.inicioOffset + 1); // incluye hoy
    for (let dia = 1; dia <= hasta; dia++) {
      const diaMs = HOY_MS - (c.inicioOffset - (dia - 1)) * MS;
      if (rnd() > c.fiab) continue; // los flojos dejan huecos → mora
      const parcial = dia < hasta && rnd() < 0.07;
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
  // Renovación: crédito finalizado pagado completo.
  {
    const cuota = Math.round((CLI_RENOV.monto * 1.2) / CLI_RENOV.total);
    const inicioMs = HOY_MS - (CLI_RENOV.total + 8) * MS;
    for (let dia = 1; dia <= CLI_RENOV.total; dia++)
      pagos.push({
        prestamo_id: CLI_RENOV.prestamoId,
        dia_credito: dia,
        monto: cuota,
        registrado_por: CLI_RENOV.cobrador.id,
        registrado_en: tsUY(inicioMs + (dia - 1) * MS, ent(8, 18), ent(0, 59)),
      });
  }
  await ins("pagos", pagos);
  // Pago con ID fijo para la solicitud de anulación (cliente 1, día 2).
  await ins("pagos", [
    {
      id: PAGO_ANUL,
      prestamo_id: CLIENTES[0].prestamoId,
      dia_credito: 2,
      monto: CLIENTES[0].cuota,
      registrado_por: CLIENTES[0].cobrador.id,
      registrado_en: tsUY(HOY_MS - (CLIENTES[0].inicioOffset - 1) * MS, 10, 15),
      gps_lat: CLIENTES[0].gps_lat,
      gps_lng: CLIENTES[0].gps_lng,
    },
  ]);
  console.log(`✓ ${pagos.length + 1} pagos`);

  // 8) Visitas (no-pago de hoy → alertas de cobranza).
  await ins("visitas", [
    {
      prestamo_id: CLIENTES[1].prestamoId,
      cobrador_id: CLIENTES[1].cobrador.id,
      resultado: "no_estaba",
      motivo: "🧪 No estaba en el domicilio",
      registrado_en: tsUY(HOY_MS, 11, 30),
      gps_lat: CLIENTES[1].gps_lat,
      gps_lng: CLIENTES[1].gps_lng,
    },
    {
      prestamo_id: CLIENTES[2].prestamoId,
      cobrador_id: CLIENTES[2].cobrador.id,
      resultado: "no_pago",
      motivo: "🧪 Pidió para mañana",
      registrado_en: tsUY(HOY_MS, 12, 5),
      gps_lat: CLIENTES[2].gps_lat,
      gps_lng: CLIENTES[2].gps_lng,
    },
  ]);

  // 9) Caja: ingresos, desembolso, gasto de ruta, comisión liquidada, retiro.
  await ins("movimientos_caja", [
    { tipo: "ingreso", categoria: "Cobranza", monto: 4200, descripcion: "🧪 Cobranza del día (demo)", cobrador_id: COBRADORES[0].id, registrado_por: COBRADORES[0].id, fecha: fechaStr(HOY_MS) },
    { tipo: "desembolso", categoria: "Préstamo", monto: 12000, descripcion: "🧪 Colocación nueva (demo)", cobrador_id: COBRADORES[1].id, registrado_por: SUP.id, fecha: fechaStr(HOY_MS) },
    { tipo: "egreso", categoria: "Combustible", monto: 350, descripcion: "🧪 Nafta ruta (demo)", cobrador_id: COBRADORES[0].id, registrado_por: COBRADORES[0].id, fecha: fechaStr(HOY_MS) },
    { tipo: "egreso", categoria: "Comisión", monto: 1800, descripcion: "🧪 Comisión liquidada (demo)", cobrador_id: COBRADORES[0].id, registrado_por: SUP.id, fecha: fechaStr(HOY_MS - MS) },
    { tipo: "retiro", categoria: "Retiro socio", monto: 5000, descripcion: "🧪 Retiro (demo)", registrado_por: SUP.id, fecha: fechaStr(HOY_MS - 2 * MS) },
  ]);

  // 10) Rendiciones de hoy (una exacta, otra con faltante).
  await ins("rendiciones", [
    { cobrador_id: COBRADORES[0].id, fecha: fechaStr(HOY_MS), recaudado: 4200, cobros_cantidad: 6, gastos: 350, entregado: 3850, diferencia: 0, notas: "🧪 Cuadró (demo)", registrado_por: COBRADORES[0].id },
    { cobrador_id: COBRADORES[1].id, fecha: fechaStr(HOY_MS), recaudado: 3600, cobros_cantidad: 5, gastos: 0, entregado: 3400, diferencia: -200, notas: "🧪 Faltante (demo)", registrado_por: COBRADORES[1].id },
  ]);

  // 11) Mora: marcar un cliente moroso + notas de mora.
  await db.from("clientes").update({
    moroso: true,
    moroso_motivo: "🧪 Atrasos reiterados (demo)",
    moroso_desde: tsUY(HOY_MS - 5 * MS, 9, 0),
    moroso_por: SUP.id,
  }).eq("id", C(3));
  await ins("mora_notas", [
    { cliente_id: C(3), tipo: "motivo", texto: "🧪 Dejó de pagar hace una semana (demo)", autor_id: SUP.id, autor_nombre: SUP.nombre },
    { cliente_id: C(3), tipo: "acuerdo", texto: "🧪 Se comprometió a ponerse al día el viernes (demo)", autor_id: SUP.id, autor_nombre: SUP.nombre },
  ]);

  // 12) Renovación pendiente (para /admin/renovaciones).
  await ins("solicitudes_renovacion", [
    {
      cliente_id: CLI_RENOV.id,
      prestamo_anterior_id: CLI_RENOV.prestamoId,
      monto: 15000,
      total_dias: 30,
      frecuencia: "diario",
      estado: "pendiente",
      solicitado_por: SUP.id,
      solicitado_por_nombre: SUP.nombre,
    },
  ]);

  // 13) Anulación pendiente (para /admin/anulaciones).
  await ins("solicitudes_anulacion", [
    {
      pago_id: PAGO_ANUL,
      motivo: "🧪 Se cargó dos veces por error (demo)",
      estado: "pendiente",
      solicitado_por: SUP.id,
      solicitado_por_nombre: SUP.nombre,
    },
  ]);

  // 14) Chat: general, supervisores, zona Centro y un hilo de cobrador.
  await ins("mensajes", [
    { ambito: "general", cobrador_id: null, zona_id: null, autor_id: SUP.id, cuerpo: "🧪 Buen día equipo, arranquemos la ruta.", creado_en: tsUY(HOY_MS, 8, 0) },
    { ambito: "general", cobrador_id: null, zona_id: null, autor_id: COBRADORES[0].id, cuerpo: "🧪 Salgo para el Centro.", creado_en: tsUY(HOY_MS, 8, 5) },
    { ambito: "supervisores", cobrador_id: null, zona_id: null, autor_id: SUP.id, cuerpo: "🧪 Ojo con la mora de la zona Centro esta semana.", creado_en: tsUY(HOY_MS, 8, 30) },
    { ambito: "zona", cobrador_id: null, zona_id: Z(1), autor_id: SUP.id, cuerpo: "🧪 Zona Centro: prioricen los atrasados de ayer.", creado_en: tsUY(HOY_MS, 9, 0) },
    { ambito: "zona", cobrador_id: null, zona_id: Z(1), autor_id: COBRADORES[1].id, cuerpo: "🧪 Dale, voy por Gabriela primero.", creado_en: tsUY(HOY_MS, 9, 2) },
    { ambito: "cobrador", cobrador_id: COBRADORES[0].id, zona_id: null, autor_id: COBRADORES[0].id, cuerpo: "🧪 Me falta cambio de $1000.", creado_en: tsUY(HOY_MS, 10, 0) },
    { ambito: "cobrador", cobrador_id: COBRADORES[0].id, zona_id: null, autor_id: SUP.id, cuerpo: "🧪 Te lo llevo al mediodía.", creado_en: tsUY(HOY_MS, 10, 4) },
  ]);

  // 15) Notas de cliente (aparecen en la ficha).
  await ins("notas_cliente", [
    { cliente_id: C(1), autor_id: SUP.id, cuerpo: "🧪 Cliente muy cumplidor, candidato a ampliar (demo)." },
    { cliente_id: C(3), autor_id: COBRADORES[1].id, cuerpo: "🧪 Cambió de trabajo, cobrar por la tarde (demo)." },
  ]);

  // 16) Anuncios (vista de cliente + /admin/anuncios).
  await ins("anuncios", [
    { id: AN(1), titulo: "🧪 ¡Al día y con premio!", cuerpo: "Pagá en fecha y sumá estrellas (demo).", tema: "verde", prioridad: 10, activo: true, segmento: "al_dia" },
    { id: AN(2), titulo: "🧪 Recordatorio", cuerpo: "Tu cuota de hoy te acerca a la meta (demo).", tema: "azul", prioridad: 5, activo: true, segmento: "con_pendientes" },
  ]);

  // 17) Bitácora de campo (control anti-fuga + score de sospecha).
  const bit = [];
  const acc = ["cobro", "no_pago", "censo", "gasto", "ver_ficha"];
  for (let i = 0; i < COBRADORES.length; i++) {
    const c = COBRADORES[i];
    const cli = CLIENTES[i];
    bit.push({
      actor_id: c.id, actor_nombre: c.nombre, rol: "cobrador", accion: "cobro",
      cliente_id: cli.id, prestamo_id: cli.prestamoId, monto: cli.cuota,
      gps_lat: cli.gps_lat, gps_lng: cli.gps_lng, en_zona: true, gps_denegado: false,
      detalle: null, server_ts: tsUY(HOY_MS, 9 + i, 15), fecha_uy: fechaStr(HOY_MS),
    });
  }
  // Una acción SOSPECHOSA: cobro fuera de zona + GPS denegado.
  bit.push({
    actor_id: COBRADORES[2].id, actor_nombre: COBRADORES[2].nombre, rol: "cobrador",
    accion: "cobro", cliente_id: CLIENTES[4].id, prestamo_id: CLIENTES[4].prestamoId,
    monto: CLIENTES[4].cuota, gps_lat: -34.95, gps_lng: -56.05, en_zona: false,
    gps_denegado: false, detalle: "🧪 Cobro lejos del domicilio (demo)",
    server_ts: tsUY(HOY_MS, 13, 40), fecha_uy: fechaStr(HOY_MS),
  });
  bit.push({
    actor_id: COBRADORES[0].id, actor_nombre: COBRADORES[0].nombre, rol: "cobrador",
    accion: "cierre_jornada", detalle: "🧪 Cerró la jornada (demo)",
    gps_denegado: true, server_ts: tsUY(HOY_MS, 18, 0), fecha_uy: fechaStr(HOY_MS),
  });
  await ins("bitacora", bit);

  // 18) Auditoría (log inmutable de acciones de gestión).
  await ins("auditoria", [
    { actor_id: SUP.id, actor_nombre: SUP.nombre, accion: "Solicitó anular un pago", entidad: "pago", entidad_id: PAGO_ANUL, detalle: "🧪 demo" },
    { actor_id: SUP.id, actor_nombre: SUP.nombre, accion: "Solicitó una renovación", entidad: "renovacion", entidad_id: CLI_RENOV.id, detalle: "🧪 demo" },
    { actor_id: SUP.id, actor_nombre: SUP.nombre, accion: "Marcó un cliente como moroso", entidad: "cliente", entidad_id: C(3), detalle: "🧪 demo" },
  ]);

  console.log("\n✅ Datos demo del operador listos. Abrí el panel y recorré cada sección.");
  console.log("   Para borrar todo: node --env-file=.env.local scripts/seed-demo-operador.mjs --limpiar");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
