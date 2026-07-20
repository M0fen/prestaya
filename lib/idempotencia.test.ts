import { describe, it, expect } from "vitest";
import { opIdDeterminista, esViolacionUnica, esUuid, PG_UNIQUE_VIOLATION } from "./idempotencia";

describe("opIdDeterminista", () => {
  it("es ESTABLE: las mismas partes dan el mismo uuid (idempotencia del reintento)", () => {
    const a = opIdDeterminista("comision", "cob-1", "mes:2026-07");
    const b = opIdDeterminista("comision", "cob-1", "mes:2026-07");
    expect(a).toBe(b);
  });

  it("distingue eventos distintos (cobrador o período diferente → uuid diferente)", () => {
    const base = opIdDeterminista("comision", "cob-1", "mes:2026-07");
    expect(opIdDeterminista("comision", "cob-2", "mes:2026-07")).not.toBe(base);
    expect(opIdDeterminista("comision", "cob-1", "mes:2026-08")).not.toBe(base);
    expect(opIdDeterminista("gasto", "cob-1", "mes:2026-07")).not.toBe(base);
  });

  it("emite un uuid con formato válido (v5, variante RFC 4122)", () => {
    const id = opIdDeterminista("gasto", "sol-123");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(esUuid(id)).toBe(true);
  });

  it("trata null/undefined como parte vacía (no rompe)", () => {
    expect(() => opIdDeterminista("x", null, undefined, 3)).not.toThrow();
    expect(opIdDeterminista("x", null)).toBe(opIdDeterminista("x", ""));
  });
});

describe("esViolacionUnica", () => {
  it("reconoce el 23505 de Postgres (venga como venga de postgrest)", () => {
    expect(esViolacionUnica({ code: PG_UNIQUE_VIOLATION })).toBe(true);
    expect(esViolacionUnica({ code: "23505", message: "duplicate key" })).toBe(true);
  });
  it("NO confunde otros errores (red, timeout) con una colisión de unicidad", () => {
    expect(esViolacionUnica({ code: "500" })).toBe(false);
    expect(esViolacionUnica(new Error("FetchError: network"))).toBe(false);
    expect(esViolacionUnica(null)).toBe(false);
    expect(esViolacionUnica(undefined)).toBe(false);
  });
});
