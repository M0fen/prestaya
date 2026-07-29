// ─────────────────────────────────────────────────────────────────────────
//  Tests de crearRenovacion — el ALTA REAL del crédito de renovación (escribe
//  dinero). El núcleo puro de la cuota ya se prueba en lib/renovacion.test.ts;
//  acá se blindan las GUARDAS de la orquestación money-critical:
//    · validaciones de entrada (monto/cap/días/frecuencia) ANTES de tocar la BD,
//    · gate de "crédito anterior activo" y de "saldado" (falta === 0),
//    · candado de concurrencia (el UPDATE condicional no encuentra el activo),
//    · compensación (si el insert falla, se reactiva el anterior).
//  Se usa un doble de Supabase que emula el query-builder encadenado.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearRenovacion, type AltaRenovacion } from "./renovaciones";

// Crédito anterior canónico: prestó 10.000, cuota 400 × 30 = 12.000 a pagar
// (tasa 1.2). Saldado ⇔ pagos suman ≥ 12.000.
function prestamoAnterior(over: Record<string, unknown> = {}) {
  return {
    id: "ant-1",
    cliente_id: "cli-1",
    cobrador_id: "cob-9",
    monto_prestado: 10000,
    cuota_diaria: 400,
    total_dias: 30,
    frecuencia: "diario",
    fecha_inicio: "2026-05-01",
    estado: "activo",
    creado_por: null,
    creado_en: "2026-05-01T00:00:00Z",
    actualizado_en: "2026-05-01T00:00:00Z",
    finalizado_en: null,
    ...over,
  };
}

/**
 * Doble mínimo de Supabase para crearRenovacion. Modela dos tablas en memoria
 * (`prestamos`, `pagos`) y resuelve la cadena select/insert/update.
 * Opciones de escenario:
 *   · failInsert: el insert del nuevo crédito falla (para probar compensación).
 *   · finalizarTrasLeer: al leer el anterior (getPrestamoPorId) devuelve el
 *     snapshot ACTIVO pero deja la fila almacenada como 'finalizado', así el
 *     UPDATE condicional `.eq('estado','activo')` posterior no encuentra nada
 *     (emula la carrera: otra persona ya lo renovó).
 */
function fakeDb(state: {
  prestamos: Record<string, Record<string, unknown>>;
  pagos: Record<string, Record<string, unknown>[]>;
  failInsert?: boolean;
  insertCommitsButErrors?: boolean;
  finalizarTrasLeer?: boolean;
  nextInsertId?: string;
  // ── RPC atómico (0087) ──
  // Por defecto (sin rpcPresente) el .rpc devuelve 42883 → crearRenovacion cae al camino
  // de 2 requests, así los tests que no lo piden ejercitan el FALLBACK (conducta previa).
  rpcPresente?: boolean;
  rpcConcurrencia?: boolean; // el gate estado='activo' del RPC ve 0 filas → P0410
  rpcCommitPerdido?: boolean; // el RPC commiteó pero la respuesta se perdió (timeout/504)
}) {
  const calls = {
    inserts: [] as Record<string, unknown>[],
    updates: [] as { payload: Record<string, unknown>; filtros: [string, unknown][] }[],
  };

  function makeQuery(table: string) {
    let op: "select" | "insert" | "update" = "select";
    let payload: Record<string, unknown> = {};
    let selectAfterWrite = false;
    const filtros: [string, unknown][] = [];

    const matches = (row: Record<string, unknown>) =>
      filtros.every(([c, v]) => row[c] === v);

    function runList() {
      if (op === "select") {
        if (table === "prestamos") {
          return { data: Object.values(state.prestamos).filter(matches), error: null };
        }
        if (table === "pagos") {
          const pid = filtros.find(([c]) => c === "prestamo_id")?.[1] as string;
          return { data: (state.pagos[pid] ?? []).filter(matches), error: null };
        }
      }
      if (op === "update") {
        const afectadas = Object.values(state.prestamos).filter(matches);
        calls.updates.push({ payload, filtros: [...filtros] });
        for (const r of afectadas) Object.assign(r, payload);
        return { data: selectAfterWrite ? afectadas.map((r) => ({ id: r.id })) : null, error: null };
      }
      if (op === "insert") return runSingle();
      return { data: null, error: null };
    }

    function runSingle() {
      if (op === "select" && table === "prestamos") {
        const row = Object.values(state.prestamos).filter(matches)[0] ?? null;
        if (!row) return { data: null, error: null };
        // getPrestamoPorId (maybeSingle): devuelve un CLON (snapshot) y, si el
        // escenario lo pide, finaliza la fila real → carrera de concurrencia.
        const snapshot = { ...row };
        if (state.finalizarTrasLeer) row.estado = "finalizado";
        return { data: snapshot, error: null };
      }
      if (op === "insert") {
        // failInsert puro: no crea nada (fallo real). insertCommitsButErrors: CREA la
        // fila (commit ok) pero devuelve error → simula timeout/504 con respuesta perdida.
        if (state.failInsert && !state.insertCommitsButErrors)
          return { data: null, error: { message: "insert falló" } };
        const id = state.nextInsertId ?? "nuevo-1";
        const fila = { id, ...payload };
        state.prestamos[id] = fila;
        calls.inserts.push(fila);
        if (state.insertCommitsButErrors)
          return { data: null, error: { message: "commit ok, respuesta perdida" } };
        return { data: { id }, error: null };
      }
      return { data: null, error: null };
    }

    const api: Record<string, unknown> = {
      select(_cols?: string) {
        if (op === "insert" || op === "update") selectAfterWrite = true;
        return api;
      },
      insert(row: Record<string, unknown>) { op = "insert"; payload = row; return api; },
      update(row: Record<string, unknown>) { op = "update"; payload = row; return api; },
      eq(col: string, val: unknown) { filtros.push([col, val]); return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle() { return Promise.resolve(runSingle()); },
      single() { return Promise.resolve(runSingle()); },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve(runList()).then(res, rej);
      },
    };
    return api;
  }

  // .rpc('renovar_credito_seguro', ...) — emula la sección crítica atómica del 0087.
  // Sin rpcPresente devuelve 42883 (RPC ausente) → el llamador usa el fallback.
  function rpc(fn: string, params: Record<string, unknown>) {
    if (fn !== "renovar_credito_seguro" || !state.rpcPresente)
      return Promise.resolve({ data: null, error: { code: "42883" } });
    const antId = params.p_prestamo_anterior_id as string;
    const ant = state.prestamos[antId];
    // Gate estado='activo': si no está activo (o el escenario fuerza la carrera) → P0410.
    if (!ant || ant.estado !== "activo" || state.rpcConcurrencia)
      return Promise.resolve({ data: null, error: { code: "P0410" } });
    // Atómico: finalizar el anterior + insertar el nuevo (o los dos o ninguno).
    ant.estado = "finalizado";
    ant.finalizado_en = "2026-07-20T15:00:00Z";
    const id = state.nextInsertId ?? "nuevo-rpc";
    const fila = {
      id,
      cliente_id: params.p_cliente_id,
      cobrador_id: ant.cobrador_id,
      monto_prestado: params.p_monto,
      cuota_diaria: params.p_cuota,
      total_dias: params.p_total_dias,
      frecuencia: params.p_frecuencia,
      fecha_inicio: params.p_fecha_inicio,
      estado: "activo",
      creado_por: params.p_creado_por,
    };
    state.prestamos[id] = fila;
    calls.inserts.push(fila);
    // Commit-perdido: el crédito quedó creado pero la respuesta se pierde (error sin code PG).
    if (state.rpcCommitPerdido)
      return Promise.resolve({ data: null, error: { message: "timeout, respuesta perdida" } });
    return Promise.resolve({ data: fila, error: null });
  }

  const db = { from: (t: string) => makeQuery(t), rpc, _calls: calls };
  return db as unknown as SupabaseClient & { _calls: typeof calls };
}

// Crédito saldado: un solo pago que cubre el total (12.000).
const PAGOS_SALDADO = [{ id: "p1", prestamo_id: "ant-1", dia_credito: 1, monto: 12000, anulado: false }];

const ALTA_OK: AltaRenovacion = {
  clienteId: "cli-1",
  prestamoAnteriorId: "ant-1",
  monto: 10000,
  totalDias: 30,
  frecuencia: "diario",
  creadoPor: "gestor-1",
};
const HOY = new Date("2026-07-20T15:00:00Z");

describe("crearRenovacion — validaciones de entrada (sin tocar la BD)", () => {
  const db = () => fakeDb({ prestamos: {}, pagos: {} });

  it("monto ≤ 0 → error", async () => {
    const r = await crearRenovacion(db(), { ...ALTA_OK, monto: 0 }, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mayor a 0/i);
  });

  it("monto > CAP ($100.000) → error (duro para todos)", async () => {
    const r = await crearRenovacion(db(), { ...ALTA_OK, monto: 100001 }, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/100\.000/);
  });

  it("cuotas no entero / ≤ 0 → error", async () => {
    expect((await crearRenovacion(db(), { ...ALTA_OK, totalDias: 0 }, HOY)).ok).toBe(false);
    expect((await crearRenovacion(db(), { ...ALTA_OK, totalDias: 30.5 }, HOY)).ok).toBe(false);
  });

  it("frecuencia inválida → error", async () => {
    const r = await crearRenovacion(
      db(),
      { ...ALTA_OK, frecuencia: "cada-luna-llena" as AltaRenovacion["frecuencia"] },
      HOY,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/frecuencia/i);
  });
});

describe("crearRenovacion — gates sobre el crédito anterior", () => {
  it("no existe el crédito anterior → error", async () => {
    const db = fakeDb({ prestamos: {}, pagos: {} });
    const r = await crearRenovacion(db, ALTA_OK, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no está activo/i);
  });

  it("el anterior es de OTRO cliente → error (no se cruza plata entre clientes)", async () => {
    const db = fakeDb({ prestamos: { "ant-1": prestamoAnterior({ cliente_id: "otro" }) }, pagos: {} });
    const r = await crearRenovacion(db, ALTA_OK, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no está activo/i);
  });

  it("el anterior no está activo (finalizado) → error", async () => {
    const db = fakeDb({ prestamos: { "ant-1": prestamoAnterior({ estado: "finalizado" }) }, pagos: {} });
    const r = await crearRenovacion(db, ALTA_OK, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no está activo/i);
  });

  it("el anterior NO está saldado (falta > 0) → no se renueva sobre saldo pendiente", async () => {
    const db = fakeDb({
      prestamos: { "ant-1": prestamoAnterior() },
      pagos: { "ant-1": [{ id: "p1", prestamo_id: "ant-1", dia_credito: 1, monto: 5000, anulado: false }] },
    });
    const r = await crearRenovacion(db, ALTA_OK, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no está saldado/i);
  });
});

describe("crearRenovacion — alta exitosa (happy path)", () => {
  it("saldado → finaliza el anterior, crea el nuevo con la cuota que arrastra la tasa", async () => {
    const state = {
      prestamos: { "ant-1": prestamoAnterior() },
      pagos: { "ant-1": PAGOS_SALDADO },
      nextInsertId: "nuevo-77",
    };
    const db = fakeDb(state);
    const r = await crearRenovacion(db, ALTA_OK, HOY);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prestamoId).toBe("nuevo-77");
      // 10.000 × 1.2 / 30 = 400 (misma tasa que el anterior).
      expect(r.cuota).toBe(400);
    }
    // El anterior quedó finalizado; hay un nuevo crédito activo del mismo cliente.
    expect(state.prestamos["ant-1"].estado).toBe("finalizado");
    const nuevo = db._calls.inserts[0];
    expect(nuevo.cliente_id).toBe("cli-1");
    expect(nuevo.cobrador_id).toBe("cob-9"); // arrastra el cobrador del anterior
    expect(nuevo.cuota_diaria).toBe(400);
    expect(nuevo.estado).toBe("activo");
    expect(nuevo.creado_por).toBe("gestor-1");
  });
});

describe("crearRenovacion — carreras y fallos (money-critical)", () => {
  it("concurrencia: el UPDATE condicional no encuentra el activo → 'ya fue renovado'", async () => {
    const state = {
      prestamos: { "ant-1": prestamoAnterior() },
      pagos: { "ant-1": PAGOS_SALDADO },
      finalizarTrasLeer: true, // otra persona lo renovó entre la lectura y el update
    };
    const db = fakeDb(state);
    const r = await crearRenovacion(db, ALTA_OK, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ya fue renovado/i);
    // No se creó ningún crédito nuevo.
    expect(db._calls.inserts).toHaveLength(0);
  });

  it("el insert del nuevo falla → compensa reactivando el anterior (no deja al cliente sin crédito)", async () => {
    const state = {
      prestamos: { "ant-1": prestamoAnterior() },
      pagos: { "ant-1": PAGOS_SALDADO },
      failInsert: true,
    };
    const db = fakeDb(state);
    const r = await crearRenovacion(db, ALTA_OK, HOY);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/se revirtió/i);
    // Compensación: el anterior volvió a 'activo' y su finalizado_en se limpió.
    expect(state.prestamos["ant-1"].estado).toBe("activo");
    expect(state.prestamos["ant-1"].finalizado_en).toBeNull();
  });

  it("COMMIT-PERDIDO: el insert 'falla' pero el crédito YA se creó → OK, NO compensa, NO duplica", async () => {
    // timeout/504: el INSERT commiteó (el crédito nuevo existe) pero la respuesta se
    // perdió → alta.error truthy. Verificar-antes-de-compensar debe encontrar el nuevo
    // y devolver ok SIN reactivar el anterior (si no → cliente con DOS activos = duplicado).
    const state = {
      prestamos: { "ant-1": prestamoAnterior() },
      pagos: { "ant-1": PAGOS_SALDADO },
      insertCommitsButErrors: true,
      nextInsertId: "nuevo-commit",
    };
    const db = fakeDb(state);
    const r = await crearRenovacion(db, ALTA_OK, HOY);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.prestamoId).toBe("nuevo-commit");
    // El anterior QUEDÓ finalizado (no se reactivó) → no hay duplicado de activos.
    expect(state.prestamos["ant-1"].estado).toBe("finalizado");
    // Existe exactamente el nuevo crédito activo (el que "se perdió").
    expect((state.prestamos as Record<string, { estado: string }>)["nuevo-commit"].estado).toBe("activo");
  });
});

describe("crearRenovacion — saldado con residuo sub-peso (crédito importado fraccionario)", () => {
  // Cuota importada de Disapp FRACCIONARIA; el libro es ENTERO (registrarPago
  // redondea). Al pagar todas las cuotas en enteros queda un residuo AGREGADO =
  // (cuota − round(cuota)) × días que NO está acotado a 0,5. Ese residuo sub-peso
  // es INCOBRABLE (no se puede cobrar 0,96) → el gate ahora exige saldar solo si
  // falta ≥ 1 peso. Para cuota ENTERA el residuo es 0 o ≥ 1 → NO cambia nada.
  const pagoUnico = (monto: number) => [{ id: "p1", prestamo_id: "ant-1", dia_credito: 1, monto, anulado: false }];

  it("CONTRAEJEMPLO documentado: cuota 351,04 × 24, pagó 8424 (falta 0,96) → RENUEVA (antes trababa para siempre)", async () => {
    // 8425/24 = 351,04 (caso real de import Disapp). 24 cuotas enteras de 351 = 8424.
    // Total real 8424,96 → falta 0,96 (incobrable). El gate viejo `round(0,96)=1>0`
    // lo bloqueaba aunque el cliente pagó todo lo cobrable; el nuevo `0,96 >= 1` = false.
    const state = {
      prestamos: { "ant-1": prestamoAnterior({ monto_prestado: 8425, cuota_diaria: 351.04, total_dias: 24 }) },
      pagos: { "ant-1": pagoUnico(8424) },
      nextInsertId: "nuevo-frac",
    };
    const r = await crearRenovacion(fakeDb(state), ALTA_OK, HOY);
    expect(r.ok).toBe(true);
  });

  it("residuo < 1 peso (incobrable) cuenta como SALDADO → deja renovar", async () => {
    // cuota 100,02 × 10 = 1000,2; pagó 1000 → falta 0,2 < 1 → saldado.
    const state = {
      prestamos: { "ant-1": prestamoAnterior({ monto_prestado: 1000, cuota_diaria: 100.02, total_dias: 10 }) },
      pagos: { "ant-1": pagoUnico(1000) },
      nextInsertId: "nuevo-frac2",
    };
    expect((await crearRenovacion(fakeDb(state), ALTA_OK, HOY)).ok).toBe(true);
  });

  it("falta ≥ 1 peso (cobrable de verdad) sigue bloqueando la renovación", async () => {
    // cuota 100,6 × 10 = 1006; pagó 1000 → falta 6 (cobrable) → NO saldado.
    const state = {
      prestamos: { "ant-1": prestamoAnterior({ monto_prestado: 1000, cuota_diaria: 100.6, total_dias: 10 }) },
      pagos: { "ant-1": pagoUnico(1000) },
    };
    const r = await crearRenovacion(fakeDb(state), ALTA_OK, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no está saldado/i);
  });

  it("BORDE falta = exactamente 1 peso → bloquea (1 peso es cobrable)", async () => {
    // cuota 100,1 × 10 = 1001; pagó 1000 → falta 1,0 → `1 >= 1` = true → bloquea.
    const state = {
      prestamos: { "ant-1": prestamoAnterior({ monto_prestado: 1000, cuota_diaria: 100.1, total_dias: 10 }) },
      pagos: { "ant-1": pagoUnico(1000) },
    };
    expect((await crearRenovacion(fakeDb(state), ALTA_OK, HOY)).ok).toBe(false);
  });

  it("NO-OP para cuota ENTERA (el piloto): saldado exacto renueva, deber ≥ 1 cuota bloquea", async () => {
    // Cuota entera 400 × 30 = 12000. El residuo fraccionario no existe → el gate se
    // comporta idéntico al viejo `round(falta)>0`. Blindaje de que el piloto no cambia.
    const saldado = {
      prestamos: { "ant-1": prestamoAnterior() },
      pagos: { "ant-1": pagoUnico(12000) },
      nextInsertId: "nuevo-ent",
    };
    expect((await crearRenovacion(fakeDb(saldado), ALTA_OK, HOY)).ok).toBe(true);
    // Debe una cuota entera (falta 400) → bloquea igual que siempre.
    const debe = {
      prestamos: { "ant-1": prestamoAnterior() },
      pagos: { "ant-1": pagoUnico(11600) },
    };
    expect((await crearRenovacion(fakeDb(debe), ALTA_OK, HOY)).ok).toBe(false);
  });
});

describe("crearRenovacion — camino ATÓMICO (RPC 0087 presente)", () => {
  it("happy: finaliza el anterior + crea el nuevo en un solo paso, misma cuota", async () => {
    const state = {
      prestamos: { "ant-1": prestamoAnterior() },
      pagos: { "ant-1": PAGOS_SALDADO },
      rpcPresente: true,
      nextInsertId: "nuevo-atomico",
    };
    const db = fakeDb(state);
    const r = await crearRenovacion(db, ALTA_OK, HOY);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prestamoId).toBe("nuevo-atomico");
      expect(r.cuota).toBe(400); // arrastra la tasa 1.2 del anterior
    }
    // El anterior quedó finalizado y el nuevo activo — ambos por el RPC (no por el fallback).
    expect(state.prestamos["ant-1"].estado).toBe("finalizado");
    expect((state.prestamos as Record<string, { estado: string }>)["nuevo-atomico"].estado).toBe("activo");
    const nuevo = db._calls.inserts[0];
    expect(nuevo.cliente_id).toBe("cli-1");
    expect(nuevo.cobrador_id).toBe("cob-9"); // arrastra el cobrador del anterior
    expect(nuevo.creado_por).toBe("gestor-1");
    // El fallback NO corrió: no hubo ningún UPDATE de finalización por la vía de 2 pasos.
    expect(db._calls.updates).toHaveLength(0);
  });

  it("concurrencia: el gate del RPC ve el anterior ya finalizado (P0410) → 'ya fue renovado'", async () => {
    const state = {
      prestamos: { "ant-1": prestamoAnterior() },
      pagos: { "ant-1": PAGOS_SALDADO },
      rpcPresente: true,
      rpcConcurrencia: true, // otra transacción lo renovó bajo el advisory lock
    };
    const db = fakeDb(state);
    const r = await crearRenovacion(db, ALTA_OK, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ya fue renovado/i);
    expect(db._calls.inserts).toHaveLength(0);
    // NO cae al fallback tras un P0410 (sería un segundo intento de finalizar).
    expect(db._calls.updates).toHaveLength(0);
  });

  it("COMMIT-PERDIDO del RPC: commiteó pero se perdió la respuesta → OK, NO duplica", async () => {
    // El RPC finalizó+insertó (atómico, ya commiteado) pero la respuesta se perdió.
    // buscarRenovacion debe encontrar el nuevo crédito y devolver ok (sin fabricar otro).
    const state = {
      prestamos: { "ant-1": prestamoAnterior() },
      pagos: { "ant-1": PAGOS_SALDADO },
      rpcPresente: true,
      rpcCommitPerdido: true,
      nextInsertId: "nuevo-rpc-cp",
    };
    const db = fakeDb(state);
    const r = await crearRenovacion(db, ALTA_OK, HOY);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.prestamoId).toBe("nuevo-rpc-cp");
    expect(state.prestamos["ant-1"].estado).toBe("finalizado"); // no se reactivó
    // Se creó exactamente uno (el del RPC); el fallback no fabricó un segundo.
    expect(db._calls.inserts).toHaveLength(1);
  });
});
