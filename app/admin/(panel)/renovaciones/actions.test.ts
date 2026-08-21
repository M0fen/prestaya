// ─────────────────────────────────────────────────────────────────────────
//  LA CARRERA aprobar-vs-rechazar — el único ataque del arsenal que quedó
//  "sin-evidencia" en la sesión de caos (15-08): los guards existían (CAS en
//  resolverSolicitudDb + re-marca por crédito existente) y nadie los ejecutaba.
//
//  La regla que fijan estos tests: GANA LA VERDAD. Si el crédito existe, la
//  solicitud termina "aprobada" — aunque un rechazo haya ganado el UPDATE en
//  el medio. Y el que llega segundo se entera de que llegó segundo, en vez de
//  irse convencido de haber frenado un crédito que ya camina por la calle.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const getUsuarioActual = vi.fn();
const bloqueoSoloLectura = vi.fn();
const getSolicitudPorId = vi.fn();
const resolverSolicitudDb = vi.fn();
const marcarAprobadaPorCreditoExistente = vi.fn();
const cerrarSolicitudPendienteDeAnterior = vi.fn();
const getPrestamoPorId = vi.fn();
const getClientePorId = vi.fn();
const crearCreditoNuevoDb = vi.fn();
const crearRenovacion = vi.fn();
const registrarAuditoria = vi.fn();
const reportarError = vi.fn();

/** La acción solo consulta `usuarios` directo (el cobrador del pedido). */
const dbFalsa = {
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () =>
          Promise.resolve({ data: { id: "u-cobrador", rol: "cobrador", activo: true }, error: null }),
      }),
    }),
  }),
} as unknown as SupabaseClient;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServer: vi.fn(async () => dbFalsa) }));
/** Cliente ELEVADO (service_role) con marca, para saber con cuál se escribió. */
const adminFalso = { __admin: true, ...dbFalsa } as unknown as SupabaseClient;
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdmin: vi.fn(() => adminFalso) }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), // esGestor real
  getUsuarioActual: (...a: unknown[]) => getUsuarioActual(...a),
}));
vi.mock("@/lib/data/featureFlags", () => ({
  bloqueoSoloLectura: (...a: unknown[]) => bloqueoSoloLectura(...a),
}));
vi.mock("@/lib/data/solicitudesRenovacion", () => ({
  getSolicitudPorId: (...a: unknown[]) => getSolicitudPorId(...a),
  resolverSolicitudDb: (...a: unknown[]) => resolverSolicitudDb(...a),
  marcarAprobadaPorCreditoExistente: (...a: unknown[]) => marcarAprobadaPorCreditoExistente(...a),
  cerrarSolicitudPendienteDeAnterior: (...a: unknown[]) => cerrarSolicitudPendienteDeAnterior(...a),
}));
vi.mock("@/lib/data/prestamos", () => ({ getPrestamoPorId: (...a: unknown[]) => getPrestamoPorId(...a) }));
vi.mock("@/lib/data/clientes", () => ({ getClientePorId: (...a: unknown[]) => getClientePorId(...a) }));
vi.mock("@/lib/data/creditoNuevo", () => ({ crearCreditoNuevoDb: (...a: unknown[]) => crearCreditoNuevoDb(...a) }));
vi.mock("@/lib/data/renovaciones", () => ({ crearRenovacion: (...a: unknown[]) => crearRenovacion(...a) }));
vi.mock("@/lib/data/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));
vi.mock("@/lib/observabilidad", () => ({ reportarError: (...a: unknown[]) => reportarError(...a) }));
const avisarUsuario = vi.fn(async () => 0);
vi.mock("@/lib/push/avisarGestores", () => ({
  avisarUsuario: (...a: unknown[]) => avisarUsuario(...a),
  avisarGestoresDeCobrador: vi.fn(async () => 0),
}));

import { aprobarSolicitud, rechazarSolicitud, renovarCredito } from "./actions";

const GESTOR = { id: "u-gestor", nombre: "Mauricio", rol: "supervisor", activo: true };
const SOL_ID = "sol-1";

function solicitud(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: SOL_ID,
    clienteId: "cli-1",
    prestamoAnteriorId: "cred-viejo",
    tipo: "venta",
    monto: 50000,
    totalDias: 24,
    frecuencia: "diario",
    estado: "pendiente",
    solicitadoPor: "u-cobrador",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUsuarioActual.mockResolvedValue(GESTOR);
  bloqueoSoloLectura.mockResolvedValue(null);
  getSolicitudPorId.mockResolvedValue(solicitud());
  // El crédito de REFERENCIA (tasa/techo) del pedido de venta.
  getPrestamoPorId.mockResolvedValue({
    id: "cred-viejo", cliente_id: "cli-1", estado: "activo",
    monto_prestado: 50000, cuota_diaria: 2500, total_dias: 24,
  });
  getClientePorId.mockResolvedValue({ id: "cli-1", activo: true });
  crearCreditoNuevoDb.mockResolvedValue({ ok: true, prestamoId: "cred-nuevo", repetido: false });
  crearRenovacion.mockResolvedValue({ ok: true, prestamoId: "cred-nuevo", cuota: 2500 });
  resolverSolicitudDb.mockResolvedValue(true);
  marcarAprobadaPorCreditoExistente.mockResolvedValue(undefined);
});

describe("rechazar cuando OTRO ya resolvió", () => {
  it("el CAS pierde (0 filas) → error honesto, y NO se escribe 'Rechazó' en la auditoría", async () => {
    resolverSolicitudDb.mockResolvedValue(false); // otro gestor ganó el update
    const r = await rechazarSolicitud(SOL_ID, "no corresponde");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ya resolvió/i);
    // Sin esto, el segundo gestor se iba convencido de haber frenado un crédito
    // que YA estaba creado — con "Rechazó renovación" escrito en la auditoría.
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("cuando el CAS gana, rechaza normal y la auditoría dice el TIPO verdadero", async () => {
    const r = await rechazarSolicitud(SOL_ID, "monto equivocado");
    expect(r.ok).toBe(true);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accion: "Rechazó venta nueva" }),
    );
  });
});

describe("aprobar cuando el RECHAZO ganó el update — gana la verdad (el crédito existe)", () => {
  it("venta: el crédito ya se creó → se RE-MARCA aprobada por crédito existente", async () => {
    resolverSolicitudDb.mockResolvedValue(false); // el rechazo llegó primero al CAS
    const r = await aprobarSolicitud(SOL_ID);
    expect(r.ok).toBe(true);
    // La solicitud no puede quedar "rechazada" con plata ACTIVA en la calle:
    // Mis pedidos invitaría al cobrador a colocarla DE NUEVO (patrón JORGE).
    expect(marcarAprobadaPorCreditoExistente).toHaveBeenCalledWith(
      expect.anything(), SOL_ID, "cred-nuevo", GESTOR.id,
    );
  });

  it("renovación: misma reconciliación en la otra rama", async () => {
    getSolicitudPorId.mockResolvedValue(solicitud({ tipo: "renovacion" }));
    resolverSolicitudDb.mockResolvedValue(false);
    const r = await aprobarSolicitud(SOL_ID);
    expect(r.ok).toBe(true);
    expect(marcarAprobadaPorCreditoExistente).toHaveBeenCalledWith(
      expect.anything(), SOL_ID, "cred-nuevo", GESTOR.id,
    );
  });

  it("si marcar la solicitud EXPLOTA, la aprobación igual es exitosa (el crédito es la verdad) y queda rastro", async () => {
    resolverSolicitudDb.mockRejectedValue(new Error("blip"));
    const r = await aprobarSolicitud(SOL_ID);
    expect(r.ok).toBe(true); // devolver error invitaría a reintentar contra un anterior ya finalizado
    expect(reportarError).toHaveBeenCalledWith(
      "aprobarSolicitud:resolver",
      expect.anything(),
      expect.objectContaining({ solicitudId: SOL_ID }),
    );
  });
});

describe("aprobar dos veces la misma solicitud", () => {
  it("la segunda encuentra la solicitud ya resuelta → no crea nada", async () => {
    getSolicitudPorId.mockResolvedValue(solicitud({ estado: "aprobada" }));
    const r = await aprobarSolicitud(SOL_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ya no está pendiente/i);
    expect(crearCreditoNuevoDb).not.toHaveBeenCalled();
  });

  it("si las dos pasaron el chequeo a la vez, el op_id determinista devuelve el MISMO crédito y la auditoría no duplica", async () => {
    crearCreditoNuevoDb.mockResolvedValue({ ok: true, prestamoId: "cred-nuevo", repetido: true });
    const r = await aprobarSolicitud(SOL_ID);
    expect(r.ok).toBe(true);
    if (r.ok && "prestamoId" in r) expect(r.prestamoId).toBe("cred-nuevo");
    // Dos filas "Aprobó venta nueva" parecerían capital colocado DOS veces.
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe("aprobar REVALIDA el monto (es texto que escribió otra persona)", () => {
  it("venta sobre el CAP de $100.000 → no la puede aprobar nadie, y no se crea nada", async () => {
    getSolicitudPorId.mockResolvedValue(solicitud({ monto: 200000 }));
    const r = await aprobarSolicitud(SOL_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/100\.000/);
    expect(crearCreditoNuevoDb).not.toHaveBeenCalled();
  });

  it("cliente dado de baja MIENTRAS el pedido esperaba → rechazo con salida, no un crédito fantasma", async () => {
    getClientePorId.mockResolvedValue({ id: "cli-1", activo: false });
    const r = await aprobarSolicitud(SOL_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/dado de baja/i);
    expect(crearCreditoNuevoDb).not.toHaveBeenCalled();
  });

  it("VENTA con referencia CANCELADA (deshecha desde la calle) → NO se crea nada y el pedido se cierra solo", async () => {
    // El caso de la auditoría 21-08: un dedazo de $90.000 deshecho seguía siendo
    // la base de techo/tasa de la solicitud pendiente — aprobar medía contra un
    // crédito que "financieramente nunca existió".
    getPrestamoPorId.mockResolvedValue({
      id: "cred-viejo", cliente_id: "cli-1", estado: "cancelado",
      monto_prestado: 90000, cuota_diaria: 4500, total_dias: 24,
    });
    const r = await aprobarSolicitud(SOL_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/deshecho/i);
    expect(crearCreditoNuevoDb).not.toHaveBeenCalled();
    // Y no queda inflando la franja: se resuelve como rechazada con motivo.
    expect(resolverSolicitudDb).toHaveBeenCalledWith(
      expect.anything(), SOL_ID,
      expect.objectContaining({ estado: "rechazada" }),
    );
  });

  it("RENOVACIÓN cuyo anterior ya no está activo → error CON salida y el pedido se cierra solo (no infla la franja)", async () => {
    getSolicitudPorId.mockResolvedValue(solicitud({ tipo: "renovacion" }));
    getPrestamoPorId.mockResolvedValue({
      id: "cred-viejo", cliente_id: "cli-1", estado: "finalizado",
      monto_prestado: 50000, cuota_diaria: 2500, total_dias: 24,
    });
    const r = await aprobarSolicitud(SOL_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/se cerró solo/i);
    expect(crearRenovacion).not.toHaveBeenCalled();
    expect(resolverSolicitudDb).toHaveBeenCalledWith(
      expect.anything(), SOL_ID,
      expect.objectContaining({ estado: "rechazada" }),
    );
  });

  it("RENOVACIÓN con cliente dado de baja → mismo freno que la rama venta (antes faltaba)", async () => {
    getSolicitudPorId.mockResolvedValue(solicitud({ tipo: "renovacion" }));
    getClientePorId.mockResolvedValue({ id: "cli-1", activo: false });
    const r = await aprobarSolicitud(SOL_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/dado de baja/i);
    expect(crearRenovacion).not.toHaveBeenCalled();
  });
});

describe("la vuelta del circuito: el cobrador se entera de la resolución (push best-effort)", () => {
  it("aprobar una venta avisa al cobrador que la pidió", async () => {
    const r = await aprobarSolicitud(SOL_ID);
    expect(r.ok).toBe(true);
    expect(avisarUsuario).toHaveBeenCalledWith(
      "u-cobrador",
      expect.objectContaining({ titulo: expect.stringMatching(/aprobada/i) }),
    );
  });

  it("rechazar avisa al cobrador con el motivo (y que NO entregue plata)", async () => {
    const r = await rechazarSolicitud(SOL_ID, "monto equivocado");
    expect(r.ok).toBe(true);
    expect(avisarUsuario).toHaveBeenCalledWith(
      "u-cobrador",
      expect.objectContaining({ cuerpo: expect.stringMatching(/no se aprobó/i) }),
    );
  });

  it("si el push explota, la aprobación NO se cae (el crédito ya existe)", async () => {
    avisarUsuario.mockRejectedValueOnce(new Error("push caído"));
    const r = await aprobarSolicitud(SOL_ID);
    expect(r.ok).toBe(true);
  });
});


describe("sobre-CAP desde el panel: el SUPERVISOR escribe con service_role (auditoría 16-08, RPC 0146)", () => {
  // La 0146 solo honra p_permitir_sobre_cap desde service_role o un admin logueado.
  // El supervisor es aprobador legítimo (08-13) y pasó los gates → para él el
  // sobre-CAP va con el cliente ELEVADO; bajo el CAP, la sesión (cinturón RLS).
  const ANT = { id: "cred-viejo", cliente_id: "cli-1", estado: "activo", monto_prestado: 90000 };
  const base = { clienteId: "cli-1", prestamoAnteriorId: "cred-viejo", totalDias: 24, frecuencia: "diario" as const };

  it("supervisor + $105.000 sobre $90.000 (dentro del +20%) → crearRenovacion recibe el cliente ADMIN y el flag", async () => {
    getUsuarioActual.mockResolvedValue({ ...GESTOR, rol: "supervisor" });
    getPrestamoPorId.mockResolvedValue(ANT);
    crearRenovacion.mockResolvedValue({ ok: true, prestamoId: "cred-nuevo", cuota: 5000 });
    const r = await renovarCredito({ ...base, monto: 105000 });
    expect(r.ok).toBe(true);
    const [dbUsado, input] = crearRenovacion.mock.calls.at(-1)!;
    expect((dbUsado as { __admin?: boolean }).__admin).toBe(true);
    expect((input as { permitirSobreCap: boolean }).permitirSobreCap).toBe(true);
  });

  it("supervisor + $80.000 (bajo el CAP) → sesión del gestor, sin flag", async () => {
    getUsuarioActual.mockResolvedValue({ ...GESTOR, rol: "supervisor" });
    getPrestamoPorId.mockResolvedValue(ANT);
    crearRenovacion.mockResolvedValue({ ok: true, prestamoId: "cred-nuevo", cuota: 4000 });
    await renovarCredito({ ...base, monto: 80000 });
    const [dbUsado, input] = crearRenovacion.mock.calls.at(-1)!;
    expect((dbUsado as { __admin?: boolean }).__admin).toBeUndefined();
    expect((input as { permitirSobreCap: boolean }).permitirSobreCap).toBe(false);
  });

  it("admin + $105.000 → su propia sesión alcanza (0146 lo honra como admin logueado)", async () => {
    getUsuarioActual.mockResolvedValue({ ...GESTOR, rol: "admin" });
    getPrestamoPorId.mockResolvedValue(ANT);
    crearRenovacion.mockResolvedValue({ ok: true, prestamoId: "cred-nuevo", cuota: 5000 });
    await renovarCredito({ ...base, monto: 105000 });
    const [dbUsado] = crearRenovacion.mock.calls.at(-1)!;
    expect((dbUsado as { __admin?: boolean }).__admin).toBeUndefined();
  });

  it("$109.000 sobre $90.000 (> +20%) → rebota con la salida, sin tocar la base", async () => {
    getUsuarioActual.mockResolvedValue({ ...GESTOR, rol: "admin" });
    getPrestamoPorId.mockResolvedValue(ANT);
    crearRenovacion.mockClear();
    const r = await renovarCredito({ ...base, monto: 109000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/108.000/);
    expect(crearRenovacion).not.toHaveBeenCalled();
  });
});
