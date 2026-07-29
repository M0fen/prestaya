// Integración REAL de registrar_pago_seguro (0079) contra Postgres: ejercita el
// SQL de producción, no un fake JS. Cubre: alta + trigger pagado_acum (0063),
// redondeo money, anti sobre-pago atómico (P0409) con tolerancia de 1 peso,
// idempotencia por op_id (23505), préstamo inexistente (P0002) y anulación.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { withRollback, mkCobradorConAuth, mkCliente, mkPrestamo, mkAsignacion, totalPagado, esperaErrorPg, n } from "./db";

// select * from registrar_pago_seguro(prestamo, dia, monto, registrador, lat, lng, registrado_en, op_id)
const SQL = `select * from registrar_pago_seguro($1,$2,$3,$4,$5,$6,$7,$8)`;

async function escenario(c: import("pg").PoolClient, cuota: number, dias: number) {
  const cob = await mkCobradorConAuth(c);
  const cli = await mkCliente(c);
  await mkAsignacion(c, cob.id, cli);
  const prestamoId = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: cuota, totalDias: dias });
  return { cob, cli, prestamoId };
}

describe("registrar_pago_seguro (integración PG)", () => {
  it("inserta el pago y el trigger mantiene pagado_acum = Σ pagos", async () => {
    await withRollback(async (c) => {
      const { cob, prestamoId } = await escenario(c, 1000, 20); // total 20.000
      const r = await c.query(SQL, [prestamoId, 1, 1000, cob.id, null, null, null, randomUUID()]);
      expect(n(r.rows[0].monto)).toBe(1000);

      const p = await c.query("select pagado_acum from prestamos where id=$1", [prestamoId]);
      expect(n(p.rows[0].pagado_acum)).toBe(1000);
      expect(await totalPagado(c, prestamoId)).toBe(1000);
    });
  });

  it("redondea el monto a entero (nunca float al libro)", async () => {
    await withRollback(async (c) => {
      const { cob, prestamoId } = await escenario(c, 1000, 20);
      const a = await c.query(SQL, [prestamoId, 1, 100.4, cob.id, null, null, null, randomUUID()]);
      const b = await c.query(SQL, [prestamoId, 2, 100.6, cob.id, null, null, null, randomUUID()]);
      expect(n(a.rows[0].monto)).toBe(100); // round(100.4)
      expect(n(b.rows[0].monto)).toBe(101); // round(100.6)
      expect(await totalPagado(c, prestamoId)).toBe(201);
    });
  });

  it("RECHAZA el sobre-pago de forma atómica (P0409) sin alterar el libro", async () => {
    await withRollback(async (c) => {
      const { cob, prestamoId } = await escenario(c, 1000, 1); // total 1.000
      await c.query(SQL, [prestamoId, 1, 1000, cob.id, null, null, null, randomUUID()]); // salda
      await esperaErrorPg(c, "P0409", () =>
        c.query(SQL, [prestamoId, 1, 1000, cob.id, null, null, null, randomUUID()]),
      );
      // El libro quedó intacto: sigue en 1.000, no en 2.000.
      expect(await totalPagado(c, prestamoId)).toBe(1000);
    });
  });

  it("tolera 1 peso por encima del total (cuota fraccionaria) pero no 2", async () => {
    await withRollback(async (c) => {
      const { cob, prestamoId } = await escenario(c, 1000, 1); // total 1.000
      // total + 1 = 1.001 permitido (redondeo legítimo de cuota fraccionaria).
      const ok = await c.query(SQL, [prestamoId, 1, 1001, cob.id, null, null, null, randomUUID()]);
      expect(n(ok.rows[0].monto)).toBe(1001);
      // Un peso más (1.002 acumulado) ya excede la tolerancia → rechazo.
      await esperaErrorPg(c, "P0409", () =>
        c.query(SQL, [prestamoId, 1, 1, cob.id, null, null, null, randomUUID()]),
      );
    });
  });

  it("es idempotente por op_id: el mismo op_id no crea dos pagos (23505)", async () => {
    await withRollback(async (c) => {
      const { cob, prestamoId } = await escenario(c, 1000, 20);
      const op = randomUUID();
      await c.query(SQL, [prestamoId, 1, 500, cob.id, null, null, null, op]);
      await esperaErrorPg(c, "23505", () =>
        c.query(SQL, [prestamoId, 2, 500, cob.id, null, null, null, op]),
      );
      expect(await totalPagado(c, prestamoId)).toBe(500); // solo el primero
    });
  });

  it("préstamo inexistente → P0002", async () => {
    await withRollback(async (c) => {
      const { cob } = await escenario(c, 1000, 20);
      await esperaErrorPg(c, "P0002", () =>
        c.query(SQL, [randomUUID(), 1, 500, cob.id, null, null, null, randomUUID()]),
      );
    });
  });

  it("anular un pago baja pagado_acum (consistencia con el libro)", async () => {
    await withRollback(async (c) => {
      const gestor = await mkCobradorConAuth(c);
      const { cob, prestamoId } = await escenario(c, 1000, 20);
      const r = await c.query(SQL, [prestamoId, 1, 1000, cob.id, null, null, null, randomUUID()]);
      const pagoId = r.rows[0].id;
      await c.query(
        `update pagos set anulado=true, anulado_por=$2, anulado_en=now(), motivo_anulacion='test'
         where id=$1`,
        [pagoId, gestor.id],
      );
      const p = await c.query("select pagado_acum from prestamos where id=$1", [prestamoId]);
      expect(n(p.rows[0].pagado_acum)).toBe(0);
      expect(await totalPagado(c, prestamoId)).toBe(0);
    });
  });
});
