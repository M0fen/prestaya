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
      // Monto DISTINTO (500): no es un gemelo — lo que se prueba acá es el
      // tope del crédito, no el doble toque (ese es P0413, más abajo).
      await esperaErrorPg(c, "P0409", () =>
        c.query(SQL, [prestamoId, 1, 500, cob.id, null, null, null, randomUUID()]),
      );
      // El libro quedó intacto: sigue en 1.000.
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

  it("SELLA el día contable (clamp 0124): un registrado_en de OTRO día se descarta y se usa now()", async () => {
    await withRollback(async (c) => {
      const { cob, prestamoId } = await escenario(c, 500, 20);
      // Ataque de fecha por REST: fechar el cobro AYER (evadir la rendición de
      // hoy) o MAÑANA (adelantar el día). El clamp usa el día UY del servidor.
      // Montos DISTINTOS por vuelta: dos iguales a segundos serían un gemelo (0147).
      let monto = 100;
      for (const truco of ["now() - interval '1 day'", "now() + interval '1 day'"]) {
        const r = await c.query(
          `select * from registrar_pago_seguro($1, 1, ${(monto += 100)}, $2, null, null, ${truco}, null)`,
          [prestamoId, cob.id],
        );
        const sellado = await c.query(
          `select ((registrado_en at time zone 'America/Montevideo')::date
                   = (now() at time zone 'America/Montevideo')::date) as hoy_uy
             from pagos where id = $1`,
          [r.rows[0].id],
        );
        expect(sellado.rows[0].hoy_uy).toBe(true);
      }
    });
  });

  it("un registrado_en del MISMO día UY más temprano se CONSERVA (cola offline legítima)", async () => {
    await withRollback(async (c) => {
      const { cob, prestamoId } = await escenario(c, 500, 20);
      // 30 min atrás: mismo día uruguayo → la hora real del cobro entra al libro.
      const r = await c.query(
        `select * from registrar_pago_seguro($1, 1, 100, $2, null, null, now() - interval '30 minutes', null)`,
        [prestamoId, cob.id],
      );
      const fila = await c.query(
        `select (registrado_en <= now() - interval '29 minutes') as conservada
           from pagos where id = $1`,
        [r.rows[0].id],
      );
      // ⚠️ Cerca del corte (03:00Z) "30 min atrás" puede caer en el día UY
      // anterior y el clamp legítimamente lo re-sella a now(): en ese caso el
      // assert de conservación no aplica (el test del clamp de arriba lo cubre).
      const cruzoElCorte = await c.query(
        `select ((now() - interval '30 minutes') at time zone 'America/Montevideo')::date
                is distinct from (now() at time zone 'America/Montevideo')::date as cruzo`,
      );
      if (!cruzoElCorte.rows[0].cruzo) expect(fila.rows[0].conservada).toBe(true);
    });
  });

  it("GEMELO ATÓMICO (0147): el mismo monto a minutos rebota P0413 — la carrera de dos dispositivos", async () => {
    await withRollback(async (c) => {
      const { cob, prestamoId } = await escenario(c, 500, 20);
      // El "primer toque" ya está en el libro (registrado hace 2 minutos).
      await c.query(
        "insert into pagos (prestamo_id, dia_credito, monto, registrado_por, registrado_en) values ($1,1,500,$2, now() - interval '2 minutes')",
        [prestamoId, cob.id],
      );
      // El segundo toque (op_id DISTINTO — no es un reintento) muere ADENTRO del lock.
      await esperaErrorPg(c, "P0413", () =>
        c.query(SQL, [prestamoId, 2, 500, cob.id, null, null, null, null]),
      );
      expect(await totalPagado(c, prestamoId)).toBe(500); // un solo cobro en el libro
    });
  });

  it("GEMELO: la segunda vuelta de la ruta (30 min después) NO se frena", async () => {
    await withRollback(async (c) => {
      const { cob, prestamoId } = await escenario(c, 500, 20);
      await c.query(
        "insert into pagos (prestamo_id, dia_credito, monto, registrado_por, registrado_en) values ($1,1,500,$2, now() - interval '30 minutes')",
        [prestamoId, cob.id],
      );
      await c.query(SQL, [prestamoId, 2, 500, cob.id, null, null, null, null]);
      expect(await totalPagado(c, prestamoId)).toBe(1000);
    });
  });

  it("GEMELO: la confirmación explícita (p_permitir_gemelo) lo salta — 'pagó dos veces de verdad'", async () => {
    await withRollback(async (c) => {
      const { cob, prestamoId } = await escenario(c, 500, 20);
      await c.query(
        "insert into pagos (prestamo_id, dia_credito, monto, registrado_por, registrado_en) values ($1,1,500,$2, now() - interval '2 minutes')",
        [prestamoId, cob.id],
      );
      await c.query(
        `select * from registrar_pago_seguro($1, 2, 500, $2, null, null, null, null, true)`,
        [prestamoId, cob.id],
      );
      expect(await totalPagado(c, prestamoId)).toBe(1000);
    });
  });

  it("GEMELO: un pago ANULADO o IMPORTADO no frena el cobro real", async () => {
    await withRollback(async (c) => {
      const { cob, prestamoId } = await escenario(c, 500, 20);
      await c.query(
        `insert into pagos (prestamo_id, dia_credito, monto, registrado_por, registrado_en,
                            anulado, anulado_por, anulado_en, motivo_anulacion)
         values ($1,1,500,$2, now() - interval '1 minute', true, $2, now(), 'caos: recobro tras anular')`,
        [prestamoId, cob.id],
      );
      await c.query(
        `insert into pagos (prestamo_id, dia_credito, monto, registrado_por, registrado_en, origen) values ($1,2,500,$2, now() - interval '1 minute', 'disapp_import')`,
        [prestamoId, cob.id],
      );
      await c.query(SQL, [prestamoId, 3, 500, cob.id, null, null, null, null]); // pasa
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
