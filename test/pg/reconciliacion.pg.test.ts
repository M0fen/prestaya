// Integración REAL de app_reconciliacion_violaciones (0071): el VIGILANTE de la
// plata que corre cada mañana. Verifica que detecta las dos invariantes rotas y
// que NO falsea alarmas sobre créditos sanos. Aserta sobre ids concretos para ser
// robusto ante cualquier dato residual en la base compartida.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { withRollback, mkCobradorConAuth, mkCliente, mkPrestamo } from "./db";

async function idsViolados(c: import("pg").PoolClient): Promise<Set<string>> {
  const r = await c.query<{ id: string }>("select id from app_reconciliacion_violaciones()");
  return new Set(r.rows.map((x) => x.id));
}

describe("app_reconciliacion_violaciones (integración PG)", () => {
  it("un crédito SANO (pagado_acum = Σ pagos ≤ total) NO aparece", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: 1000, totalDias: 20 });
      await c.query(
        "select registrar_pago_seguro($1,1,1000,$2,null,null,null,$3)",
        [pid, cob.id, randomUUID()],
      );
      expect(await idsViolados(c)).not.toContain(pid);
    });
  });

  it("INV1 — el denormalizado NO coincide con el libro (dato tocado) → aparece", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: 1000, totalDias: 20 });
      await c.query("select registrar_pago_seguro($1,1,1000,$2,null,null,null,$3)", [pid, cob.id, randomUUID()]);
      // Corromper el cache (simula trigger roto / UPDATE manual): acum ya no = Σ.
      await c.query("update prestamos set pagado_acum = pagado_acum + 500 where id=$1", [pid]);
      expect(await idsViolados(c)).toContain(pid);
    });
  });

  it("INV2 — sobre-cobro real (Σ pagos > total a pagar) → aparece", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      const cli = await mkCliente(c);
      const pid = await mkPrestamo(c, { clienteId: cli, cobradorId: cob.id, cuotaDiaria: 1000, totalDias: 1 }); // total 1.000
      // Inserción DIRECTA (no por la RPC, que rechazaría el sobre-pago): el libro
      // registra un cobro físico de 2.000 en un crédito de 1.000. El trigger sube
      // pagado_acum a 2.000, así que INV1 NO se dispara: aislamos INV2.
      await c.query(
        "insert into pagos (prestamo_id, dia_credito, monto, registrado_por) values ($1,1,2000,$2)",
        [pid, cob.id],
      );
      expect(await idsViolados(c)).toContain(pid);
    });
  });
});
