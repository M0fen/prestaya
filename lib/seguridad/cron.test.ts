import { describe, it, expect } from "vitest";
import { cronAutorizado } from "./cron";

const OK = "Bearer s3cr3t";

describe("cronAutorizado — fallar cerrado en producción", () => {
  it("PROD sin secreto configurado → NIEGA (cerrado)", () => {
    expect(cronAutorizado(null, undefined, true)).toBe(false);
    expect(cronAutorizado(OK, "", true)).toBe(false);
  });

  it("PROD con secreto → exige el header correcto", () => {
    expect(cronAutorizado(OK, "s3cr3t", true)).toBe(true);
    expect(cronAutorizado("Bearer otro", "s3cr3t", true)).toBe(false);
    expect(cronAutorizado(null, "s3cr3t", true)).toBe(false);
  });

  it("DEV sin secreto → permite (para probar local)", () => {
    expect(cronAutorizado(null, undefined, false)).toBe(true);
  });

  it("DEV con secreto → igual exige el header", () => {
    expect(cronAutorizado(OK, "s3cr3t", false)).toBe(true);
    expect(cronAutorizado(null, "s3cr3t", false)).toBe(false);
  });
});
