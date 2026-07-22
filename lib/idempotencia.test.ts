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

describe("esUuid — validador ÚNICO y estricto (no acepta basura)", () => {
  it("acepta un UUID canónico (v4 del cliente, v5 determinista), case-insensitive", () => {
    expect(esUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
    expect(esUuid("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(true);
    expect(esUuid(opIdDeterminista("gasto", "x"))).toBe(true);
  });
  it("RECHAZA la basura que colaba el regex laxo `[0-9a-fA-F-]{36}`", () => {
    expect(esUuid("------------------------------------")).toBe(false); // 36 guiones
    expect(esUuid("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false); // 36 hex sin estructura
    expect(esUuid("3f2504e04f8941d39a0c0305e82c3301----")).toBe(false); // guiones mal ubicados
  });
  it("rechaza no-strings y largos incorrectos", () => {
    expect(esUuid(null)).toBe(false);
    expect(esUuid(undefined)).toBe(false);
    expect(esUuid(12345)).toBe(false);
    expect(esUuid("3f2504e0-4f89-41d3-9a0c-0305e82c33")).toBe(false); // corto
  });
  it("valida CADA segmento por su largo exacto (8-4-4-4-12)", () => {
    // Un dígito de más/menos en cualquier grupo → inválido (fija los cuantificadores).
    expect(esUuid("3f2504e0x-4f89-41d3-9a0c-0305e82c3301")).toBe(false); // 1er grupo 9
    expect(esUuid("3f2504e0-4f8-41d3-9a0c-0305e82c3301")).toBe(false); // 2º grupo 3
    expect(esUuid("3f2504e0-4f89-41d3-9a0c-0305e82c33012")).toBe(false); // último grupo 13
    expect(esUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301 ")).toBe(false); // espacio final
    expect(esUuid("z3f2504e-4f89-41d3-9a0c-0305e82c3301")).toBe(false); // char no-hex
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
