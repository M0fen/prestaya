// Test del reporte central de errores: delega al reporter enchufado, sobrevive a
// un reporter que lanza, y nunca tira (no puede tumbar la acción que lo llama).
import { describe, expect, it, vi, afterEach } from "vitest";
import { reportarError, setReporter, type EventoError } from "./observabilidad";

afterEach(() => setReporter(null));

describe("reportarError", () => {
  it("delega al reporter enchufado con contexto + error + extra", () => {
    const vistos: EventoError[] = [];
    setReporter((ev) => vistos.push(ev));
    const err = new Error("boom");
    reportarError("registrarPagoCobrador", err, { clienteId: "c1" });
    expect(vistos).toHaveLength(1);
    expect(vistos[0].contexto).toBe("registrarPagoCobrador");
    expect(vistos[0].error).toBe(err);
    expect(vistos[0].extra).toEqual({ clienteId: "c1" });
  });

  it("sin reporter enchufado: no lanza (solo loguea)", () => {
    setReporter(null);
    expect(() => reportarError("x", new Error("y"))).not.toThrow();
  });

  it("un reporter que LANZA no rompe la app (el observador nunca tumba la acción)", () => {
    setReporter(() => {
      throw new Error("sentry caído");
    });
    expect(() => reportarError("liquidarComision", new Error("z"))).not.toThrow();
  });

  it("acepta errores que no son Error (string/objeto con code)", () => {
    const vistos: EventoError[] = [];
    setReporter((ev) => vistos.push(ev));
    reportarError("caja", { code: "23505" });
    expect(vistos[0].error).toEqual({ code: "23505" });
  });
});
