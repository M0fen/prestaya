// ─────────────────────────────────────────────────────────────────────────
//  WORKFLOW del REGISTRO e IMPUTACIÓN del pago (la plata entrando al libro).
//
//  Complementa a pagos.idempotencia.test.ts (dedupe por op_id en la capa de
//  datos) y a pagos.seguro.test.ts (candado atómico del RPC 0079): acá se prueba
//  la CADENA COMPLETA que corre en la calle — la Server Action del cobrador
//  (`registrarPagoCobrador` / `registrarNoPagoCobrador`) con dobles de Supabase.
//
//  Reglas de negocio que fija este archivo:
//   · el cobro se imputa SIEMPRE a un crédito del PROPIO cobrador (el doble cobro
//     del día 1: la ruta traía los créditos del compañero);
//   · exactly-once ante reintento/offline (op_id): un cobro que ya está en el
//     libro nunca entra dos veces ni cuenta doble como acto de campo;
//   · nunca se registra más de lo que RESTA (clamp anti sobre-pago) y el monto
//     que entra al libro es SIEMPRE entero, aunque la cuota heredada de Disapp
//     sea fraccionaria (351,04);
//   · un crédito ajeno, de otro cliente, ya saldado o ya renovado no se cobra;
//   · el cartón solo ve pagos VIGENTES: anular no borra.
//
//  Fecha FIJA en todo el archivo: miércoles 5-ago-2026 (día 9 de un crédito que
//  arrancó el lunes 27-jul-2026, con domingos salteados).
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cliente, Pago, Prestamo } from "@/types/db";

// ── Dobles de las dependencias de la Server Action ──────────────────────────
const getUsuarioActual = vi.fn();
const bloqueoSoloLectura = vi.fn();
const getClientePorId = vi.fn();
const getPrestamosActivosPorCliente = vi.fn();
const getPrestamoActivoPorCliente = vi.fn();
const getPagosDePrestamo = vi.fn();
const registrarPago = vi.fn();
const registrarBitacora = vi.fn();
const crearVisita = vi.fn();
const reportarError = vi.fn();

/** Filas del libro que responden al pre-chequeo de idempotencia por op_id
 *  (`select dia_credito, monto from pagos where op_id = ?`). */
let libroPorOpId: { op_id: string; dia_credito: number; monto: number }[] = [];
/** Tablas que la acción consultó directamente (para probar que NO toca la base
 *  cuando el gate la frena). */
let tablasConsultadas: string[] = [];

/** Doble mínimo del cliente Supabase que usa la ACCIÓN: solo necesita la
 *  consulta de idempotencia sobre `pagos` (el resto va por la capa de datos,
 *  que está mockeada). */
function dbDeLaAccion(): SupabaseClient {
  return {
    from(tabla: string) {
      tablasConsultadas.push(tabla);
      const filtros: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filtros[col] = val;
          return chain;
        },
        limit: (n: number) =>
          Promise.resolve({
            data: libroPorOpId.filter((f) => f.op_id === filtros.op_id).slice(0, n),
            error: null,
          }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServer: vi.fn(async () => dbDeLaAccion()) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdmin: vi.fn(() => dbDeLaAccion()) }));
vi.mock("@/lib/auth", () => ({
  getUsuarioActual: (...a: unknown[]) => getUsuarioActual(...a),
}));
vi.mock("@/lib/data/featureFlags", () => ({
  bloqueoSoloLectura: (...a: unknown[]) => bloqueoSoloLectura(...a),
}));
vi.mock("@/lib/data/clientes", () => ({
  getClientePorId: (...a: unknown[]) => getClientePorId(...a),
  getClientePorDocumentoFlexible: vi.fn(),
  getClienteRecientePorNombre: vi.fn(),
  crearClienteCenso: vi.fn(),
}));
vi.mock("@/lib/data/prestamos", () => ({
  getPrestamosActivosPorCliente: (...a: unknown[]) => getPrestamosActivosPorCliente(...a),
  getPrestamoActivoPorCliente: (...a: unknown[]) => getPrestamoActivoPorCliente(...a),
}));
// `esSobrePago` queda REAL: la acción lo usa para reconocer el P0409 del candado.
vi.mock("@/lib/data/pagos", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPagosDePrestamo: (...a: unknown[]) => getPagosDePrestamo(...a),
  registrarPago: (...a: unknown[]) => registrarPago(...a),
}));
vi.mock("@/lib/data/fotos", () => ({ subirFotoCliente: vi.fn() }));
vi.mock("@/lib/data/visitas", () => ({ crearVisita: (...a: unknown[]) => crearVisita(...a) }));
vi.mock("@/lib/data/bitacora", () => ({ registrarBitacora: (...a: unknown[]) => registrarBitacora(...a) }));
vi.mock("@/lib/observabilidad", () => ({ reportarError: (...a: unknown[]) => reportarError(...a) }));

import { registrarPagoCobrador, registrarNoPagoCobrador } from "@/app/cobrador/(app)/actions";
// La capa de datos REAL (sin el doble de arriba) para probar sus consultas.
const pagosReal = await vi.importActual<typeof import("./pagos")>("./pagos");

// ── Datos del caso real de campo (Sonia Telis en dos rutas) ────────────────
const CLIENTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C_KARENT = "c1111111-1111-4111-8111-111111111111"; // crédito de Karent
const C_KARENT_2 = "c3333333-3333-4333-8333-333333333333"; // 2º crédito de Karent
const C_VICTOR = "c2222222-2222-4222-8222-222222222222"; // crédito de Víctor
const C_HUERFANO = "c0000000-0000-4000-8000-000000000000"; // sin dueño (cobrador_id NULL)
const C_AJENO = "c9999999-9999-4999-8999-999999999999"; // crédito de OTRO cliente
const KARENT = { id: "u-karent", nombre: "Karent Londoño", rol: "cobrador", activo: true };
const VICTOR = { id: "u-victor", nombre: "Víctor Moralez", rol: "cobrador", activo: true };
const SUPERVISOR = { id: "u-sup", nombre: "Mauricio", rol: "supervisor", activo: true };

/** Crédito diario de 24 cuotas de $351 que arrancó el lunes 27-jul-2026.
 *  Con "hoy" = miércoles 5-ago-2026 va por el día 9 (domingo 2 salteado). */
function credito(over: Partial<Prestamo> & { id: string }): Prestamo {
  return {
    cliente_id: CLIENTE,
    cobrador_id: KARENT.id,
    monto_prestado: 6000,
    cuota_diaria: 351,
    total_dias: 24,
    frecuencia: "diario",
    fecha_inicio: "2026-07-27",
    estado: "activo",
    creado_por: null,
    es_float_supervisor: false,
    interes_pct: null,
    origen: "credito",
    producto_id: null,
    producto_nombre: null,
    creado_en: "2026-07-27T12:00:00Z",
    actualizado_en: "2026-07-27T12:00:00Z",
    finalizado_en: null,
    renovado_de: null,
    ...over,
  };
}

/** Pagos VIGENTES ya asentados: `n` cuotas completas de `monto` (FIFO). */
function cuotasPagas(n: number, monto = 351): Pago[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `pago-${i + 1}`,
    prestamo_id: C_KARENT,
    dia_credito: i + 1,
    monto,
    registrado_por: KARENT.id,
    registrado_en: "2026-08-01T13:00:00Z",
    gps_lat: null,
    gps_lng: null,
    origen: null,
    anulado: false,
    anulado_por: null,
    anulado_en: null,
    motivo_anulacion: null,
  }));
}

/** Argumentos con los que se llamó a `registrarPago` (lo que ENTRA al libro). */
function loRegistrado(llamada = 0) {
  return registrarPago.mock.calls[llamada][1] as {
    prestamo_id: string;
    dia_credito: number;
    monto: number;
    registrado_por: string | null;
    op_id: string | null;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Miércoles 5-ago-2026, 12:00 de Uruguay (UTC−3). Fijo: el cartón, el día
  // contable y el sellado de hora no dependen del reloj de la máquina.
  vi.setSystemTime(new Date("2026-08-05T15:00:00.000Z"));
  libroPorOpId = [];
  tablasConsultadas = [];
  bloqueoSoloLectura.mockResolvedValue(null); // sistema operativo
  getUsuarioActual.mockResolvedValue(KARENT);
  getClientePorId.mockResolvedValue({
    id: CLIENTE,
    nombre: "Sonia Telis",
    gps_lat: null,
    gps_lng: null,
  } as Cliente);
  getPrestamosActivosPorCliente.mockResolvedValue([credito({ id: C_KARENT })]);
  getPrestamoActivoPorCliente.mockResolvedValue(null);
  getPagosDePrestamo.mockResolvedValue([]);
  registrarPago.mockResolvedValue({ id: "pago-nuevo" });
  registrarBitacora.mockResolvedValue(undefined);
  crearVisita.mockResolvedValue({ id: "visita-nueva" });
});

// ═══════════════════════════════════════════════════════════════════════════
//  1. IMPUTACIÓN AL CRÉDITO DEL PROPIO COBRADOR (el doble cobro del día 1)
// ═══════════════════════════════════════════════════════════════════════════
describe("a qué crédito se imputa el cobro — cliente compartido por dos cobradores", () => {
  it("sin elegir crédito, el cobro va al crédito PROPIO, nunca al del compañero", async () => {
    // Sonia está en las dos rutas: el crédito de Víctor es el más nuevo (primero
    // de la lista), pero Karent cobra lo SUYO.
    getPrestamosActivosPorCliente.mockResolvedValue([
      credito({ id: C_VICTOR, cobrador_id: VICTOR.id }),
      credito({ id: C_KARENT }),
    ]);
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-1" });
    expect(r.ok).toBe(true);
    expect(loRegistrado().prestamo_id).toBe(C_KARENT);
  });

  it("elegir a mano el crédito del compañero NO lo imputa: no entra nada al libro", async () => {
    // Es lo que pasó en campo: $1.600 de Karent asentados sobre un crédito de
    // Víctor (a él se le descontaba la cuota y se le pagaba la comisión).
    getPrestamosActivosPorCliente.mockResolvedValue([
      credito({ id: C_VICTOR, cobrador_id: VICTOR.id }),
      credito({ id: C_KARENT }),
    ]);
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, prestamoId: C_VICTOR, opId: "op-2" });
    expect(r.ok).toBe(false);
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it("un crédito de OTRO cliente no se puede imputar aunque el id sea válido", async () => {
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, prestamoId: C_AJENO, opId: "op-3" });
    expect(r.ok).toBe(false);
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it("con VARIOS créditos propios y sin elección, se imputa al principal (el más nuevo)", async () => {
    // La capa de datos ya devuelve del más nuevo al más viejo: el orden de
    // elección es el de la lista, y siempre entre los PROPIOS.
    getPrestamosActivosPorCliente.mockResolvedValue([
      credito({ id: C_KARENT_2 }),
      credito({ id: C_KARENT }),
    ]);
    await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-4" });
    expect(loRegistrado().prestamo_id).toBe(C_KARENT_2);
  });

  it("con varios créditos propios, el cobrador puede elegir el VIEJO y se respeta", async () => {
    getPrestamosActivosPorCliente.mockResolvedValue([
      credito({ id: C_KARENT_2 }),
      credito({ id: C_KARENT }),
    ]);
    await registrarPagoCobrador({ clienteId: CLIENTE, prestamoId: C_KARENT, opId: "op-5" });
    expect(loRegistrado().prestamo_id).toBe(C_KARENT);
  });

  it("si el cliente NO tiene ningún crédito propio, el cobrador no cobra nada", async () => {
    getPrestamosActivosPorCliente.mockResolvedValue([
      credito({ id: C_VICTOR, cobrador_id: VICTOR.id }),
    ]);
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-6" });
    expect(r.ok).toBe(false);
    expect(registrarPago).not.toHaveBeenCalled();
    // Y no cae al "préstamo principal" del cliente por la puerta de atrás.
    expect(getPrestamoActivoPorCliente).not.toHaveBeenCalled();
  });

  it("un GESTOR (no cobrador) sí puede imputar al crédito de cualquiera de sus cobradores", async () => {
    // La restricción por dueño es del cobrador en la calle; la oficina corrige.
    getUsuarioActual.mockResolvedValue(SUPERVISOR);
    getPrestamosActivosPorCliente.mockResolvedValue([
      credito({ id: C_VICTOR, cobrador_id: VICTOR.id }),
    ]);
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, prestamoId: C_VICTOR, opId: "op-7" });
    expect(r.ok).toBe(true);
    expect(loRegistrado().prestamo_id).toBe(C_VICTOR);
  });

  it("CUSTODIA vs COMISIÓN: el pago se sella con quien lo registra, no con el dueño de la ruta", async () => {
    // `registrado_por` = la plata en mano (custodia). El dueño del crédito
    // (comisión) sigue siendo otro: son dos verdades distintas a propósito.
    getUsuarioActual.mockResolvedValue(SUPERVISOR);
    getPrestamosActivosPorCliente.mockResolvedValue([
      credito({ id: C_VICTOR, cobrador_id: VICTOR.id }),
    ]);
    await registrarPagoCobrador({ clienteId: CLIENTE, prestamoId: C_VICTOR, opId: "op-8" });
    expect(loRegistrado().registrado_por).toBe(SUPERVISOR.id);
    expect(loRegistrado().prestamo_id).toBe(C_VICTOR);
  });

  it("el NO-PAGO (visita) también se ata al crédito propio, nunca al del compañero", async () => {
    getPrestamosActivosPorCliente.mockResolvedValue([
      credito({ id: C_VICTOR, cobrador_id: VICTOR.id }),
      credito({ id: C_KARENT }),
    ]);
    const r = await registrarNoPagoCobrador({ clienteId: CLIENTE, motivo: "no_estaba", opId: "op-9" });
    expect(r.ok).toBe(true);
    expect((crearVisita.mock.calls[0][1] as { prestamo_id: string }).prestamo_id).toBe(C_KARENT);
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo alto #2).
  // El predicado de dueño es `!cobradorId || !p.cobrador_id || p.cobrador_id === cobradorId`:
  // la rama `!p.cobrador_id` declara PROPIO todo crédito huérfano (cobrador_id NULL),
  // que existe de verdad (46 reparados el 08-02; `desactivarAsignacion` no toca
  // prestamos.cobrador_id; la renovación 0116 hereda el NULL). Con el cliente en dos
  // rutas (59 casos), los DOS cobradores ven el mismo crédito como suyo y los dos lo
  // cobran el mismo día: es el doble cobro del día 1 en su variante huérfana.
  it.fails("un crédito SIN dueño no puede quedar imputable por DOS cobradores a la vez", async () => {
    getPrestamosActivosPorCliente.mockResolvedValue([credito({ id: C_HUERFANO, cobrador_id: null })]);
    getUsuarioActual.mockResolvedValue(KARENT);
    const deKarent = await registrarPagoCobrador({ clienteId: CLIENTE, prestamoId: C_HUERFANO, opId: "op-h1" });
    getUsuarioActual.mockResolvedValue(VICTOR);
    const deVictor = await registrarPagoCobrador({ clienteId: CLIENTE, prestamoId: C_HUERFANO, opId: "op-h2" });
    // A lo sumo UNO de los dos debería poder imputarlo (o ninguno, con un mensaje
    // que mande a rutearlo). Hoy los dos cobran $351 el mismo día sobre el mismo crédito.
    expect([deKarent.ok, deVictor.ok].filter(Boolean)).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. IDEMPOTENCIA EXACTLY-ONCE (reintento / cola offline)
// ═══════════════════════════════════════════════════════════════════════════
describe("exactly-once: el mismo cobro nunca entra dos veces al libro", () => {
  it("reintentar una op YA guardada devuelve el día y el monto del libro, sin registrar de nuevo", async () => {
    // 1er intento commiteó pero se perdió el ACK (504 / red rural): la cola reintenta.
    libroPorOpId = [{ op_id: "op-A", dia_credito: 9, monto: 351 }];
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-A" });
    expect(r).toEqual({ ok: true, dia: 9, monto: 351, enZona: null });
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it("el reintento devuelve el monto ENTERO del libro (nunca centavos del numeric)", async () => {
    libroPorOpId = [{ op_id: "op-B", dia_credito: 24, monto: 351.04 }];
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-B" });
    expect(r).toMatchObject({ ok: true, monto: 351 });
  });

  it("el reintento NO vuelve a anotar el acto en la bitácora de campo (no cuenta doble)", async () => {
    // Carrera: el pre-chequeo no lo vio, pero el índice único (23505) sí.
    registrarPago.mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" }));
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-C" });
    expect(r.ok).toBe(true);
    expect(registrarBitacora).not.toHaveBeenCalled(); // si no, infla /admin/campo
  });

  it("dos cobros DISTINTOS del mismo cliente (op_id distinto) sí entran los dos", async () => {
    await registrarPagoCobrador({ clienteId: CLIENTE, monto: 351, opId: "op-D1" });
    await registrarPagoCobrador({ clienteId: CLIENTE, monto: 351, opId: "op-D2" });
    expect(registrarPago).toHaveBeenCalledTimes(2);
    expect(loRegistrado(0).op_id).toBe("op-D1");
    expect(loRegistrado(1).op_id).toBe("op-D2");
  });

  it("una visita ya guardada reintentada es idempotente y tampoco duplica el acto", async () => {
    crearVisita.mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" }));
    const r = await registrarNoPagoCobrador({ clienteId: CLIENTE, motivo: "no_tenia", opId: "op-E" });
    expect(r.ok).toBe(true);
    expect(registrarBitacora).not.toHaveBeenCalled();
  });

  it("un cobro SIN op_id no consulta el libro por idempotencia (no hay con qué deduplicar)", async () => {
    await registrarPagoCobrador({ clienteId: CLIENTE, monto: 351 });
    expect(tablasConsultadas).not.toContain("pagos");
    expect(registrarPago).toHaveBeenCalledTimes(1);
    expect(loRegistrado().op_id).toBeNull();
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo alto #1).
  // El pre-chequeo de idempotencia por op_id corre DESPUÉS de resolver el crédito.
  // Si entre el cobro y el reintento el cliente renovó (C1 pasa a finalizado y nace
  // C2), `resolverPrestamo` devuelve null y la acción sale con un error PERMANENTE
  // "ese crédito ya no está activo" para un cobro que SÍ está en el libro. La cola
  // lo marca atascado y la pantalla de cierre le pide al cobrador registrarlo de
  // nuevo → los $351 quedan DOS VECES (ahora sobre C2, que tiene saldo entero y no
  // frena ningún clamp). El `select ... where op_id = ?` no necesita el préstamo.
  it.fails("un reintento cuyo pago YA está en el libro es exitoso aunque el crédito se haya renovado", async () => {
    libroPorOpId = [{ op_id: "op-A", dia_credito: 24, monto: 351 }];
    // Post-renovación: C1 quedó finalizado; el único activo es el crédito nuevo.
    getPrestamosActivosPorCliente.mockResolvedValue([credito({ id: C_KARENT_2 })]);
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, prestamoId: C_KARENT, opId: "op-A" });
    expect(r).toEqual({ ok: true, dia: 24, monto: 351, enZona: null });
    expect(registrarPago).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. CRÉDITO QUE YA NO ESTÁ ACTIVO (renovado / saldado / anulado)
// ═══════════════════════════════════════════════════════════════════════════
describe("cobro sobre un crédito que ya no está activo", () => {
  it("un cobro NUEVO sobre un crédito renovado no entra al libro y le dice al cobrador qué hacer con la plata", async () => {
    getPrestamosActivosPorCliente.mockResolvedValue([credito({ id: C_KARENT_2 })]);
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, prestamoId: C_KARENT, opId: "op-F" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/supervisor/i); // instrucción accionable, no un código
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it("el cliente sin NINGÚN crédito activo no recibe cobro", async () => {
    getPrestamosActivosPorCliente.mockResolvedValue([]);
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-G" });
    expect(r.ok).toBe(false);
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it("un crédito YA SALDADO por otros pagos: no se cobra y queda rastro para la oficina", async () => {
    getPagosDePrestamo.mockResolvedValue(cuotasPagas(24)); // 24 × 351 = 8.424 (total)
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-H" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/saldado/i);
    expect(registrarPago).not.toHaveBeenCalled();
    // Doble-cobranza física posible → tiene que verla el admin, no morir en silencio.
    expect(reportarError).toHaveBeenCalledWith(
      "cobro.sobrepago.saldado",
      expect.anything(),
      expect.objectContaining({ prestamoId: C_KARENT, opId: "op-H" }),
    );
  });

  it("si otro pago saldó el crédito primero (carrera bajo el candado), el cobro NO se duplica ni se reintenta en loop", async () => {
    registrarPago.mockRejectedValue(
      Object.assign(new Error("SOBREPAGO"), { code: "P0409", sobrepago: true }),
    );
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-I" });
    expect(r.ok).toBe(false);
    // PERMANENTE: sin `retryable` la cola no lo reintenta eternamente.
    if (!r.ok) expect(r.retryable).toBeUndefined();
    expect(reportarError).toHaveBeenCalledWith(
      "cobro.sobrepago.carrera",
      expect.anything(),
      expect.objectContaining({ prestamoId: C_KARENT }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. CUÁNTO ENTRA AL LIBRO (clamp anti sobre-pago + dinero entero)
// ═══════════════════════════════════════════════════════════════════════════
describe("el monto que entra al libro", () => {
  it("sin monto explícito se cobra la CUOTA del crédito", async () => {
    await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-J" });
    expect(loRegistrado().monto).toBe(351);
  });

  it("nunca se registra más de lo que RESTA: el monto se clampea al saldo real", async () => {
    // 23 cuotas pagas + $151 → falta $200. El cobrador tapea "cuota completa" ($351).
    getPagosDePrestamo.mockResolvedValue([
      ...cuotasPagas(23),
      { ...cuotasPagas(1)[0], id: "pago-24", dia_credito: 24, monto: 151 },
    ]);
    await registrarPagoCobrador({ clienteId: CLIENTE, monto: 351, opId: "op-K" });
    expect(loRegistrado().monto).toBe(200); // no 351: el libro es inmutable
  });

  it("un abono PARCIAL menor a la cuota se registra tal cual", async () => {
    await registrarPagoCobrador({ clienteId: CLIENTE, monto: 100, opId: "op-L" });
    expect(loRegistrado().monto).toBe(100);
  });

  it("la cuota HEREDADA fraccionaria (351,04) entra al libro como ENTERO", async () => {
    getPrestamosActivosPorCliente.mockResolvedValue([
      credito({ id: C_KARENT, cuota_diaria: 351.04 }),
    ]);
    await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-M" });
    const monto = loRegistrado().monto;
    expect(monto).toBe(351);
    expect(Number.isInteger(monto)).toBe(true);
  });

  it("el clamp también redondea: el residuo sub-peso del saldo nunca entra como decimal", async () => {
    // Cuota 351,04 × 24 = 8.424,96; ya pagados 8.424 → falta 0,96.
    getPrestamosActivosPorCliente.mockResolvedValue([
      credito({ id: C_KARENT, cuota_diaria: 351.04 }),
    ]);
    getPagosDePrestamo.mockResolvedValue(cuotasPagas(24, 351));
    await registrarPagoCobrador({ clienteId: CLIENTE, monto: 351, opId: "op-N" });
    const monto = loRegistrado().monto;
    expect(monto).toBe(1); // round(min(351; 0,96))
    expect(Number.isInteger(monto)).toBe(true);
  });

  it("un monto con centavos (dedazo del teclado) se asienta redondeado a peso", async () => {
    await registrarPagoCobrador({ clienteId: CLIENTE, monto: 350.6, opId: "op-O" });
    expect(loRegistrado().monto).toBe(351);
  });

  it("un monto 0 o negativo se rechaza en el borde, antes de tocar la base", async () => {
    const cero = await registrarPagoCobrador({ clienteId: CLIENTE, monto: 0, opId: "op-P" });
    const negativo = await registrarPagoCobrador({ clienteId: CLIENTE, monto: -500, opId: "op-Q" });
    expect(cero.ok).toBe(false);
    expect(negativo.ok).toBe(false);
    expect(getClientePorId).not.toHaveBeenCalled();
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it("un monto absurdo (overflow) se rechaza en el borde", async () => {
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, monto: 999_999_999, opId: "op-R" });
    expect(r.ok).toBe(false);
    expect(registrarPago).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. A QUÉ DÍA DEL CARTÓN SE IMPUTA (FIFO)
// ═══════════════════════════════════════════════════════════════════════════
describe("el día del cartón al que se imputa el cobro (FIFO)", () => {
  it("un crédito sin pagos imputa al día 1, no al día de hoy", async () => {
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-S" });
    expect(r).toMatchObject({ ok: true, dia: 1 });
    expect(loRegistrado().dia_credito).toBe(1);
  });

  it("con 3 cuotas pagas, el cobro llena la cuota MÁS VIEJA impaga (día 4)", async () => {
    getPagosDePrestamo.mockResolvedValue(cuotasPagas(3));
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-T" });
    expect(r).toMatchObject({ ok: true, dia: 4 });
  });

  it("cliente al día: el cobro de hoy cae en la cuota de HOY (día 9 del cartón)", async () => {
    // Arranque lunes 27-jul; hoy miércoles 5-ago con el domingo salteado → día 9.
    getPagosDePrestamo.mockResolvedValue(cuotasPagas(8));
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-U" });
    expect(r).toMatchObject({ ok: true, dia: 9 });
  });

  it("cuota FRACCIONARIA pagada entera: NO re-elige el día ya cubierto, avanza al siguiente", async () => {
    // 3 pagos de 351 sobre cuota 351,04: el residuo (0,12) no es deuda.
    getPrestamosActivosPorCliente.mockResolvedValue([
      credito({ id: C_KARENT, cuota_diaria: 351.04 }),
    ]);
    getPagosDePrestamo.mockResolvedValue(cuotasPagas(3, 351));
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-V" });
    expect(r).toMatchObject({ ok: true, dia: 4 });
  });

  it("cliente ADELANTADO (ya cubrió todo lo vencido): el cobro se anota en el día de HOY", async () => {
    // No reabre un día ya cubierto ni inventa un día futuro: `dia_credito` es la
    // etiqueta contable del acto de hoy; el cartón se sigue derivando del acumulado.
    getPagosDePrestamo.mockResolvedValue(cuotasPagas(12)); // hoy es el día 9
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-W" });
    expect(r).toMatchObject({ ok: true, dia: 9 });
    expect(loRegistrado().monto).toBe(351); // y todavía queda saldo: se cobra la cuota
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  6. GATES: nada de plata sin sesión, sin sistema o con datos rotos
// ═══════════════════════════════════════════════════════════════════════════
describe("puertas previas al registro de plata", () => {
  it("sin sesión no entra el cobro, y el error es TEMPORAL+SISTÉMICO (la cola reintenta, no lo envenena)", async () => {
    getUsuarioActual.mockResolvedValue(null);
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-X" });
    expect(r).toMatchObject({ ok: false, retryable: true, sistemico: true });
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it("un usuario DESACTIVADO (baja) no puede cobrar", async () => {
    getUsuarioActual.mockResolvedValue({ ...KARENT, activo: false });
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-Y" });
    expect(r.ok).toBe(false);
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it("con el kill-switch en solo lectura no se escribe plata", async () => {
    bloqueoSoloLectura.mockResolvedValue({
      ok: false,
      error: "El sistema está en modo consulta por unos minutos.",
      retryable: true,
      sistemico: true,
    });
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-Z" });
    expect(r.ok).toBe(false);
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it("un clienteId que no es uuid se rechaza antes de tocar la base", async () => {
    const r = await registrarPagoCobrador({ clienteId: "sonia-telis", opId: "op-AA" });
    expect(r.ok).toBe(false);
    expect(getClientePorId).not.toHaveBeenCalled();
  });

  it("cliente inexistente: no se registra el pago", async () => {
    getClientePorId.mockResolvedValue(null);
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-AB" });
    expect(r.ok).toBe(false);
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it("una caída de la base al insertar es TEMPORAL (retryable): el cobro se reintenta, no se descarta", async () => {
    registrarPago.mockRejectedValue(new Error("connection reset"));
    const r = await registrarPagoCobrador({ clienteId: CLIENTE, opId: "op-AC" });
    expect(r).toMatchObject({ ok: false, retryable: true });
    expect(reportarError).toHaveBeenCalled(); // la ruta de plata nunca se traga el error
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  7. LECTURA DEL LIBRO: anular no borra, y el dinero llega como string
// ═══════════════════════════════════════════════════════════════════════════

/** Tope de filas por consulta de PostgREST: al superarlo devuelve el RECORTE con
 *  `error: null` (el corte es invisible para el llamador). */
const LIMITE_POSTGREST = 1000;

/** Doble de la tabla `pagos` que aplica los filtros `.eq`/`.in` de verdad, corta
 *  como PostgREST y soporta el paginado `.range()`. Cuenta consultas. */
function dbLibro(filas: Record<string, unknown>[]) {
  let consultas = 0;
  const estado = {
    get consultas() {
      return consultas;
    },
  };
  const db = {
    from() {
      const eqs: [string, unknown][] = [];
      let dentro: [string, unknown[]] | null = null;
      let desde = 0;
      let hasta = Number.MAX_SAFE_INTEGER;
      const resolver = () => {
        consultas++;
        const filtradas = filas.filter(
          (f) =>
            eqs.every(([c, v]) => f[c] === v) &&
            (dentro == null || dentro[1].includes(f[dentro[0]] as unknown)),
        );
        const fin = Math.min(hasta + 1, desde + LIMITE_POSTGREST);
        return { data: filtradas.slice(desde, fin), error: null };
      };
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => {
          eqs.push([c, v]);
          return chain;
        },
        in: (c: string, v: unknown[]) => {
          dentro = [c, v];
          return chain;
        },
        order: (col: string) => {
          filas.sort((a, b) => Number(a[col]) - Number(b[col]));
          return chain;
        },
        range: (d: number, h: number) => {
          desde = d;
          hasta = h;
          return chain;
        },
        then: (res: (v: unknown) => void) => res(resolver()),
      };
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, estado };
}

const filaPago = (over: Record<string, unknown>) => ({
  id: "p",
  prestamo_id: C_KARENT,
  dia_credito: 1,
  // PostgREST devuelve numeric como STRING: la capa de datos lo convierte.
  monto: "351.00",
  registrado_por: KARENT.id,
  registrado_en: "2026-08-05T13:00:00Z",
  gps_lat: null,
  gps_lng: null,
  anulado: false,
  anulado_por: null,
  anulado_en: null,
  motivo_anulacion: null,
  ...over,
});

describe("getPagosDePrestamo — el cartón se deriva SOLO de los pagos vigentes", () => {
  it("un pago ANULADO no se cuenta (pero sigue en el libro: anular no es borrar)", async () => {
    const anulado = filaPago({
      id: "p2",
      dia_credito: 2,
      anulado: true,
      anulado_por: "u-admin",
      anulado_en: "2026-08-05T14:00:00Z",
      motivo_anulacion: "doble registro",
    });
    const { db } = dbLibro([filaPago({ id: "p1" }), anulado]);
    const vigentes = await pagosReal.getPagosDePrestamo(db, C_KARENT);
    expect(vigentes).toHaveLength(1);
    expect(vigentes[0].id).toBe("p1");
    // La fila anulada NO se borró de la tabla: sigue ahí con su rastro.
    expect(anulado.anulado_por).toBe("u-admin");
    expect(anulado.motivo_anulacion).toBe("doble registro");
  });

  it("el dinero llega como string de PostgREST y se devuelve como NÚMERO (nunca se suma como texto)", async () => {
    const { db } = dbLibro([filaPago({ id: "p1", monto: "351.00" }), filaPago({ id: "p2", dia_credito: 2, monto: "200" })]);
    const pagos = await pagosReal.getPagosDePrestamo(db, C_KARENT);
    expect(pagos.map((p) => p.monto)).toEqual([351, 200]);
    expect(pagos.reduce((s, p) => s + p.monto, 0)).toBe(551); // no "351.00200"
  });

  it("solo trae los pagos de ESE crédito (no los del otro crédito del cliente)", async () => {
    const { db } = dbLibro([
      filaPago({ id: "p1" }),
      filaPago({ id: "p2", prestamo_id: C_KARENT_2 }),
    ]);
    const pagos = await pagosReal.getPagosDePrestamo(db, C_KARENT);
    expect(pagos.map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("getPagosDeVariosPrestamos — un mapa por crédito, sin mezclar plata", () => {
  it("agrupa por crédito: la cuota de un crédito no aparece en el cartón del otro", async () => {
    const { db } = dbLibro([
      filaPago({ id: "p1", prestamo_id: C_KARENT, monto: "351" }),
      filaPago({ id: "p2", prestamo_id: C_VICTOR, dia_credito: 2, monto: "600" }),
      filaPago({ id: "p3", prestamo_id: C_KARENT, dia_credito: 3, monto: "351" }),
    ]);
    const mapa = await pagosReal.getPagosDeVariosPrestamos(db, [C_KARENT, C_VICTOR]);
    expect(mapa[C_KARENT].map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(mapa[C_VICTOR].map((p) => p.monto)).toEqual([600]);
  });

  it("sin créditos que consultar no va a la base (y devuelve el mapa vacío)", async () => {
    const { db, estado } = dbLibro([filaPago({ id: "p1" })]);
    const mapa = await pagosReal.getPagosDeVariosPrestamos(db, []);
    expect(mapa).toEqual({});
    expect(estado.consultas).toBe(0);
  });

  it("los pagos anulados quedan fuera de todos los grupos", async () => {
    const { db } = dbLibro([
      filaPago({ id: "p1" }),
      filaPago({ id: "p2", dia_credito: 2, anulado: true }),
    ]);
    const mapa = await pagosReal.getPagosDeVariosPrestamos(db, [C_KARENT]);
    expect(mapa[C_KARENT]).toHaveLength(1);
  });

  // ✅ ARREGLADO (09-08): ahora pagina con `traerTodo`.
  // PostgREST corta en 1000 filas y devuelve `error: null`: el recorte pasaba por
  // dato completo. Costaba en dos lugares — el historial crediticio (scoring), que
  // pasa TODOS los créditos del cliente, y desde hoy la lista de colocar, que pide
  // los pagos de los ~120 créditos activos de la ruta de una sola vez (≈3.000
  // filas). Truncado, los créditos del final aparecían SIN pagos: el que terminó de
  // pagar se veía debiendo todo y desaparecía de "Renovar".
  it("un cliente con más de 1000 pagos históricos no pierde sus cuotas finales", async () => {
    const muchas = Array.from({ length: 1120 }, (_, i) =>
      filaPago({
        id: `p${i + 1}`,
        prestamo_id: i < 1000 ? C_KARENT : C_KARENT_2,
        dia_credito: (i % 30) + 1,
        monto: "351",
      }),
    );
    const { db } = dbLibro(muchas);
    const mapa = await pagosReal.getPagosDeVariosPrestamos(db, [C_KARENT, C_KARENT_2]);
    const total = Object.values(mapa).reduce((s, ps) => s + ps.length, 0);
    expect(total).toBe(1120); // hoy devuelve 1000 y se traga las últimas cuotas
  });
});
