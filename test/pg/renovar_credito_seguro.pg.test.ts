// Integración REAL de renovar_credito_seguro (0087): la renovación ATÓMICA
// (finalizar el anterior + insertar el nuevo en una sola transacción). Cubre el
// happy path, la doble-renovación del mismo crédito (P0410, gate del UPDATE), el
// cruce de plata entre clientes (P0001) y el crédito inexistente (P0002).
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { withRollback, mkCobradorConAuth, mkGestorConAuth, mkCliente, mkPrestamo, esperaErrorPg, n } from "./db";

const SQL = `select * from renovar_credito_seguro($1,$2,$3,$4,$5,$6,$7,$8)`;

async function anterior(c: import("pg").PoolClient) {
  const cob = await mkCobradorConAuth(c);
  const gestor = await mkGestorConAuth(c, "admin");
  const cli = await mkCliente(c);
  const prev = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: 500, totalDias: 20 }); // total 10.000
  return { cob, gestor, cli, prev };
}

/** Salda un crédito (un pago = total) para pasar el gate SALDADO del RPC (0108). */
async function saldar(c: import("pg").PoolClient, prestamoId: string, total = 10000) {
  await c.query("insert into pagos (prestamo_id, dia_credito, monto) values ($1,1,$2)", [prestamoId, total]);
}

describe("renovar_credito_seguro (integración PG)", () => {
  it("finaliza el anterior e inserta el nuevo en la MISMA transacción", async () => {
    await withRollback(async (c) => {
      const { cob, gestor, cli, prev } = await anterior(c);
      await saldar(c, prev); // solo se renueva un crédito saldado (0108)
      const r = await c.query(SQL, [prev, cli, 12000, 700, 20, "diario", "2026-02-01", gestor.id]);
      const nuevo = r.rows[0];

      // El nuevo crédito: activo, hereda el cobrador, arranca con pagado_acum 0.
      expect(nuevo.estado).toBe("activo");
      expect(nuevo.cobrador_id).toBe(cob.id);
      expect(n(nuevo.cuota_diaria)).toBe(700);
      expect(n(nuevo.pagado_acum)).toBe(0);
      expect(nuevo.id).not.toBe(prev);

      // El anterior quedó finalizado (una sola transacción: o ambos o ninguno).
      const a = await c.query("select estado, finalizado_en from prestamos where id=$1", [prev]);
      expect(a.rows[0].estado).toBe("finalizado");
      expect(a.rows[0].finalizado_en).not.toBeNull();

      // El cliente tiene exactamente UN crédito activo (no quedó sin crédito ni con dos).
      const activos = await c.query(
        "select count(*)::int as n from prestamos where cliente_id=$1 and estado='activo'",
        [cli],
      );
      expect(activos.rows[0].n).toBe(1);
    });
  });

  it("la doble-renovación del MISMO crédito rebota (P0410)", async () => {
    await withRollback(async (c) => {
      const { gestor, cli, prev } = await anterior(c);
      await saldar(c, prev);
      await c.query(SQL, [prev, cli, 12000, 700, 20, "diario", "2026-02-01", gestor.id]); // 1ª: ok
      await esperaErrorPg(c, "P0410", () =>
        c.query(SQL, [prev, cli, 12000, 700, 20, "diario", "2026-02-01", gestor.id]),
      );
      // Sigue habiendo un solo crédito nuevo (la 2ª no creó otro).
      const activos = await c.query(
        "select count(*)::int as n from prestamos where cliente_id=$1 and estado='activo'",
        [cli],
      );
      expect(activos.rows[0].n).toBe(1);
    });
  });

  it("nunca cruza plata entre clientes (P0001)", async () => {
    await withRollback(async (c) => {
      const { gestor, prev } = await anterior(c);
      const otroCliente = await mkCliente(c);
      await esperaErrorPg(c, "P0001", () =>
        c.query(SQL, [prev, otroCliente, 12000, 700, 20, "diario", "2026-02-01", gestor.id]),
      );
    });
  });

  it("crédito anterior inexistente → P0002", async () => {
    await withRollback(async (c) => {
      const { gestor, cli } = await anterior(c);
      await esperaErrorPg(c, "P0002", () =>
        c.query(SQL, [randomUUID(), cli, 12000, 700, 20, "diario", "2026-02-01", gestor.id]),
      );
    });
  });

  it("NO renueva un crédito que todavía no está saldado (P0412, hardening 0108)", async () => {
    await withRollback(async (c) => {
      const { gestor, cli, prev } = await anterior(c); // sin saldar: falta = total
      await esperaErrorPg(c, "P0412", () =>
        c.query(SQL, [prev, cli, 12000, 700, 20, "diario", "2026-02-01", gestor.id]),
      );
      // El anterior sigue ACTIVO (no hubo write-off silencioso).
      const a = await c.query("select estado from prestamos where id=$1", [prev]);
      expect(a.rows[0].estado).toBe("activo");
    });
  });

  it("respeta el CAP de $100.000 también por API directa (P0411, hardening 0108)", async () => {
    await withRollback(async (c) => {
      const { gestor, cli, prev } = await anterior(c);
      await saldar(c, prev);
      await esperaErrorPg(c, "P0411", () =>
        c.query(SQL, [prev, cli, 100001, 700, 20, "diario", "2026-02-01", gestor.id]),
      );
    });
  });
});
