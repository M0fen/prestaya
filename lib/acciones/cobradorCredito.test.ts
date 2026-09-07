// ─────────────────────────────────────────────────────────────────────────
//  LAS DOS PUERTAS DE LA CALLE con la regla del 06-09:
//  "por encima del +20% se coloca igual, sólo se avisa".
//
//  Hasta ese día ninguna suite ejercitaba `renovarDesdeCalle` /
//  `nuevaVentaDesdeCalle` de punta a punta: la regla vivía en tests de las
//  funciones puras y la PUERTA —la que decide si nace plata— quedaba sin
//  testigo. Acá se fija lo que importa:
//   · sobre el +20% el crédito NACE (no se pide, no se rebota) y el aviso sale
//     por los tres canales (auditoría con acción propia, push AWAITED, chat de
//     zona) — y nunca hace fallar la respuesta;
//   · dentro del +20% no se avisa nada;
//   · un monto absurdo TAMBIÉN nace (Carlos lo reafirmó sabiendo que se iba el
//     candado del dedazo): el test lo deja escrito para que nadie lo "arregle"
//     sin saber que fue una decisión;
//   · `avisado` es VERDAD: solo true si la fila del panel quedó escrita.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCION_SOBRE_TECHO } from "@/lib/data/auditoria";

const getUsuarioActual = vi.fn();
const bloqueoSoloLectura = vi.fn();
const getClientePorId = vi.fn();
const getPrestamosActivosPorCliente = vi.fn();
const getPagosDePrestamo = vi.fn();
const getUltimoCreditoDe = vi.fn();
const crearCreditoNuevoDb = vi.fn();
const crearRenovacion = vi.fn();
const cerrarSolicitudPendienteDeAnterior = vi.fn();
const registrarAuditoria = vi.fn();
const avisarGestoresDeCobrador = vi.fn();
const enviarMensajeDb = vi.fn();
const reportarError = vi.fn();

/** Doble encadenable: cualquier consulta directa devuelve lo que se le cargue
 *  por tabla (el candado gemelo mira `prestamos`; el aviso mira `usuarios`), y
 *  los INSERT directos quedan anotados (el aviso escribe `auditoria` a mano
 *  para poder saber si la fila quedó). */
let filas: Record<string, unknown[]> = {};
let inserts: { tabla: string; row: Record<string, unknown> }[] = [];
/** Si está seteado, el insert en esa tabla falla (simula la base caída). */
let insertFalla: string | null = null;
function dbFalsa(): SupabaseClient {
  return {
    from(tabla: string) {
      const chain: Record<string, unknown> = {};
      const fin = () => Promise.resolve({ data: filas[tabla] ?? [], error: null });
      for (const m of ["select", "eq", "gte", "order", "limit", "in"]) chain[m] = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: (filas[tabla] ?? [])[0] ?? null, error: null });
      chain.insert = (row: Record<string, unknown>) => {
        if (insertFalla === tabla) return Promise.resolve({ data: null, error: { message: "caída" } });
        inserts.push({ tabla, row });
        return Promise.resolve({ data: null, error: null });
      };
      chain.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => fin().then(ok, fail);
      return chain;
    },
  } as unknown as SupabaseClient;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServer: vi.fn(async () => dbFalsa()) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdmin: vi.fn(() => dbFalsa()) }));
vi.mock("@/lib/auth", () => ({ getUsuarioActual: (...a: unknown[]) => getUsuarioActual(...a) }));
vi.mock("@/lib/data/featureFlags", () => ({ bloqueoSoloLectura: (...a: unknown[]) => bloqueoSoloLectura(...a) }));
vi.mock("@/lib/data/clientes", () => ({ getClientePorId: (...a: unknown[]) => getClientePorId(...a) }));
vi.mock("@/lib/data/prestamos", () => ({
  getPrestamosActivosPorCliente: (...a: unknown[]) => getPrestamosActivosPorCliente(...a),
}));
vi.mock("@/lib/data/pagos", () => ({ getPagosDePrestamo: (...a: unknown[]) => getPagosDePrestamo(...a) }));
vi.mock("@/lib/data/renovaciones", () => ({ crearRenovacion: (...a: unknown[]) => crearRenovacion(...a) }));
vi.mock("@/lib/data/creditoNuevo", () => ({
  crearCreditoNuevoDb: (...a: unknown[]) => crearCreditoNuevoDb(...a),
  getUltimoCreditoDe: (...a: unknown[]) => getUltimoCreditoDe(...a),
}));
vi.mock("@/lib/data/solicitudesRenovacion", () => ({
  cerrarSolicitudPendienteDeAnterior: (...a: unknown[]) => cerrarSolicitudPendienteDeAnterior(...a),
}));
// La CONSTANTE de la acción queda real: es lo que comparte la puerta con el panel.
vi.mock("@/lib/data/auditoria", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a),
}));
vi.mock("@/lib/data/chat", () => ({ enviarMensajeDb: (...a: unknown[]) => enviarMensajeDb(...a) }));
vi.mock("@/lib/push/avisarGestores", () => ({
  avisarGestoresDeCobrador: (...a: unknown[]) => avisarGestoresDeCobrador(...a),
}));
vi.mock("@/lib/observabilidad", () => ({ reportarError: (...a: unknown[]) => reportarError(...a) }));
vi.mock("@/lib/data/fotos", () => ({ subirFotoCliente: vi.fn() }));

import { nuevaVentaDesdeCalle, renovarDesdeCalle } from "./cobradorCredito";

const KARENT = { id: "u-karent", nombre: "Karent Londoño", rol: "cobrador", activo: true };
const CLIENTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ANTERIOR = "c1111111-1111-4111-8111-111111111111";

/** Crédito de referencia: $10.000 · cuota $500 × 24 (tasa 20%). */
function credito(over: Record<string, unknown> = {}) {
  return {
    id: ANTERIOR,
    cliente_id: CLIENTE,
    cobrador_id: KARENT.id,
    monto_prestado: 10_000,
    cuota_diaria: 500,
    total_dias: 24,
    frecuencia: "diario",
    fecha_inicio: "2026-07-27",
    estado: "activo",
    creado_en: "2026-07-27T12:00:00Z",
    ...over,
  };
}

/** 24 cuotas de $500 = saldado (renovar exige saldado). */
const SALDADO = Array.from({ length: 24 }, (_, i) => ({
  id: `pago-${i + 1}`, prestamo_id: ANTERIOR, dia_credito: i + 1, monto: 500,
  registrado_en: "2026-08-01T13:00:00Z", anulado: false, origen: null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  filas = { prestamos: [], usuarios: [{ zona_id: "zona-1" }] };
  inserts = [];
  insertFalla = null;
  getUsuarioActual.mockResolvedValue(KARENT);
  bloqueoSoloLectura.mockResolvedValue(null);
  getClientePorId.mockResolvedValue({ id: CLIENTE, nombre: "SONIA TELIS", activo: true });
  getUltimoCreditoDe.mockResolvedValue(credito());
  getPrestamosActivosPorCliente.mockResolvedValue([credito()]);
  getPagosDePrestamo.mockResolvedValue(SALDADO);
  crearCreditoNuevoDb.mockResolvedValue({ ok: true, prestamoId: "c-nuevo", repetido: false });
  crearRenovacion.mockResolvedValue({ ok: true, prestamoId: "c-nuevo", cuota: 1000 });
  cerrarSolicitudPendienteDeAnterior.mockResolvedValue(undefined);
  registrarAuditoria.mockResolvedValue(undefined);
  avisarGestoresDeCobrador.mockResolvedValue(1);
  enviarMensajeDb.mockResolvedValue(undefined);
});

/** La fila que el panel lista: insert directo en `auditoria` con la acción compartida. */
const filaSobreTecho = () =>
  inserts.find((i) => i.tabla === "auditoria" && i.row.accion === ACCION_SOBRE_TECHO)?.row as
    | { detalle: string; actor_id: string; entidad_id: string }
    | undefined;

describe("NUEVA VENTA desde la calle, por encima del +20%", () => {
  it("$20.000 sobre un anterior de $10.000: NACE, y avisa por los tres canales", async () => {
    const r = await nuevaVentaDesdeCalle({ clienteId: CLIENTE, monto: 20_000, totalDias: 24, frecuencia: "diario" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prestamoId).toBe("c-nuevo");
      expect(r.avisado).toBe(true);
    }
    // 1) nació de verdad
    expect(crearCreditoNuevoDb).toHaveBeenCalledTimes(1);
    expect((crearCreditoNuevoDb.mock.calls[0][1] as { monto: number }).monto).toBe(20_000);
    // 2) la fila que el panel lista, con lo que la oficina necesita leer
    const aud = filaSobreTecho();
    expect(aud).toBeTruthy();
    expect(aud!.detalle).toMatch(/\$10\.000 → \$20\.000 \(\+100%\)/);
    expect(aud!.detalle).toMatch(/umbral \$12\.000/);
    expect(aud!.entidad_id).toBe(CLIENTE);
    // 3) push awaited a supervisores + admins, con tag por crédito
    expect(avisarGestoresDeCobrador).toHaveBeenCalledWith(
      KARENT.id,
      expect.objectContaining({ tag: "sobre-techo-c-nuevo", cuerpo: expect.stringMatching(/\+100%/) }),
    );
    // 4) chat de la zona (el canal que se ve sin activar nada)
    expect(enviarMensajeDb).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ambito: "zona", zonaId: "zona-1", autorId: KARENT.id }),
    );
  });

  it("dentro del +20% ($12.000 sobre $10.000): nace y NO avisa nada", async () => {
    const r = await nuevaVentaDesdeCalle({ clienteId: CLIENTE, monto: 12_000, totalDias: 24, frecuencia: "diario" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.avisado).toBe(false);
    expect(crearCreditoNuevoDb).toHaveBeenCalledTimes(1);
    expect(filaSobreTecho()).toBeUndefined();
    expect(avisarGestoresDeCobrador).not.toHaveBeenCalled();
    expect(enviarMensajeDb).not.toHaveBeenCalled();
  });

  // Regla de Carlos (06-09), reafirmada: sin techo. Se le dijo que $20.000
  // tipeado $200.000 iba a nacer como crédito; dijo "sólo debe notificar".
  it("un cero de más ($200.000 sobre $10.000) TAMBIÉN nace — decisión de Carlos, con aviso", async () => {
    const r = await nuevaVentaDesdeCalle({ clienteId: CLIENTE, monto: 200_000, totalDias: 24, frecuencia: "diario" });
    expect(r.ok).toBe(true);
    expect(crearCreditoNuevoDb).toHaveBeenCalledTimes(1);
    expect(filaSobreTecho()?.detalle).toMatch(/\+1900%/);
  });

  it("si el push explota, el crédito igual nació y el aviso sigue siendo verdad (la fila quedó)", async () => {
    avisarGestoresDeCobrador.mockRejectedValue(new Error("VAPID caído"));
    const r = await nuevaVentaDesdeCalle({ clienteId: CLIENTE, monto: 20_000, totalDias: 24, frecuencia: "diario" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prestamoId).toBe("c-nuevo");
      expect(r.avisado).toBe(false); // el try entero cae: se reporta y se dice la verdad
    }
    expect(filaSobreTecho()).toBeTruthy(); // la fila del panel se escribió ANTES del push
    expect(reportarError).toHaveBeenCalledWith("colocacionSobreTecho", expect.anything(), expect.anything());
  });

  it("si la fila del panel NO se pudo escribir, `avisado` es false: no se le miente al cobrador", async () => {
    insertFalla = "auditoria";
    const r = await nuevaVentaDesdeCalle({ clienteId: CLIENTE, monto: 20_000, totalDias: 24, frecuencia: "diario" });
    expect(r.ok).toBe(true); // el crédito nació igual
    if (r.ok) expect(r.avisado).toBe(false);
    expect(reportarError).toHaveBeenCalledWith("colocacionSobreTecho", expect.anything(), expect.anything());
  });

  it("cobrador SIN zona: el chat va al canal de supervisores (no se pierde en silencio)", async () => {
    filas.usuarios = [{ zona_id: null }];
    const r = await nuevaVentaDesdeCalle({ clienteId: CLIENTE, monto: 20_000, totalDias: 24, frecuencia: "diario" });
    expect(r.ok).toBe(true);
    expect(enviarMensajeDb).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ambito: "supervisores", zonaId: null }),
    );
  });

  it("el reintento idempotente (repetido) NO vuelve a avisar", async () => {
    crearCreditoNuevoDb.mockResolvedValue({ ok: true, prestamoId: "c-nuevo", repetido: true });
    const r = await nuevaVentaDesdeCalle({ clienteId: CLIENTE, monto: 20_000, totalDias: 24, frecuencia: "diario" });
    expect(r.ok).toBe(true);
    expect(filaSobreTecho()).toBeUndefined();
    expect(avisarGestoresDeCobrador).not.toHaveBeenCalled();
  });

  it("el PRIMER crédito sigue con su tope: $150.000 sin historial rebota", async () => {
    getUltimoCreditoDe.mockResolvedValue(null);
    const r = await nuevaVentaDesdeCalle({ clienteId: CLIENTE, monto: 150_000, totalDias: 24, frecuencia: "diario" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/primer crédito/i);
    expect(crearCreditoNuevoDb).not.toHaveBeenCalled();
  });
});

describe("RENOVAR desde la calle, por encima del +20%", () => {
  it("$20.000 sobre un saldado de $10.000: se renueva (no se pide) y avisa", async () => {
    const r = await renovarDesdeCalle({ clienteId: CLIENTE, prestamoId: ANTERIOR, monto: 20_000, cuotas: 24 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.avisado).toBe(true);
    expect(crearRenovacion).toHaveBeenCalledTimes(1);
    const args = crearRenovacion.mock.calls[0][1] as { monto: number; permitirSobreCap: boolean };
    expect(args.monto).toBe(20_000);
    expect(args.permitirSobreCap).toBe(false); // bajo el CAP de la RPC
    expect(filaSobreTecho()?.detalle).toMatch(/^Renovación:/);
  });

  it("sobre el CAP de la base ($105.000 sobre $90.000): nace con el flag para la RPC, y avisa", async () => {
    const grande = credito({ monto_prestado: 90_000, cuota_diaria: 4_500 });
    getPrestamosActivosPorCliente.mockResolvedValue([grande]);
    getPagosDePrestamo.mockResolvedValue(SALDADO.map((p) => ({ ...p, monto: 4_500 })));
    const r = await renovarDesdeCalle({ clienteId: CLIENTE, prestamoId: ANTERIOR, monto: 105_000, cuotas: 24 });
    expect(r.ok).toBe(true);
    const args = crearRenovacion.mock.calls[0][1] as { permitirSobreCap: boolean };
    expect(args.permitirSobreCap).toBe(true); // la vía de confianza que la 0146 honra
    expect(filaSobreTecho()).toBeTruthy();
  });

  it("repetir tal cual (sin monto) es continuidad: nace y NO avisa", async () => {
    const r = await renovarDesdeCalle({ clienteId: CLIENTE, prestamoId: ANTERIOR });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.avisado).toBe(false);
    expect(crearRenovacion).toHaveBeenCalledTimes(1);
    expect(filaSobreTecho()).toBeUndefined();
  });
});
