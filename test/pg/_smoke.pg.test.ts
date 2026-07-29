// Smoke test del harness: valida boot del clúster + carga de las 108 migraciones
// + CRUD básico + que los RPC de dinero existen realmente en la base migrada.
import { describe, it, expect } from "vitest";
import { withRollback, mkCobradorConAuth, mkCliente, mkPrestamo, totalPagado } from "./db";

describe("harness PG", () => {
  it("migra el esquema y hace CRUD básico de pagos", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: 100, totalDias: 20 });
      await c.query(
        "insert into pagos (prestamo_id, dia_credito, monto, registrado_por) values ($1,1,100,$2)",
        [pid, cob.id],
      );
      expect(await totalPagado(c, pid)).toBe(100);
    });
  });

  it("las RPC de dinero existen en la base migrada", async () => {
    await withRollback(async (c) => {
      const r = await c.query<{ proname: string }>(
        `select proname from pg_proc
         where proname in ('registrar_pago_seguro','renovar_credito_seguro','crear_credito_venta_seguro')
         order by proname`,
      );
      const nombres = r.rows.map((x) => x.proname);
      expect(nombres).toContain("registrar_pago_seguro");
      expect(nombres).toContain("renovar_credito_seguro");
      expect(nombres).toContain("crear_credito_venta_seguro");
    });
  });

  it("el trigger de inmutabilidad impide editar el monto de un pago", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: 100, totalDias: 20 });
      const pago = await c.query<{ id: string }>(
        "insert into pagos (prestamo_id, dia_credito, monto, registrado_por) values ($1,1,100,$2) returning id",
        [pid, cob.id],
      );
      await expect(
        c.query("update pagos set monto = 999 where id = $1", [pago.rows[0].id]),
      ).rejects.toThrow(/no se modifican|financieros/i);
    });
  });
});
