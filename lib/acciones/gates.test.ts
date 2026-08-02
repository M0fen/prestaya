// ─────────────────────────────────────────────────────────────────────────
//  Tests de COMPORTAMIENTO de los GATES de las Server Actions de dinero.
//  No prueban la lógica (eso lo hacen los tests de integración de los RPC), sino
//  que la PUERTA está puesta: un rol equivocado o el kill-switch (modo solo
//  lectura) DETIENEN la acción ANTES de tocar la base / colocar capital.
//  Foco en lo agregado hoy: venta de tienda (convertirLeadEnVenta) y base de
//  caja (setApertura), + custodia de efectivo (confirmarCierreZona).
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks de las dependencias de las acciones ───────────────────────────────
const getUsuarioActual = vi.fn();
const getActorActual = vi.fn();
const bloqueoSoloLectura = vi.fn();
const crearVentaSegura = vi.fn();
const setAperturaDb = vi.fn();
const getCierrePorZona = vi.fn();
const puedeVerZona = vi.fn();
const upsertDiscrepanciaDb = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServer: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdmin: vi.fn(() => ({})) }));
vi.mock("@/lib/auth", () => ({
  getUsuarioActual: (...a: unknown[]) => getUsuarioActual(...a),
  getActorActual: (...a: unknown[]) => getActorActual(...a),
  esAdmin: (rol: string) => rol === "admin",
  esGestor: (rol: string) => rol === "admin" || rol === "supervisor",
}));
vi.mock("@/lib/data/featureFlags", () => ({
  bloqueoSoloLectura: (...a: unknown[]) => bloqueoSoloLectura(...a),
}));
vi.mock("@/lib/data/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/lib/data/aperturas", () => ({ setAperturaDb: (...a: unknown[]) => setAperturaDb(...a) }));
vi.mock("@/lib/data/tienda", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  crearVentaSegura: (...a: unknown[]) => crearVentaSegura(...a),
}));
vi.mock("@/lib/observabilidad", () => ({ reportarError: vi.fn() }));
vi.mock("@/lib/permisos", () => ({ puedeVerZona: (...a: unknown[]) => puedeVerZona(...a) }));
vi.mock("@/lib/data/cierreZona", () => ({ getCierrePorZona: (...a: unknown[]) => getCierrePorZona(...a) }));
vi.mock("@/lib/data/discrepancias", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  upsertDiscrepanciaDb: (...a: unknown[]) => upsertDiscrepanciaDb(...a),
}));

import { convertirLeadEnVenta } from "./tienda";
import { setApertura } from "./aperturas";
import { confirmarCierreZona } from "./cierreZona";
import { resolverDiscrepancia } from "./discrepancias";

const ADMIN = { id: "u-admin", nombre: "Admin", rol: "admin", activo: true };
const SUPERVISOR = { id: "u-sup", nombre: "Sup", rol: "supervisor", activo: true };
const COBRADOR = { id: "u-cob", nombre: "Cob", rol: "cobrador", activo: true };
const UUID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  bloqueoSoloLectura.mockResolvedValue(null); // por defecto: sistema operativo
});

describe("convertirLeadEnVenta — gates (venta money-critical)", () => {
  it("sin sesión NO coloca capital", async () => {
    getUsuarioActual.mockResolvedValue(null);
    const r = await convertirLeadEnVenta({ solicitudId: UUID });
    expect(r.ok).toBe(false);
    expect(crearVentaSegura).not.toHaveBeenCalled();
  });

  it("un supervisor (no admin) NO puede convertir en venta", async () => {
    getUsuarioActual.mockResolvedValue(SUPERVISOR);
    const r = await convertirLeadEnVenta({ solicitudId: UUID });
    expect(r.ok).toBe(false);
    expect(crearVentaSegura).not.toHaveBeenCalled();
  });

  it("con el kill-switch activo (solo lectura) NO coloca capital", async () => {
    getUsuarioActual.mockResolvedValue(ADMIN);
    bloqueoSoloLectura.mockResolvedValue({ ok: false, error: "Sistema en modo solo lectura." });
    const r = await convertirLeadEnVenta({ solicitudId: UUID });
    expect(r).toEqual({ ok: false, error: "Sistema en modo solo lectura." });
    expect(crearVentaSegura).not.toHaveBeenCalled();
  });

  it("admin + sistema operativo pero solicitud inválida → rechaza antes de la DB", async () => {
    getUsuarioActual.mockResolvedValue(ADMIN);
    const r = await convertirLeadEnVenta({ solicitudId: "no-es-uuid" });
    expect(r.ok).toBe(false);
    expect(crearVentaSegura).not.toHaveBeenCalled();
  });
});

describe("setApertura — gates (base de caja)", () => {
  it("un cobrador NO puede fijar la base de caja", async () => {
    getUsuarioActual.mockResolvedValue(COBRADOR);
    const r = await setApertura({ cobradorId: UUID, base: 1000 });
    expect(r.ok).toBe(false);
    expect(setAperturaDb).not.toHaveBeenCalled();
  });

  it("cobradorId inválido → rechaza antes de la DB", async () => {
    getUsuarioActual.mockResolvedValue(SUPERVISOR);
    const r = await setApertura({ cobradorId: "x", base: 1000 });
    expect(r.ok).toBe(false);
    expect(setAperturaDb).not.toHaveBeenCalled();
  });

  it("con el kill-switch activo NO fija la base (entra al 'esperado' de la rendición)", async () => {
    getUsuarioActual.mockResolvedValue(SUPERVISOR);
    bloqueoSoloLectura.mockResolvedValue({ ok: false, error: "Sistema en modo solo lectura." });
    const r = await setApertura({ cobradorId: UUID, base: 1000 });
    expect(r).toEqual({ ok: false, error: "Sistema en modo solo lectura." });
    expect(setAperturaDb).not.toHaveBeenCalled();
  });

  it("un gestor fija la base y se GUARDA redondeada y acotada (0..1.000.000)", async () => {
    getUsuarioActual.mockResolvedValue(SUPERVISOR);
    setAperturaDb.mockResolvedValue(undefined);
    const r = await setApertura({ cobradorId: UUID, base: 1500.7 });
    expect(r.ok).toBe(true);
    expect(setAperturaDb).toHaveBeenCalledTimes(1);
    expect(setAperturaDb.mock.calls[0][1]).toMatchObject({ base: 1501 }); // round
  });

  it("una base negativa se clava en 0 (nunca base negativa)", async () => {
    getUsuarioActual.mockResolvedValue(ADMIN);
    setAperturaDb.mockResolvedValue(undefined);
    const r = await setApertura({ cobradorId: UUID, base: -999 });
    expect(r.ok).toBe(true);
    expect(setAperturaDb.mock.calls[0][1]).toMatchObject({ base: 0 });
  });

  it("una base exagerada se topea en 1.000.000", async () => {
    getUsuarioActual.mockResolvedValue(ADMIN);
    setAperturaDb.mockResolvedValue(undefined);
    await setApertura({ cobradorId: UUID, base: 9_999_999 });
    expect(setAperturaDb.mock.calls[0][1]).toMatchObject({ base: 1_000_000 });
  });
});

describe("confirmarCierreZona — gates (custodia de efectivo del supervisor)", () => {
  it("un cobrador NO puede cerrar la caja de una zona", async () => {
    getUsuarioActual.mockResolvedValue(COBRADOR);
    getActorActual.mockResolvedValue({ id: "u-cob", rol: "cobrador" });
    puedeVerZona.mockReturnValue(false);
    const r = await confirmarCierreZona({ zonaId: UUID });
    expect(r.ok).toBe(false);
    expect(getCierrePorZona).not.toHaveBeenCalled();
  });

  it("un supervisor de OTRA zona no puede cerrar esta zona", async () => {
    getUsuarioActual.mockResolvedValue(SUPERVISOR);
    getActorActual.mockResolvedValue({ id: "u-sup", rol: "supervisor" });
    puedeVerZona.mockReturnValue(false); // no es su zona
    const r = await confirmarCierreZona({ zonaId: UUID });
    expect(r.ok).toBe(false);
    expect(getCierrePorZona).not.toHaveBeenCalled();
  });

  it("con el kill-switch activo NO se registra el handoff de efectivo", async () => {
    getUsuarioActual.mockResolvedValue(ADMIN);
    getActorActual.mockResolvedValue({ id: "u-admin", rol: "admin" });
    puedeVerZona.mockReturnValue(true);
    bloqueoSoloLectura.mockResolvedValue({ ok: false, error: "Sistema en modo solo lectura." });
    const r = await confirmarCierreZona({ zonaId: UUID });
    expect(r).toEqual({ ok: false, error: "Sistema en modo solo lectura." });
    expect(getCierrePorZona).not.toHaveBeenCalled();
  });

  it("NO sella la zona si quedan cobradores SIN RENDIR (custodia parcial)", async () => {
    getUsuarioActual.mockResolvedValue(ADMIN);
    getActorActual.mockResolvedValue({ id: "u-admin", rol: "admin" });
    puedeVerZona.mockReturnValue(true);
    // Zona con 2 cobradores pendientes de rendir: su plata sigue en la calle.
    getCierrePorZona.mockResolvedValue({
      consolidado: {
        zonas: [
          { zonaId: UUID, zonaNombre: "Centro", pendientes: 2, rendidos: 3, totalEntregado: 1000, totalEsperado: 1000 },
        ],
      },
    });
    const r = await confirmarCierreZona({ zonaId: UUID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/rendir/i);
  });
});

describe("resolverDiscrepancia — gates (triage del empalme)", () => {
  it("un supervisor (no admin) NO puede triagear una discrepancia de dinero", async () => {
    getUsuarioActual.mockResolvedValue(SUPERVISOR);
    const r = await resolverDiscrepancia({ creditoId: UUID, estado: "resuelto" });
    expect(r.ok).toBe(false);
    expect(upsertDiscrepanciaDb).not.toHaveBeenCalled();
  });

  it("un estado inválido se rechaza antes de la DB", async () => {
    getUsuarioActual.mockResolvedValue(ADMIN);
    const r = await resolverDiscrepancia({ creditoId: UUID, estado: "borrar_todo" });
    expect(r.ok).toBe(false);
    expect(upsertDiscrepanciaDb).not.toHaveBeenCalled();
  });

  it("un creditoId inválido se rechaza antes de la DB", async () => {
    getUsuarioActual.mockResolvedValue(ADMIN);
    const r = await resolverDiscrepancia({ creditoId: "x", estado: "aceptado" });
    expect(r.ok).toBe(false);
    expect(upsertDiscrepanciaDb).not.toHaveBeenCalled();
  });

  it("admin con datos válidos guarda el triage", async () => {
    getUsuarioActual.mockResolvedValue(ADMIN);
    upsertDiscrepanciaDb.mockResolvedValue(undefined);
    const r = await resolverDiscrepancia({ creditoId: UUID, estado: "aceptado", nota: "baseline Disapp" });
    expect(r.ok).toBe(true);
    expect(upsertDiscrepanciaDb).toHaveBeenCalledTimes(1);
    expect(upsertDiscrepanciaDb.mock.calls[0][1]).toMatchObject({ estado: "aceptado", adminId: "u-admin" });
  });
});
