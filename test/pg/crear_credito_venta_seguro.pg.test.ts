// Integración REAL de crear_credito_venta_seguro (0101 + fix 0106): convierte un
// LEAD de tienda en un crédito de VENTA (origen='tienda') de forma atómica.
// Cubre: alta + traza lead→crédito + descuento de stock, idempotencia por lead
// (no duplica deuda), CAP $100k (P0403), gate de stock/sobreventa (P0409), cruce
// de cliente (P0001), lead cerrado (P0410), inexistente (P0002) y op_id único.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  withRollback,
  mkGestorConAuth,
  mkCobradorConAuth,
  mkCliente,
  mkProducto,
  mkSolicitud,
  esperaErrorPg,
  setIdentidad,
  n,
} from "./db";

const SQL = `select * from crear_credito_venta_seguro($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`;

// Builder de los 12 parámetros del RPC (evita descuadres de posición).
function args(o: {
  solicitud: string;
  cliente: string;
  cobrador?: string | null;
  monto?: number;
  cuota?: number;
  dias?: number;
  producto?: string | null;
  nombre?: string;
  op?: string;
  creadoPor: string;
}): unknown[] {
  return [
    o.solicitud,
    o.cliente,
    o.cobrador ?? null,
    o.monto ?? 20000,
    o.cuota ?? 1000,
    o.dias ?? 20,
    "diario",
    "2026-02-01",
    o.producto ?? null,
    o.nombre ?? "Producto",
    o.op ?? randomUUID(),
    o.creadoPor,
  ];
}

describe("crear_credito_venta_seguro (integración PG)", () => {
  it("convierte el lead en crédito 'tienda', traza y descuenta stock", async () => {
    await withRollback(async (c) => {
      const gestor = await mkGestorConAuth(c, "admin");
      await setIdentidad(c, gestor.authUserId); // el RPC exige app_es_admin() (0108)
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      const prod = await mkProducto(c, { nombre: "Heladera", precio: 20000, stock: 3 });
      const sol = await mkSolicitud(c, { clienteId: cli, productoId: prod, productoNombre: "Heladera" });

      const r = await c.query(
        SQL,
        args({ solicitud: sol, cliente: cli, cobrador: cob.id, producto: prod, nombre: "Heladera", creadoPor: gestor.id }),
      );
      const nuevo = r.rows[0];
      expect(nuevo.origen).toBe("tienda");
      expect(nuevo.producto_id).toBe(prod);
      expect(nuevo.producto_nombre).toBe("Heladera");
      expect(nuevo.cobrador_id).toBe(cob.id);
      expect(nuevo.estado).toBe("activo");

      const s = await c.query("select estado, prestamo_id from solicitudes_producto where id=$1", [sol]);
      expect(s.rows[0].estado).toBe("convertida");
      expect(s.rows[0].prestamo_id).toBe(nuevo.id);

      const p = await c.query("select stock from productos where id=$1", [prod]);
      expect(n(p.rows[0].stock)).toBe(2); // 3 → 2
    });
  });

  it("es idempotente por lead: convertir dos veces NO duplica la deuda", async () => {
    await withRollback(async (c) => {
      const gestor = await mkGestorConAuth(c, "admin");
      await setIdentidad(c, gestor.authUserId); // el RPC exige app_es_admin() (0108)
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      const prod = await mkProducto(c, { precio: 20000, stock: 3 });
      const sol = await mkSolicitud(c, { clienteId: cli, productoId: prod, productoNombre: "X" });
      const op = randomUUID();

      const r1 = await c.query(SQL, args({ solicitud: sol, cliente: cli, cobrador: cob.id, producto: prod, op, creadoPor: gestor.id }));
      const r2 = await c.query(SQL, args({ solicitud: sol, cliente: cli, cobrador: cob.id, producto: prod, op, creadoPor: gestor.id }));
      expect(r2.rows[0].id).toBe(r1.rows[0].id); // MISMO crédito

      const cnt = await c.query("select count(*)::int as n from prestamos where cliente_id=$1", [cli]);
      expect(cnt.rows[0].n).toBe(1); // un solo crédito
      const p = await c.query("select stock from productos where id=$1", [prod]);
      expect(n(p.rows[0].stock)).toBe(2); // stock descontado UNA sola vez
    });
  });

  it("respeta el tope de $100.000 (P0403)", async () => {
    await withRollback(async (c) => {
      const gestor = await mkGestorConAuth(c, "admin");
      await setIdentidad(c, gestor.authUserId); // el RPC exige app_es_admin() (0108)
      const cli = await mkCliente(c);
      const sol = await mkSolicitud(c, { clienteId: cli, productoNombre: "Caro" });
      await esperaErrorPg(c, "P0403", () =>
        c.query(SQL, args({ solicitud: sol, cliente: cli, monto: 100001, dias: 120, nombre: "Caro", creadoPor: gestor.id })),
      );
    });
  });

  it("no sobrevende: con stock=1, la 2ª venta del producto falla (P0409)", async () => {
    await withRollback(async (c) => {
      const gestor = await mkGestorConAuth(c, "admin");
      await setIdentidad(c, gestor.authUserId); // el RPC exige app_es_admin() (0108)
      const cliA = await mkCliente(c);
      const cliB = await mkCliente(c);
      const prod = await mkProducto(c, { precio: 20000, stock: 1 });
      const solA = await mkSolicitud(c, { clienteId: cliA, productoId: prod, productoNombre: "Único" });
      const solB = await mkSolicitud(c, { clienteId: cliB, productoId: prod, productoNombre: "Único" });

      await c.query(SQL, args({ solicitud: solA, cliente: cliA, producto: prod, nombre: "Único", creadoPor: gestor.id }));
      await esperaErrorPg(c, "P0409", () =>
        c.query(SQL, args({ solicitud: solB, cliente: cliB, producto: prod, nombre: "Único", creadoPor: gestor.id })),
      );
      const p = await c.query("select stock from productos where id=$1", [prod]);
      expect(n(p.rows[0].stock)).toBe(0); // nunca negativo
    });
  });

  it("nunca cruza plata entre clientes (P0001)", async () => {
    await withRollback(async (c) => {
      const gestor = await mkGestorConAuth(c, "admin");
      await setIdentidad(c, gestor.authUserId); // el RPC exige app_es_admin() (0108)
      const cli = await mkCliente(c);
      const otro = await mkCliente(c);
      const sol = await mkSolicitud(c, { clienteId: cli, productoNombre: "X" });
      await esperaErrorPg(c, "P0001", () =>
        c.query(SQL, args({ solicitud: sol, cliente: otro, creadoPor: gestor.id })),
      );
    });
  });

  it("no convierte un lead cerrado (P0410)", async () => {
    await withRollback(async (c) => {
      const gestor = await mkGestorConAuth(c, "admin");
      await setIdentidad(c, gestor.authUserId); // el RPC exige app_es_admin() (0108)
      const cli = await mkCliente(c);
      const sol = await mkSolicitud(c, { clienteId: cli, productoNombre: "X", estado: "cerrada" });
      await esperaErrorPg(c, "P0410", () =>
        c.query(SQL, args({ solicitud: sol, cliente: cli, creadoPor: gestor.id })),
      );
    });
  });

  it("lead inexistente → P0002", async () => {
    await withRollback(async (c) => {
      const gestor = await mkGestorConAuth(c, "admin");
      await setIdentidad(c, gestor.authUserId); // el RPC exige app_es_admin() (0108)
      const cli = await mkCliente(c);
      await esperaErrorPg(c, "P0002", () =>
        c.query(SQL, args({ solicitud: randomUUID(), cliente: cli, creadoPor: gestor.id })),
      );
    });
  });

  it("op_id único: dos leads con el mismo op_id → 23505 (anti doble-crédito)", async () => {
    await withRollback(async (c) => {
      const gestor = await mkGestorConAuth(c, "admin");
      await setIdentidad(c, gestor.authUserId); // el RPC exige app_es_admin() (0108)
      const cli = await mkCliente(c);
      const solA = await mkSolicitud(c, { clienteId: cli, productoNombre: "A" });
      const solB = await mkSolicitud(c, { clienteId: cli, productoNombre: "B" });
      const op = randomUUID();
      await c.query(SQL, args({ solicitud: solA, cliente: cli, nombre: "A", op, creadoPor: gestor.id }));
      await esperaErrorPg(c, "23505", () =>
        c.query(SQL, args({ solicitud: solB, cliente: cli, nombre: "B", op, creadoPor: gestor.id })),
      );
    });
  });

  it("un NO-admin NO puede colocar una venta por API directa (P0401, hardening 0108)", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      await setIdentidad(c, cob.authUserId); // identidad de cobrador, no admin
      const cli = await mkCliente(c);
      const sol = await mkSolicitud(c, { clienteId: cli, productoNombre: "X" });
      await esperaErrorPg(c, "P0401", () =>
        c.query(SQL, args({ solicitud: sol, cliente: cli, creadoPor: cob.id })),
      );
    });
  });
});
