// ─────────────────────────────────────────────────────────────────────────
//  Verifica que un proyecto Supabase tenga el ESQUEMA COMPLETO de Presta Ya
//  (las 35 migraciones). Read-only: cuenta filas de cada tabla y prueba las
//  funciones RLS clave. Pensado para el PROYECTO DE PRUEBA recién creado.
//
//    node --env-file=.env.prueba scripts/check-esquema-prueba.mjs
//
//  Sale con código 1 si falta alguna tabla/función (útil en CI o de un vistazo).
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("✗ Faltan NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el .env.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

// Las 32 tablas que deberían existir tras 0001→0035. (mascotas se crea en 0012
// pero se ELIMINA en 0023; gastos y comisiones viven en movimientos_caja/usuarios,
// no en tablas propias.)
const TABLAS = [
  "usuarios", "clientes", "prestamos", "pagos", "visitas", "asignaciones",
  "anuncios", "reportes", "movimientos_caja", "rendiciones",
  "auditoria", "config_mora", "bitacora", "config_operacion",
  "push_suscripciones", "mora_notas", "config_scoring", "solicitudes_renovacion",
  "zonas", "supervisor_zonas", "solicitudes_anulacion", "mensajes", "chat_lecturas",
  "notas_cliente", "notas_personales", "estrellas_redenciones", "recompensas",
  "ajustes_juego", "quinielas", "quiniela_participaciones", "raspaditas_jugadas",
  "raspadita_premios",
];

// Funciones RLS/helpers clave (deben existir y ejecutar sin romper).
const FUNCIONES = [
  "app_rol", "app_usuario_id", "app_es_gestor", "app_es_admin",
  "app_supervisor_sin_zonas", "app_mi_zona",
];

let faltan = 0;

console.log(`\nProyecto: ${url}\n── TABLAS (${TABLAS.length}) ──`);
for (const t of TABLAS) {
  const { count, error } = await db.from(t).select("*", { count: "exact", head: true });
  if (error) {
    // 42P01 = tabla inexistente; otros códigos = existe pero otra cosa (RLS, etc.).
    if (error.code === "42P01") { console.log(`  ✗ ${t.padEnd(28)} FALTA`); faltan++; }
    else console.log(`  • ${t.padEnd(28)} existe (aviso: ${error.code})`);
  } else {
    console.log(`  ✓ ${t.padEnd(28)} ${count} filas`);
  }
}

console.log(`\n── FUNCIONES (${FUNCIONES.length}) ──`);
for (const fn of FUNCIONES) {
  const { error } = await db.rpc(fn);
  // Una función sin argumentos que existe: devuelve dato o error de contexto
  // (ej. app_rol sin sesión → null/no-context), pero NO "función inexistente".
  const noExiste = error && (error.code === "42883" || /does not exist/i.test(error.message || ""));
  if (noExiste) { console.log(`  ✗ ${fn}()`.padEnd(32) + " FALTA"); faltan++; }
  else console.log(`  ✓ ${fn}()`.padEnd(32) + " existe");
}

console.log(
  faltan === 0
    ? `\n✅ Esquema COMPLETO: ${TABLAS.length} tablas + ${FUNCIONES.length} funciones presentes.\n`
    : `\n⚠️  Faltan ${faltan} objetos. ¿Corriste todas las migraciones (db push / esquema completo)?\n`,
);
process.exit(faltan === 0 ? 0 : 1);
