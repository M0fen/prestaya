// ─────────────────────────────────────────────────────────────────────────
//  Test money-critical: COMMIT AMBIGUO del egreso de comisión (anti doble-pago).
//  Si el egreso a caja commitea pero se pierde la respuesta (timeout/504, NO 23505),
//  el catch NO debe borrar el candado a ciegas: si lo borra, un reintento por OTRA
//  cadencia (semana en vez de mes) usa un op_id distinto → paga DOS VECES. La lógica:
//   · egreso EXISTE (op_id)    → éxito con respuesta perdida → conservar candado, ok.
//   · egreso NO existe         → fallo real → revertir candado+descuento, reintentar.
//   · no se puede verificar    → sesgo money-safe → NO borrar el candado.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUsuarioActual = vi.fn();
const bloqueoSoloLectura = vi.fn();
const getComisionesPeriodo = vi.fn();
const registrarMovimientoCaja = vi.fn();
const existeMovimientoPorOpId = vi.fn();
const descontarComprasEmpleadoDb = vi.fn();
const revertirDescuentoComprasEmpleadoDb = vi.fn();
const registrarAuditoria = vi.fn();
const crearReciboDb = vi.fn();

// Doble de la tabla comisiones_liquidadas: rastrea si se BORRA el candado.
const liquidadasInsert = vi.fn(() => Promise.resolve({ error: null }));
const liquidadasSelect = vi.fn(() => ({ eq: () => Promise.resolve({ data: [], error: null }) }));
const liquidadasDelete = vi.fn(() => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }));
const db = {
  from: (t: string) =>
    t === "comisiones_liquidadas"
      ? { insert: liquidadasInsert, select: liquidadasSelect, delete: liquidadasDelete }
      : {},
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServer: vi.fn(async () => db) }));
vi.mock("@/lib/observabilidad", () => ({ reportarError: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getUsuarioActual: (...a: unknown[]) => getUsuarioActual(...a),
  esAdmin: (rol: string) => rol === "admin",
}));
vi.mock("@/lib/data/featureFlags", () => ({ bloqueoSoloLectura: (...a: unknown[]) => bloqueoSoloLectura(...a) }));
vi.mock("@/lib/data/comisiones", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getComisionesPeriodo: (...a: unknown[]) => getComisionesPeriodo(...a),
}));
vi.mock("@/lib/data/caja", () => ({
  registrarMovimientoCaja: (...a: unknown[]) => registrarMovimientoCaja(...a),
  existeMovimientoPorOpId: (...a: unknown[]) => existeMovimientoPorOpId(...a),
}));
vi.mock("@/lib/data/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));
vi.mock("@/lib/data/recibos", () => ({ crearReciboDb: (...a: unknown[]) => crearReciboDb(...a) }));
vi.mock("@/lib/data/comprasEmpleado", () => ({
  descontarComprasEmpleadoDb: (...a: unknown[]) => descontarComprasEmpleadoDb(...a),
  revertirDescuentoComprasEmpleadoDb: (...a: unknown[]) => revertirDescuentoComprasEmpleadoDb(...a),
}));

import { liquidarComision } from "./comisiones";

const ADMIN = { id: "u-admin", nombre: "Admin", rol: "admin", activo: true };
const PERIODO_KEY = "mes:2026-07";

beforeEach(() => {
  vi.clearAllMocks();
  bloqueoSoloLectura.mockResolvedValue(null);
  getUsuarioActual.mockResolvedValue(ADMIN);
  getComisionesPeriodo.mockResolvedValue({
    periodo: "mes",
    periodoKey: PERIODO_KEY,
    etiqueta: "julio 2026",
    desde: "2026-07-01",
    hasta: "2026-07-16",
    atribuidoPorRuta: true,
    filas: [{ cobradorId: "cob-1", nombre: "Cobra", comision: 5000 }],
  });
  descontarComprasEmpleadoDb.mockResolvedValue(0);
  revertirDescuentoComprasEmpleadoDb.mockResolvedValue(undefined);
  registrarAuditoria.mockResolvedValue(undefined);
  crearReciboDb.mockResolvedValue({ numero: 1 });
});

describe("liquidarComision — commit AMBIGUO del egreso (anti doble-pago)", () => {
  it("egreso YA existe (op_id) → CONSERVA el candado y devuelve ok", async () => {
    registrarMovimientoCaja.mockRejectedValue(new Error("504 timeout")); // NO es 23505
    existeMovimientoPorOpId.mockResolvedValue(true); // el egreso commiteó
    const r = await liquidarComision({ cobradorId: "cob-1", periodoKey: PERIODO_KEY });
    expect(r.ok).toBe(true);
    expect(liquidadasDelete).not.toHaveBeenCalled(); // candado conservado → no re-liquidar por otra cadencia
    expect(revertirDescuentoComprasEmpleadoDb).not.toHaveBeenCalled();
  });

  it("egreso NO existe → revierte candado + descuento (reintento limpio)", async () => {
    registrarMovimientoCaja.mockRejectedValue(new Error("network"));
    existeMovimientoPorOpId.mockResolvedValue(false);
    const r = await liquidarComision({ cobradorId: "cob-1", periodoKey: PERIODO_KEY });
    expect(r.ok).toBe(false);
    expect(liquidadasDelete).toHaveBeenCalledTimes(1);
    expect(revertirDescuentoComprasEmpleadoDb).toHaveBeenCalledTimes(1);
  });

  it("no se puede verificar el egreso → NO borra el candado (sesgo a no pagar 2×)", async () => {
    registrarMovimientoCaja.mockRejectedValue(new Error("boom"));
    existeMovimientoPorOpId.mockRejectedValue(new Error("db caída"));
    const r = await liquidarComision({ cobradorId: "cob-1", periodoKey: PERIODO_KEY });
    expect(r.ok).toBe(false);
    expect(liquidadasDelete).not.toHaveBeenCalled();
  });
});
