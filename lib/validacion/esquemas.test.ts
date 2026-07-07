import { describe, it, expect } from "vitest";
import {
  cobroSchema,
  noPagoSchema,
  reporteFaltaSchema,
  busquedaQuery,
  reporteTipo,
  tokenValido,
  validar,
} from "./esquemas";

const UUID = "de50a000-0000-4000-8000-000000000001";

describe("cobroSchema", () => {
  it("acepta un cobro válido", () => {
    const r = validar(cobroSchema, { clienteId: UUID, monto: 500, gpsLat: -34.9, gpsLng: -56.1 });
    expect(r.ok).toBe(true);
  });

  it("acepta cobro mínimo (solo clienteId; monto se decide en el server)", () => {
    expect(validar(cobroSchema, { clienteId: UUID }).ok).toBe(true);
  });

  it("rechaza clienteId que no es UUID (posible inyección)", () => {
    expect(validar(cobroSchema, { clienteId: "'; DROP TABLE pagos;--" }).ok).toBe(false);
    expect(validar(cobroSchema, { clienteId: 123 }).ok).toBe(false);
  });

  it("rechaza monto no positivo o absurdo", () => {
    expect(validar(cobroSchema, { clienteId: UUID, monto: -5 }).ok).toBe(false);
    expect(validar(cobroSchema, { clienteId: UUID, monto: 999_999_999 }).ok).toBe(false);
    expect(validar(cobroSchema, { clienteId: UUID, monto: "500" }).ok).toBe(false);
  });

  it("rechaza GPS fuera de rango", () => {
    expect(validar(cobroSchema, { clienteId: UUID, gpsLat: 999, gpsLng: 0 }).ok).toBe(false);
  });
});

describe("noPagoSchema", () => {
  it("acepta un motivo válido", () => {
    expect(validar(noPagoSchema, { clienteId: UUID, motivo: "no_estaba" }).ok).toBe(true);
  });
  it("rechaza un motivo inventado", () => {
    expect(validar(noPagoSchema, { clienteId: UUID, motivo: "porque_si" }).ok).toBe(false);
  });
});

describe("token del cliente", () => {
  it("acepta tokens con forma esperada", () => {
    expect(tokenValido("demo-maria-fernanda")).toBe(true);
    expect(tokenValido("a1b2c3d4e5f6a1b2c3d4e5f6")).toBe(true);
  });
  it("rechaza tokens malformados o inyecciones", () => {
    expect(tokenValido("")).toBe(false);
    expect(tokenValido("../../etc/passwd")).toBe(false);
    expect(tokenValido("x")).toBe(false);
    expect(tokenValido(null)).toBe(false);
    expect(tokenValido({})).toBe(false);
  });
});

describe("reporteFaltaSchema", () => {
  it("acepta un reporte válido y uno mínimo", () => {
    expect(validar(reporteFaltaSchema, { token: "demo-maria-fernanda" }).ok).toBe(true);
    expect(
      validar(reporteFaltaSchema, { token: "demo-maria-fernanda", diaCredito: 5, montoReclamado: 300, comentario: "faltó" }).ok,
    ).toBe(true);
  });
  it("rechaza día fuera de rango", () => {
    expect(validar(reporteFaltaSchema, { token: "demo-maria-fernanda", diaCredito: 900 }).ok).toBe(false);
  });
});

describe("rutas API", () => {
  it("busquedaQuery exige 2..80 chars", () => {
    expect(busquedaQuery.safeParse("a").success).toBe(false);
    expect(busquedaQuery.safeParse("ana").success).toBe(true);
    expect(busquedaQuery.safeParse("x".repeat(200)).success).toBe(false);
  });
  it("reporteTipo solo acepta tipos conocidos", () => {
    expect(reporteTipo.safeParse("cartera").success).toBe(true);
    expect(reporteTipo.safeParse("../secret").success).toBe(false);
  });
});
