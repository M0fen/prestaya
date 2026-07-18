import { describe, it, expect } from "vitest";
import { conTimeout, TimeoutError } from "@/lib/timeout";

const colgada = (ms = 1000) => new Promise<number>((res) => setTimeout(() => res(1), ms));

describe("conTimeout", () => {
  it("devuelve el valor si la promesa resuelve antes del tope", async () => {
    const r = await conTimeout(Promise.resolve(42), 50, "test");
    expect(r).toBe(42);
  });

  it("propaga el rechazo REAL tal cual (no lo enmascara como timeout)", async () => {
    const err = new Error("db caída");
    await expect(conTimeout(Promise.reject(err), 50, "test")).rejects.toThrow("db caída");
  });

  it("LANZA TimeoutError si la promesa se cuelga (nunca un default → nunca $0 falso)", async () => {
    await expect(conTimeout(colgada(), 20, "carga-lenta")).rejects.toBeInstanceOf(TimeoutError);
  });

  it("el TimeoutError trae la etiqueta y los ms para diagnóstico", async () => {
    await expect(conTimeout(colgada(), 15, "dashboard.resumen")).rejects.toMatchObject({
      etiqueta: "dashboard.resumen",
      ms: 15,
    });
  });

  it("no dispara el timeout cuando la promesa resuelve justo a tiempo", async () => {
    // Resuelve en ~5ms con un tope de 100ms → gana la promesa, no el timer.
    const r = await conTimeout(colgada(5), 100, "test");
    expect(r).toBe(1);
  });
});
