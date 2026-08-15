// ─────────────────────────────────────────────────────────────────────────
//  LIBRO DE CAJA (movimientos_caja) contra Postgres REAL — Fase 2 del plan QA
//  (15-08). Era el único punto de escritura de plata del inventario sin test
//  permanente. Se sella lo que las migraciones PROMETEN:
//   · 0010/0060: INSERT solo gestor, con registrado_por = él mismo, y el
//     supervisor solo dentro de su zona (o sin cobrador asociado).
//   · 0118: UPDATE congela lo financiero (monto/tipo/categoría/cobrador/fecha).
//   · 0138: DELETE vetado, con escotilla explícita `app.permitir_borrado_caja`.
//   · 0074: op_id único → el reintento del mismo egreso NO duplica.
//  Y que los flujos LEGÍTIMOS sigan: un admin registra un egreso y edita la
//  glosa (metadato no financiero) sin que el trigger lo frene.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  withRollback,
  comoRol,
  esperaErrorPg,
  mkGestorConAuth,
  mkCobradorConAuth,
  n,
} from "./db";

const CATEGORIA = "Comisión";

describe("movimientos_caja · quién puede escribir", () => {
  it("un ADMIN registra un egreso a su nombre (registrado_por = él)", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const cob = await mkCobradorConAuth(c);
      const r = await comoRol(c, "authenticated", admin.authUserId, () =>
        c.query(
          `insert into movimientos_caja (tipo, monto, categoria, descripcion, cobrador_id, registrado_por)
           values ('egreso', 1500, $1, 'test', $2, $3) returning id, monto`,
          [CATEGORIA, cob.id, admin.id],
        ),
      );
      expect(r.rows).toHaveLength(1);
      expect(n(r.rows[0].monto)).toBe(1500);
    });
  });

  it("NADIE registra un movimiento a nombre de OTRO (registrado_por ≠ yo → RLS)", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const otro = await mkGestorConAuth(c, "supervisor");
      await comoRol(c, "authenticated", admin.authUserId, () =>
        esperaErrorPg(c, "42501", () =>
          c.query(
            `insert into movimientos_caja (tipo, monto, categoria, registrado_por)
             values ('egreso', 100, $1, $2)`,
            [CATEGORIA, otro.id],
          ),
        ),
      );
    });
  });

  it("un COBRADOR no escribe en el libro de caja (no es gestor)", async () => {
    await withRollback(async (c) => {
      const cob = await mkCobradorConAuth(c);
      await comoRol(c, "authenticated", cob.authUserId, () =>
        esperaErrorPg(c, "42501", () =>
          c.query(
            `insert into movimientos_caja (tipo, monto, categoria, registrado_por)
             values ('egreso', 100, $1, $2)`,
            [CATEGORIA, cob.id],
          ),
        ),
      );
    });
  });

  it("el monto tiene que ser positivo y el tipo válido (CHECKs de 0010)", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      await comoRol(c, "authenticated", admin.authUserId, async () => {
        await esperaErrorPg(c, "23514", () =>
          c.query(
            `insert into movimientos_caja (tipo, monto, registrado_por) values ('egreso', 0, $1)`,
            [admin.id],
          ),
        );
        await esperaErrorPg(c, "23514", () =>
          c.query(
            `insert into movimientos_caja (tipo, monto, registrado_por) values ('regalo', 100, $1)`,
            [admin.id],
          ),
        );
      });
    });
  });
});

describe("movimientos_caja · el libro es INMUTABLE (0118 + 0138)", () => {
  async function unEgreso(c: import("pg").PoolClient, adminId: string): Promise<string> {
    const r = await c.query<{ id: string }>(
      `insert into movimientos_caja (tipo, monto, categoria, descripcion, registrado_por)
       values ('egreso', 2000, $1, 'glosa original', $2) returning id`,
      [CATEGORIA, adminId],
    );
    return r.rows[0].id;
  }

  it("el MONTO no se toca ni como superusuario (trigger, no RLS)", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const id = await unEgreso(c, admin.id);
      await esperaErrorPg(c, "P0001", () =>
        c.query("update movimientos_caja set monto = 9999 where id = $1", [id]),
      );
      const r = await c.query("select monto from movimientos_caja where id=$1", [id]);
      expect(n(r.rows[0].monto)).toBe(2000);
    });
  });

  it("tampoco el tipo, la categoría, el cobrador ni la fecha", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const cob = await mkCobradorConAuth(c);
      const id = await unEgreso(c, admin.id);
      for (const set of [
        "tipo = 'ingreso'",
        "categoria = 'Otra'",
        `cobrador_id = '${cob.id}'`,
        "fecha = '2026-01-01'",
        `registrado_por = '${cob.id}'`,
      ]) {
        await esperaErrorPg(c, "P0001", () =>
          c.query(`update movimientos_caja set ${set} where id = $1`, [id]),
        );
      }
    });
  });

  it("la GLOSA (descripción) sí se puede corregir: es metadato, no plata", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const id = await unEgreso(c, admin.id);
      await c.query("update movimientos_caja set descripcion = 'glosa corregida' where id = $1", [id]);
      const r = await c.query("select descripcion, monto from movimientos_caja where id=$1", [id]);
      expect(r.rows[0].descripcion).toBe("glosa corregida");
      expect(n(r.rows[0].monto)).toBe(2000);
    });
  });

  it("un movimiento NO se borra… salvo con la escotilla explícita en la misma tx", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const id = await unEgreso(c, admin.id);
      // Sin escotilla: el trigger frena, incluso al superusuario.
      await esperaErrorPg(c, "P0001", () =>
        c.query("delete from movimientos_caja where id = $1", [id]),
      );
      const sigue = await c.query("select 1 from movimientos_caja where id=$1", [id]);
      expect(sigue.rowCount).toBe(1);
      // Con la escotilla (operación administrativa deliberada): borra.
      await c.query("set local app.permitir_borrado_caja = 'on'");
      await c.query("delete from movimientos_caja where id = $1", [id]);
      const ya = await c.query("select 1 from movimientos_caja where id=$1", [id]);
      expect(ya.rowCount).toBe(0);
    });
  });
});

describe("movimientos_caja · idempotencia por op_id (0074)", () => {
  it("el MISMO op_id no entra dos veces: el reintento del egreso no duplica la plata", async () => {
    await withRollback(async (c) => {
      const admin = await mkGestorConAuth(c, "admin");
      const opId = "00000000-0000-4000-8000-00000000c0f3";
      await c.query(
        `insert into movimientos_caja (tipo, monto, categoria, registrado_por, op_id)
         values ('egreso', 700, $1, $2, $3)`,
        [CATEGORIA, admin.id, opId],
      );
      await esperaErrorPg(c, "23505", () =>
        c.query(
          `insert into movimientos_caja (tipo, monto, categoria, registrado_por, op_id)
           values ('egreso', 700, $1, $2, $3)`,
          [CATEGORIA, admin.id, opId],
        ),
      );
      const r = await c.query("select count(*)::int as k from movimientos_caja where op_id = $1", [opId]);
      expect(r.rows[0].k).toBe(1);
    });
  });
});
