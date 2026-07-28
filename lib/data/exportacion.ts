// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RESPALDO total (admin/supervisor).
//  Exporta tablas COMPLETAS paginando (PostgREST corta en ~1000 filas): el
//  padrón de clientes y el LIBRO DE PAGOS entero (verdad inmutable). Corre como
//  gestor (RLS). Solo lectura.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

/** Pagina una tabla en bloques de 1000, EMITIENDO cada página (sin acumular).
 *  Base tanto de traerTodo (junta todo) como del export por streaming (procesa y
 *  descarta página a página → memoria acotada aunque la tabla crezca sin techo). */
async function* paginar(
  db: SupabaseClient,
  tabla: string,
  columnas: string,
  orden?: { col: string; asc?: boolean },
): AsyncGenerator<Row[]> {
  const TAM = 1000;
  for (let desde = 0; ; desde += TAM) {
    let q = db.from(tabla).select(columnas);
    if (orden) q = q.order(orden.col, { ascending: orden.asc ?? true });
    // Desempate por PK: garantiza un orden TOTAL estable entre páginas (si se
    // ordena por una columna no única, los empates podrían repetir/saltear filas).
    q = q.order("id", { ascending: true });
    const { data, error } = await q.range(desde, desde + TAM - 1);
    if (error) throw error;
    const filas = (data ?? []) as unknown as Row[];
    if (filas.length) yield filas;
    if (filas.length < TAM) break;
  }
}

/** Trae TODAS las filas de una tabla, en páginas de 1000. Para tablas ACOTADAS
 *  (clientes, préstamos, usuarios): el libro de pagos usa el streaming de abajo. */
async function traerTodo(
  db: SupabaseClient,
  tabla: string,
  columnas: string,
  orden?: { col: string; asc?: boolean },
): Promise<Row[]> {
  const out: Row[] = [];
  for await (const pagina of paginar(db, tabla, columnas, orden)) out.push(...pagina);
  return out;
}

export interface FilaClienteExport {
  nombre: string;
  documento: string;
  telefono: string;
  direccion: string;
  calificacion: string;
  estado: string;
  origen: string;
  alta: string;
}

/** Padrón completo de clientes. */
export async function getClientesExport(db: SupabaseClient): Promise<FilaClienteExport[]> {
  const rows = await traerTodo(
    db,
    "clientes",
    "nombre, documento, telefono, direccion, calificacion, activo, origen, creado_en",
    { col: "nombre" },
  );
  return rows.map((r) => ({
    nombre: (r.nombre as string) ?? "",
    documento: (r.documento as string | null) ?? "",
    telefono: (r.telefono as string | null) ?? "",
    direccion: (r.direccion as string | null) ?? "",
    calificacion: (r.calificacion as string | null) ?? "",
    estado: r.activo ? "activo" : "inactivo",
    origen: (r.origen as string | null) ?? "",
    alta: typeof r.creado_en === "string" ? r.creado_en.slice(0, 10) : "",
  }));
}

export interface FilaPagoExport {
  fechaIso: string;
  cliente: string;
  documento: string;
  dia: number;
  monto: number;
  anulado: boolean;
  cobrador: string;
}

/**
 * Libro de pagos COMPLETO (incluye anulados, marcados), del más reciente, EN
 * PÁGINAS. El historial de pagos crece todos los días para siempre; cargarlo
 * entero a memoria (más el CSV entero como string) revienta la función a escala.
 * Este generador carga UNA vez los lookups ACOTADOS (clientes/créditos/usuarios)
 * y luego pagina el libro emitiendo página a página → memoria acotada. El endpoint
 * hace stream de cada página al archivo sin materializar todo el CSV.
 */
export async function* streamPagosExport(
  db: SupabaseClient,
): AsyncGenerator<FilaPagoExport[]> {
  // Lookups acotados (crecen con clientes/créditos, no con el historial de pagos).
  const [prestamos, clientes, usuarios] = await Promise.all([
    traerTodo(db, "prestamos", "id, cliente_id"),
    traerTodo(db, "clientes", "id, nombre, documento"),
    traerTodo(db, "usuarios", "id, nombre"),
  ]);

  const clienteDe = new Map<string, { nombre: string; documento: string }>();
  for (const c of clientes)
    clienteDe.set(c.id as string, {
      nombre: (c.nombre as string) ?? "",
      documento: (c.documento as string | null) ?? "",
    });
  const clienteDePrestamo = new Map<string, string>();
  for (const p of prestamos) clienteDePrestamo.set(p.id as string, p.cliente_id as string);
  const nombreUsuario = new Map<string, string>();
  for (const u of usuarios) nombreUsuario.set(u.id as string, (u.nombre as string) ?? "");

  const mapear = (p: Row): FilaPagoExport => {
    const cliId = clienteDePrestamo.get(p.prestamo_id as string);
    const cli = cliId ? clienteDe.get(cliId) : undefined;
    return {
      fechaIso: p.registrado_en as string,
      cliente: cli?.nombre ?? "",
      documento: cli?.documento ?? "",
      dia: Number(p.dia_credito),
      // El libro es ENTERO: se redondea al exportar igual que al registrar.
      monto: Math.round(Number(p.monto)),
      anulado: Boolean(p.anulado),
      cobrador: p.registrado_por ? (nombreUsuario.get(p.registrado_por as string) ?? "") : "",
    };
  };

  for await (const pagina of paginar(
    db,
    "pagos",
    "prestamo_id, dia_credito, monto, anulado, registrado_por, registrado_en",
    { col: "registrado_en", asc: false },
  )) {
    yield pagina.map(mapear);
  }
}

/** Libro de pagos COMPLETO como arreglo (junta el streaming). Se conserva por
 *  compatibilidad; el endpoint usa el generador directo para no materializarlo. */
export async function getPagosExport(db: SupabaseClient): Promise<FilaPagoExport[]> {
  const out: FilaPagoExport[] = [];
  for await (const pagina of streamPagosExport(db)) out.push(...pagina);
  return out;
}
