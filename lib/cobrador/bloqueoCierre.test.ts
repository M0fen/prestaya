// ─────────────────────────────────────────────────────────────────────────
//  bloqueoCierrePorCola — la regla que impide RENDIR con cobros sin subir
//  (faltante fantasma) sin dejar nunca una op atascada sin salida.
//  Antes vivía inline en CerrarJornada.tsx, sin test: un refactor podía
//  invertirla y los 1.054 tests seguían verdes.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import { bloqueoCierrePorCola } from "./bloqueoCierre";
import { MAX_INTENTOS_SYNC } from "./colaOffline";

const pago = (over: Partial<{ clienteId: string; monto: number | null; intentos: number }> = {}) => ({
  tipo: "pago",
  clienteId: "cli-1",
  monto: 500,
  intentos: 0,
  ...over,
});
const visita = (intentos = 0) => ({ tipo: "no_pago", clienteId: "cli-2", monto: null, intentos });

describe("bloqueoCierrePorCola", () => {
  it("un cobro SINCRONIZANDO bloquea el cierre (rendir sin él sella un faltante fantasma)", () => {
    const v = bloqueoCierrePorCola([pago()]);
    expect(v.bloquea).toBe(true);
    expect(v.montoPend).toBe(500);
    expect(v.clienteDeLaCola).toBe("cli-1");
  });

  it("un cobro ATASCADO (agotó reintentos) NO bloquea, pero queda listado para resolver", () => {
    const v = bloqueoCierrePorCola([pago({ intentos: MAX_INTENTOS_SYNC })]);
    expect(v.bloquea).toBe(false);
    expect(v.atascados).toHaveLength(1); // nunca desaparece en silencio
    expect(v.cobrosPend).toHaveLength(0);
  });

  it("una visita 'no pagó' atascada tampoco bloquea Y figura (la franja naranja tiene salida)", () => {
    const v = bloqueoCierrePorCola([visita(MAX_INTENTOS_SYNC)]);
    expect(v.bloquea).toBe(false);
    expect(v.atascados).toHaveLength(1);
  });

  it("una visita 'no pagó' pendiente NO bloquea el cierre (no es plata)", () => {
    const v = bloqueoCierrePorCola([visita(0)]);
    expect(v.bloquea).toBe(false);
    expect(v.atascados).toHaveLength(0);
  });

  it("mezcla real: 2 cobros pendientes + 1 atascado + 1 visita → bloquea, suma solo los pendientes", () => {
    const v = bloqueoCierrePorCola([
      pago({ monto: 500 }),
      pago({ clienteId: "cli-3", monto: 800 }),
      pago({ clienteId: "cli-4", monto: 999, intentos: MAX_INTENTOS_SYNC }),
      visita(0),
    ]);
    expect(v.bloquea).toBe(true);
    expect(v.montoPend).toBe(1300); // el atascado no infla lo "por subir"
    expect(v.atascados).toHaveLength(1);
    expect(v.clienteDeLaCola).toBe("cli-1");
  });

  it("cola vacía → no bloquea, nada listado", () => {
    const v = bloqueoCierrePorCola([]);
    expect(v.bloquea).toBe(false);
    expect(v.atascados).toHaveLength(0);
    expect(v.clienteDeLaCola).toBeNull();
  });
});
