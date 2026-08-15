// ─────────────────────────────────────────────────────────────────────────
//  HARNESS del drenaje de la cola offline — la última pieza P1 del acta de
//  caos (15-08). Cada regla de acá nació de un incidente real: el freeze que
//  marcaba cobros reales como atascados, la op envenenada que bloqueaba el
//  cierre para siempre, el duplicado que pedía "registralo de nuevo", y el
//  par legítimo que moría como duplicado al drenar al día siguiente.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it, vi } from "vitest";
import { drenarCola, type DepsDrenaje, type ResultadoAccion } from "./drenarCola";
import { MAX_INTENTOS_SYNC, type OpCobro } from "./colaOffline";

const AHORA = Date.parse("2026-08-15T15:00:00Z");

function op(id: string, over: Partial<OpCobro> = {}): OpCobro {
  return {
    id,
    tipo: "pago",
    clienteId: "cli-1",
    clienteNombre: "Sonia",
    prestamoId: "cred-1",
    monto: 500,
    motivo: null,
    gpsLat: null,
    gpsLng: null,
    deviceTs: AHORA - 60_000,
    intentos: 0,
    ...over,
  } as OpCobro;
}

/** Deps con dobles; `respuestas` mapea op.id → resultado de la Server Action. */
function deps(respuestas: Record<string, ResultadoAccion | Error>): DepsDrenaje & {
  confirmadas: string[];
  atascadas: { id: string; motivo: string | null }[];
  intentos: string[];
  enviadas: { id: string; adelanto?: boolean }[];
} {
  const d = {
    confirmadas: [] as string[],
    atascadas: [] as { id: string; motivo: string | null }[],
    intentos: [] as string[],
    enviadas: [] as { id: string; adelanto?: boolean }[],
    registrarPago: vi.fn(async (input: { opId: string; adelanto: boolean }) => {
      d.enviadas.push({ id: input.opId, adelanto: input.adelanto });
      const r = respuestas[input.opId];
      if (r instanceof Error) throw r;
      return r ?? { ok: true };
    }),
    registrarNoPago: vi.fn(async (input: { opId: string }) => {
      d.enviadas.push({ id: input.opId });
      const r = respuestas[input.opId];
      if (r instanceof Error) throw r;
      return r ?? { ok: true };
    }),
    confirmar: (id: string) => d.confirmadas.push(id),
    marcarAtascada: (id: string, motivo: string | null) => d.atascadas.push({ id, motivo }),
    marcarIntento: (id: string) => d.intentos.push(id),
    opAtascada: (o: OpCobro) => (o.intentos ?? 0) >= MAX_INTENTOS_SYNC,
    ahora: () => AHORA,
  };
  return d;
}

describe("drenarCola · qué se envía", () => {
  it("una op RETENIDA (hold vigente) no se envía, y se informa cuándo vence", async () => {
    const d = deps({});
    const v = await drenarCola([op("a", { holdHasta: AHORA + 5_000 }), op("b")], d);
    expect(d.enviadas.map((e) => e.id)).toEqual(["b"]);
    expect(v.proximoHoldMs).toBe(5_000); // el flush se reprograma solo
  });

  it("una op ATASCADA no se reenvía (dejó de spamear; se resuelve en el cierre)", async () => {
    const d = deps({});
    await drenarCola([op("a", { intentos: MAX_INTENTOS_SYNC }), op("b")], d);
    expect(d.enviadas.map((e) => e.id)).toEqual(["b"]);
  });

  it("la visita 'no pagó' va por su acción, con su motivo", async () => {
    const d = deps({});
    await drenarCola([op("v", { tipo: "no_pago", monto: null, motivo: "no_tenia" })], d);
    expect(d.registrarNoPago).toHaveBeenCalledWith(expect.objectContaining({ motivo: "no_tenia" }));
  });
});

describe("drenarCola · los cuatro destinos de una respuesta", () => {
  it("éxito → confirmar (sale de la cola) y algunoOk (la vista refresca)", async () => {
    const d = deps({ a: { ok: true } });
    const v = await drenarCola([op("a")], d);
    expect(d.confirmadas).toEqual(["a"]);
    expect(v.algunoOk).toBe(true);
    expect(v.reintentar).toBe(false);
  });

  it("DUPLICADO → también confirmar: el primer cobro YA está en el libro (no es plata perdida)", async () => {
    const d = deps({ a: { ok: false, duplicado: true } });
    await drenarCola([op("a")], d);
    expect(d.confirmadas).toEqual(["a"]);
    expect(d.atascadas).toHaveLength(0); // atascarla haría que el cierre pida re-registrarla
  });

  it("PERMANENTE → atascada YA, con el MENSAJE del server (el que dice qué hacer con la plata)", async () => {
    const msg = "Este crédito ya está saldado. Si ya recibiste la plata, devolvésela al cliente.";
    const d = deps({ a: { ok: false, error: msg } });
    await drenarCola([op("a")], d);
    expect(d.atascadas).toEqual([{ id: "a", motivo: msg }]);
    expect(d.confirmadas).toHaveLength(0);
  });

  it("AMBIGUO (retryable) → acumula intento y pide reintento, sin cortar", async () => {
    const d = deps({ a: { ok: false, retryable: true } });
    const v = await drenarCola([op("a")], d);
    expect(d.intentos).toEqual(["a"]); // camino a MAX_INTENTOS → atascada → el cierre se destraba
    expect(v.reintentar).toBe(true);
  });
});

describe("drenarCola · freno SISTÉMICO (kill switch / sesión / red)", () => {
  it("corta el batch: las ops de atrás NI SE ENVÍAN, y nada acumula intentos", async () => {
    const d = deps({ a: { ok: false, retryable: true, sistemico: true } });
    const v = await drenarCola([op("a"), op("b"), op("c")], d);
    expect(d.enviadas.map((e) => e.id)).toEqual(["a"]); // b y c intactas
    expect(d.intentos).toHaveLength(0);
    expect(d.atascadas).toHaveLength(0); // un freeze NO marca cobros reales
    expect(v.frenoSistemico).toBe(true);
    expect(v.reintentar).toBe(true);
  });

  it("la excepción del fetch (red caída de verdad) es la misma señal", async () => {
    const d = deps({ a: new Error("fetch failed") });
    const v = await drenarCola([op("a"), op("b")], d);
    expect(d.enviadas.map((e) => e.id)).toEqual(["a"]);
    expect(v.frenoSistemico).toBe(true);
  });

  it("una AMBIGUA anterior al freno NO escala: en pleno corte nadie sabe si fue la op o la red", async () => {
    const d = deps({
      a: { ok: false, retryable: true }, // ambigua
      b: { ok: false, retryable: true, sistemico: true }, // freno
    });
    await drenarCola([op("a"), op("b")], d);
    expect(d.intentos).toHaveLength(0); // la protección anti-freeze del incidente real
  });

  it("la AMBIGUA no frena a las de atrás (anti head-of-line): la envenenada no traba a nadie", async () => {
    const d = deps({ a: { ok: false, retryable: true }, b: { ok: true } });
    const v = await drenarCola([op("a"), op("b")], d);
    expect(d.enviadas.map((e) => e.id)).toEqual(["a", "b"]);
    expect(d.confirmadas).toEqual(["b"]);
    expect(d.intentos).toEqual(["a"]);
    expect(v.algunoOk).toBe(true);
  });
});

describe("drenarCola · pares legítimos (las horas del dispositivo mandan)", () => {
  it("dos cobros reales del mismo monto a 4 h → el bypass viaja en los dos", async () => {
    const d = deps({});
    const cola = [op("a", { deviceTs: AHORA - 5 * 3600_000 }), op("b", { deviceTs: AHORA - 3600_000 })];
    await drenarCola(cola, d);
    expect(d.enviadas).toEqual([
      { id: "a", adelanto: true },
      { id: "b", adelanto: true },
    ]);
  });

  it("un doble tap (40 s) NO lleva bypass: el candado del servidor mata al segundo", async () => {
    const d = deps({});
    await drenarCola([op("a", { deviceTs: AHORA - 100_000 }), op("b", { deviceTs: AHORA - 60_000 })], d);
    expect(d.enviadas).toEqual([
      { id: "a", adelanto: false },
      { id: "b", adelanto: false },
    ]);
  });
});
