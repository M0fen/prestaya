// ─────────────────────────────────────────────────────────────────────────
//  CONCURRENCIA REAL (dos conexiones, commits de verdad) — lo que ningún fake JS
//  puede probar. Ejercita los advisory-locks / row-locks de los RPC de dinero
//  contra un Postgres real bajo READ COMMITTED. Cada test arma fixtures con
//  autocommit y limpia con TRUNCATE en afterEach (estos SÍ commitean).
//
//  Patrón: A toma el lock y NO commitea; B corre la misma operación y DEBE
//  bloquearse; se verifica que B sigue esperando; A commitea; B re-evalúa con el
//  estado FRESCO y rechaza (P0409 sobre-pago / P0410 doble-renovación / P0409
//  sobreventa). Es el TOCTOU que motivó los RPC 0079/0087/0106.
// ─────────────────────────────────────────────────────────────────────────
import { afterEach, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool, sleep, n } from "./db";

afterEach(async () => {
  const c = await getPool().connect();
  try {
    await c.query(
      "truncate table pagos, prestamos, solicitudes_producto, asignaciones, clientes, productos, usuarios restart identity cascade",
    );
  } finally {
    c.release();
  }
});

/** ¿La promesa sigue pendiente? (no se resolvió ni rechazó todavía) */
function pendiente(p: Promise<unknown>): Promise<boolean> {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true),
  );
  return sleep(300).then(() => !settled);
}

describe("concurrencia de dinero (integración PG, 2 conexiones)", () => {
  it("sobre-pago: el 2º cobro concurrente al mismo crédito se rechaza (P0409)", async () => {
    const s = await getPool().connect();
    let prestamoId = "";
    let cobId = "";
    try {
      const auth = (await s.query("insert into auth.users (email) values ('a@t.test') returning id")).rows[0].id;
      cobId = (
        await s.query(
          "insert into usuarios (nombre,rol,activo,auth_user_id) values ('cob','cobrador',true,$1) returning id",
          [auth],
        )
      ).rows[0].id;
      const cli = (await s.query("insert into clientes (nombre) values ('c') returning id")).rows[0].id;
      prestamoId = (
        await s.query(
          "insert into prestamos (cliente_id,cobrador_id,monto_prestado,cuota_diaria,total_dias,fecha_inicio,estado) values ($1,$2,1000,1000,1,'2026-01-01','activo') returning id",
          [cli, cobId],
        )
      ).rows[0].id;
    } finally {
      s.release();
    }

    const A = await getPool().connect();
    const B = await getPool().connect();
    try {
      await A.query("begin");
      await B.query("begin");
      // A toma el advisory lock del crédito y NO commitea (lock retenido).
      // Montos DISTINTOS (600 y 500): lo que se prueba acá es el SOBRE-PAGO
      // fresco bajo el lock; el mismo-monto concurrente es el gemelo (test
      // siguiente, P0413 desde 0147).
      await A.query("select registrar_pago_seguro($1,1,600,$2,null,null,null,$3)", [prestamoId, cobId, randomUUID()]);
      // B intenta cobrar el MISMO crédito → debe bloquearse en el lock.
      const bProm = B.query("select registrar_pago_seguro($1,1,500,$2,null,null,null,$3)", [
        prestamoId,
        cobId,
        randomUUID(),
      ]);
      bProm.catch(() => {}); // evita unhandledRejection mientras espera
      expect(await pendiente(bProm)).toBe(true); // sigue esperando el lock
      await A.query("commit"); // libera: acum=600 queda visible
      await expect(bProm).rejects.toMatchObject({ code: "P0409" }); // 600+500 > 1.001 → rechaza fresco
      await B.query("rollback");
    } finally {
      await A.query("rollback").catch(() => {});
      await B.query("rollback").catch(() => {});
      A.release();
      B.release();
    }

    const chk = await getPool().connect();
    try {
      const r = await chk.query("select coalesce(sum(monto),0) s from pagos where prestamo_id=$1 and anulado=false", [
        prestamoId,
      ]);
      expect(n(r.rows[0].s)).toBe(600); // un solo cobro entró
    } finally {
      chk.release();
    }
  });

  it("doble tap desde DOS dispositivos: el 2º cobro del MISMO monto muere ADENTRO del lock (P0413, 0147)", async () => {
    // LA carrera que el candado de la Server Action no puede ver: dos SELECT
    // simultáneos no se ven entre sí. Adentro del advisory lock, el segundo
    // SIEMPRE ve al primero — el mismo peso ya no entra dos veces.
    const s = await getPool().connect();
    let prestamoId = "";
    let cobId = "";
    try {
      const auth = (await s.query("insert into auth.users (email) values ('g@t.test') returning id")).rows[0].id;
      cobId = (
        await s.query(
          "insert into usuarios (nombre,rol,activo,auth_user_id) values ('cob-g','cobrador',true,$1) returning id",
          [auth],
        )
      ).rows[0].id;
      const cli = (await s.query("insert into clientes (nombre) values ('c-g') returning id")).rows[0].id;
      prestamoId = (
        await s.query(
          "insert into prestamos (cliente_id,cobrador_id,monto_prestado,cuota_diaria,total_dias,fecha_inicio,estado) values ($1,$2,10000,500,20,'2026-01-01','activo') returning id",
          [cli, cobId],
        )
      ).rows[0].id;
    } finally {
      s.release();
    }

    const A = await getPool().connect();
    const B = await getPool().connect();
    try {
      await A.query("begin");
      await B.query("begin");
      // Con saldo AMPLIO (10.000): el P0409 jamás frenaría esto — solo el gemelo.
      await A.query("select registrar_pago_seguro($1,1,500,$2,null,null,null,$3)", [prestamoId, cobId, randomUUID()]);
      const bProm = B.query("select registrar_pago_seguro($1,1,500,$2,null,null,null,$3)", [
        prestamoId,
        cobId,
        randomUUID(), // op_id DISTINTO: dos toques, no un reintento
      ]);
      bProm.catch(() => {});
      expect(await pendiente(bProm)).toBe(true); // bloqueado en el lock
      await A.query("commit");
      await expect(bProm).rejects.toMatchObject({ code: "P0413" }); // gemelo, no plata doble
      await B.query("rollback");
    } finally {
      await A.query("rollback").catch(() => {});
      await B.query("rollback").catch(() => {});
      A.release();
      B.release();
    }

    const chk = await getPool().connect();
    try {
      const r = await chk.query("select coalesce(sum(monto),0) s from pagos where prestamo_id=$1 and anulado=false", [
        prestamoId,
      ]);
      expect(n(r.rows[0].s)).toBe(500); // UN cobro — la carrera ya no duplica
    } finally {
      chk.release();
    }
  });

  it("doble-renovación: la 2ª renovación concurrente del mismo crédito rebota (P0410)", async () => {
    const s = await getPool().connect();
    let prevId = "";
    let cliId = "";
    let gestorId = "";
    try {
      const authC = (await s.query("insert into auth.users (email) values ('rc@t.test') returning id")).rows[0].id;
      const cobId = (
        await s.query(
          "insert into usuarios (nombre,rol,activo,auth_user_id) values ('cob','cobrador',true,$1) returning id",
          [authC],
        )
      ).rows[0].id;
      const authG = (await s.query("insert into auth.users (email) values ('rg@t.test') returning id")).rows[0].id;
      gestorId = (
        await s.query(
          "insert into usuarios (nombre,rol,activo,auth_user_id) values ('adm','admin',true,$1) returning id",
          [authG],
        )
      ).rows[0].id;
      cliId = (await s.query("insert into clientes (nombre) values ('c') returning id")).rows[0].id;
      prevId = (
        await s.query(
          "insert into prestamos (cliente_id,cobrador_id,monto_prestado,cuota_diaria,total_dias,fecha_inicio,estado) values ($1,$2,10000,500,20,'2026-01-01','activo') returning id",
          [cliId, cobId],
        )
      ).rows[0].id;
      // Saldar el anterior: el RPC (0108) solo renueva un crédito sin saldo cobrable.
      await s.query("insert into pagos (prestamo_id, dia_credito, monto) values ($1,1,10000)", [prevId]);
    } finally {
      s.release();
    }

    const SQL = "select * from renovar_credito_seguro($1,$2,$3,$4,$5,$6,$7,$8)";
    const A = await getPool().connect();
    const B = await getPool().connect();
    try {
      await A.query("begin");
      await B.query("begin");
      await A.query(SQL, [prevId, cliId, 12000, 700, 20, "diario", "2026-02-01", gestorId]); // lock + finalize (sin commit)
      const bProm = B.query(SQL, [prevId, cliId, 12000, 700, 20, "diario", "2026-02-01", gestorId]);
      bProm.catch(() => {});
      expect(await pendiente(bProm)).toBe(true);
      await A.query("commit");
      await expect(bProm).rejects.toMatchObject({ code: "P0410" }); // el anterior ya no está activo
      await B.query("rollback");
    } finally {
      await A.query("rollback").catch(() => {});
      await B.query("rollback").catch(() => {});
      A.release();
      B.release();
    }

    const chk = await getPool().connect();
    try {
      const r = await chk.query("select count(*)::int n from prestamos where cliente_id=$1 and estado='activo'", [cliId]);
      expect(r.rows[0].n).toBe(1); // exactamente un crédito activo (no dos, no cero)
    } finally {
      chk.release();
    }
  });

  it("sobreventa: dos leads del mismo producto (stock=1) → la 2ª venta rechaza (P0409)", async () => {
    const s = await getPool().connect();
    let prod = "";
    let cliA = "";
    let cliB = "";
    let solA = "";
    let solB = "";
    let gestor = "";
    let adminAuth = "";
    try {
      adminAuth = (await s.query("insert into auth.users (email) values ('vg@t.test') returning id")).rows[0].id;
      gestor = (
        await s.query("insert into usuarios (nombre,rol,activo,auth_user_id) values ('adm','admin',true,$1) returning id", [
          adminAuth,
        ])
      ).rows[0].id;
      cliA = (await s.query("insert into clientes (nombre) values ('a') returning id")).rows[0].id;
      cliB = (await s.query("insert into clientes (nombre) values ('b') returning id")).rows[0].id;
      prod = (await s.query("insert into productos (nombre,precio,stock) values ('Único',20000,1) returning id")).rows[0].id;
      solA = (
        await s.query(
          "insert into solicitudes_producto (producto_id,cliente_id,producto_nombre,estado) values ($1,$2,'Único','nueva') returning id",
          [prod, cliA],
        )
      ).rows[0].id;
      solB = (
        await s.query(
          "insert into solicitudes_producto (producto_id,cliente_id,producto_nombre,estado) values ($1,$2,'Único','nueva') returning id",
          [prod, cliB],
        )
      ).rows[0].id;
    } finally {
      s.release();
    }

    const SQL = "select * from crear_credito_venta_seguro($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)";
    const A = await getPool().connect();
    const B = await getPool().connect();
    try {
      await A.query("begin");
      await B.query("begin");
      // Identidad admin en ambas conexiones: el RPC de venta exige app_es_admin() (0108).
      await A.query("select set_config('request.jwt.claim.sub', $1, true)", [adminAuth]);
      await B.query("select set_config('request.jwt.claim.sub', $1, true)", [adminAuth]);
      // A convierte leadA: descuenta stock (row-lock del producto), sin commit.
      // Params: (solicitud, cliente, cobrador=null, monto, cuota, dias, frec, fecha, producto, nombre, op, creado_por)
      await A.query(SQL, [solA, cliA, null, 20000, 1000, 20, "diario", "2026-02-01", prod, "Único", randomUUID(), gestor]);
      // B convierte leadB (lock del lead distinto → NO se serializa ahí; se bloquea en el row-lock del producto).
      const bProm = B.query(SQL, [solB, cliB, null, 20000, 1000, 20, "diario", "2026-02-01", prod, "Único", randomUUID(), gestor]);
      bProm.catch(() => {});
      expect(await pendiente(bProm)).toBe(true); // espera el row-lock del producto
      await A.query("commit"); // stock=0 committeado
      await expect(bProm).rejects.toMatchObject({ code: "P0409" }); // sin stock
      await B.query("rollback");
    } finally {
      await A.query("rollback").catch(() => {});
      await B.query("rollback").catch(() => {});
      A.release();
      B.release();
    }

    const chk = await getPool().connect();
    try {
      const st = await chk.query("select stock from productos where id=$1", [prod]);
      expect(n(st.rows[0].stock)).toBe(0); // nunca negativo
      const cnt = await chk.query("select count(*)::int n from prestamos where origen='tienda'");
      expect(cnt.rows[0].n).toBe(1); // un solo crédito de venta
    } finally {
      chk.release();
    }
  });
});
