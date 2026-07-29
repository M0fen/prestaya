// ─────────────────────────────────────────────────────────────────────────
//  Harness de tests de integración contra Postgres REAL.
//  · Un único Pool a la base migrada (PG_TEST_URL, la publica globalSetup).
//  · `withRollback`: cada test corre dentro de una transacción que se REVIERTE
//    al terminar → aislamiento total sin limpieza manual. Los advisory-locks de
//    los RPC son de transacción (pg_advisory_xact_lock) → conviven perfecto.
//  · `comoRol`: ejecuta un bloque bajo un rol de Supabase (authenticated /
//    service_role) fijando la identidad (auth.uid()), para ejercitar RLS.
//  · Fábricas mínimas (mkUsuario/mkCliente/mkPrestamo…) para armar escenarios.
//
//  Nota node-pg: las columnas `numeric` vuelven como STRING (no pierde precisión).
//  Usá `n()` para comparar como número en dinero de test.
// ─────────────────────────────────────────────────────────────────────────
import pg from "pg";

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    const url = process.env.PG_TEST_URL;
    if (!url) throw new Error("PG_TEST_URL no está definida (¿corrió globalSetup?).");
    _pool = new pg.Pool({ connectionString: url, max: 6 });
  }
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/** numeric de Postgres (string) → número, para comparar dinero en tests. */
export function n(v: unknown): number {
  return typeof v === "string" ? Number(v) : (v as number);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Corre `fn` dentro de una transacción que SIEMPRE se revierte. Aísla cada test
 * sin tocar el estado compartido de la base.
 */
export async function withRollback<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query("begin");
    return await fn(c);
  } finally {
    try {
      await c.query("rollback");
    } finally {
      c.release();
    }
  }
}

/**
 * Espera que `fn` lance un error de Postgres con SQLSTATE `code`, SIN abortar la
 * transacción externa. Envuelve la operación en un SAVEPOINT: al fallar, revierte
 * solo hasta el savepoint (Postgres deja "abortada" toda la transacción tras un
 * error, así que sin esto las aserciones posteriores del test también fallarían).
 */
export async function esperaErrorPg(
  c: pg.PoolClient,
  code: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  await c.query("savepoint sp_err");
  let err: (Error & { code?: string }) | undefined;
  try {
    await fn();
  } catch (e) {
    err = e as Error & { code?: string };
  }
  if (!err) {
    await c.query("release savepoint sp_err");
    throw new Error(`se esperaba un error ${code} pero no hubo ninguno`);
  }
  await c.query("rollback to savepoint sp_err");
  await c.query("release savepoint sp_err");
  if (err.code !== code) {
    throw new Error(`SQLSTATE ${err.code ?? "(ninguno)"} ≠ ${code}: ${err.message}`);
  }
}

/**
 * Fija la identidad de sesión (auth.uid()) para la transacción actual, sin cambiar
 * de rol (seguimos como superusuario). Sirve para que los helpers `app_*()` /
 * `app_es_admin()` que leen auth.uid() se comporten como el usuario dado — p.ej.
 * para pasar el gate admin de un RPC. `null` limpia la identidad.
 */
export async function setIdentidad(c: pg.PoolClient, authUserId: string | null): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [authUserId ?? ""]);
}

const ROLES = new Set(["authenticated", "service_role", "anon"]);

/**
 * Ejecuta `fn` como un rol de Supabase con una identidad dada (auth.uid()).
 * Solo envuelve la llamada bajo prueba; las fixtures/aserciones de afuera
 * corren como superusuario (postgres, que saltea RLS). Requiere estar dentro
 * de withRollback (usa SET LOCAL).
 */
export async function comoRol<T>(
  c: pg.PoolClient,
  role: "authenticated" | "service_role" | "anon",
  authUserId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  if (!ROLES.has(role)) throw new Error(`rol no permitido: ${role}`);
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [authUserId ?? ""]);
  await c.query(`set local role ${role}`);
  try {
    return await fn();
  } finally {
    await c.query("reset role");
    await c.query("select set_config('request.jwt.claim.sub', '', true)");
  }
}

// ── Fábricas de fixtures (corren como superusuario dentro del rollback) ──────

export async function mkAuthUser(c: pg.PoolClient, email?: string): Promise<string> {
  const r = await c.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email ?? `u_${Math.random().toString(36).slice(2)}@t.test`],
  );
  return r.rows[0].id;
}

export async function mkUsuario(
  c: pg.PoolClient,
  opts: { rol: "admin" | "supervisor" | "cobrador"; nombre?: string; authUserId?: string | null; activo?: boolean },
): Promise<{ id: string; authUserId: string | null }> {
  const r = await c.query<{ id: string }>(
    `insert into usuarios (nombre, rol, activo, auth_user_id)
     values ($1, $2, $3, $4) returning id`,
    [opts.nombre ?? `${opts.rol}-${Math.random().toString(36).slice(2, 7)}`, opts.rol, opts.activo ?? true, opts.authUserId ?? null],
  );
  return { id: r.rows[0].id, authUserId: opts.authUserId ?? null };
}

/** Crea un cobrador con su auth.users vinculado (lo más común en los tests). */
export async function mkCobradorConAuth(
  c: pg.PoolClient,
  nombre?: string,
): Promise<{ id: string; authUserId: string }> {
  const authUserId = await mkAuthUser(c);
  const u = await mkUsuario(c, { rol: "cobrador", nombre, authUserId });
  return { id: u.id, authUserId };
}

export async function mkGestorConAuth(
  c: pg.PoolClient,
  rol: "admin" | "supervisor" = "admin",
): Promise<{ id: string; authUserId: string }> {
  const authUserId = await mkAuthUser(c);
  const u = await mkUsuario(c, { rol, authUserId });
  return { id: u.id, authUserId };
}

export async function mkCliente(c: pg.PoolClient, nombre?: string): Promise<string> {
  const r = await c.query<{ id: string }>(
    "insert into clientes (nombre) values ($1) returning id",
    [nombre ?? `cliente-${Math.random().toString(36).slice(2, 7)}`],
  );
  return r.rows[0].id;
}

export async function mkPrestamo(
  c: pg.PoolClient,
  opts: {
    clienteId: string;
    cobradorId?: string | null;
    cuotaDiaria: number;
    totalDias: number;
    montoPrestado?: number;
    fechaInicio?: string; // 'YYYY-MM-DD'
    estado?: "activo" | "finalizado" | "cancelado" | "incobrable";
    creadoPor?: string | null;
  },
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into prestamos
       (cliente_id, cobrador_id, monto_prestado, cuota_diaria, total_dias, fecha_inicio, estado, creado_por)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [
      opts.clienteId,
      opts.cobradorId ?? null,
      opts.montoPrestado ?? opts.cuotaDiaria * opts.totalDias,
      opts.cuotaDiaria,
      opts.totalDias,
      opts.fechaInicio ?? "2026-01-01",
      opts.estado ?? "activo",
      opts.creadoPor ?? null,
    ],
  );
  return r.rows[0].id;
}

export async function mkAsignacion(c: pg.PoolClient, cobradorId: string, clienteId: string): Promise<void> {
  await c.query(
    "insert into asignaciones (cobrador_id, cliente_id, activo) values ($1,$2,true)",
    [cobradorId, clienteId],
  );
}

export async function mkProducto(
  c: pg.PoolClient,
  opts: { nombre?: string; precio?: number; stock?: number | null } = {},
): Promise<string> {
  const r = await c.query<{ id: string }>(
    "insert into productos (nombre, precio, stock) values ($1,$2,$3) returning id",
    [opts.nombre ?? `prod-${Math.random().toString(36).slice(2, 7)}`, opts.precio ?? 10000, opts.stock ?? null],
  );
  return r.rows[0].id;
}

export async function mkSolicitud(
  c: pg.PoolClient,
  opts: { clienteId: string; productoId?: string | null; productoNombre?: string; estado?: string },
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into solicitudes_producto (producto_id, cliente_id, producto_nombre, estado)
     values ($1,$2,$3,$4) returning id`,
    [opts.productoId ?? null, opts.clienteId, opts.productoNombre ?? "Producto", opts.estado ?? "nueva"],
  );
  return r.rows[0].id;
}

/** Suma de pagos NO anulados de un préstamo (la verdad del dinero). */
export async function totalPagado(c: pg.PoolClient, prestamoId: string): Promise<number> {
  const r = await c.query<{ s: string | null }>(
    "select coalesce(sum(monto),0) as s from pagos where prestamo_id = $1 and anulado = false",
    [prestamoId],
  );
  return n(r.rows[0].s ?? 0);
}
