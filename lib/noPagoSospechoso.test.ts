// Tests de "no pago sospechoso" (núcleo puro).
import { describe, it, expect } from "vitest";
import { tasaCumplimiento, clasificarNoPago } from "./noPagoSospechoso";

describe("tasaCumplimiento", () => {
  it("pagadas/vencidas, clampeado", () => {
    expect(tasaCumplimiento({ cuotasVencidas: 10, cuotasPagadas: 9 })).toBe(0.9);
    expect(tasaCumplimiento({ cuotasVencidas: 0, cuotasPagadas: 0 })).toBe(0);
    expect(tasaCumplimiento({ cuotasVencidas: 5, cuotasPagadas: 8 })).toBe(1); // clamp
  });
});

describe("clasificarNoPago", () => {
  it("sin historia suficiente → normal", () => {
    const r = clasificarNoPago({ cuotasVencidas: 3, cuotasPagadas: 3 }, true);
    expect(r.nivel).toBe("normal");
  });

  it("cliente muy cumplidor marcado no-pago → sospechoso", () => {
    const r = clasificarNoPago({ cuotasVencidas: 20, cuotasPagadas: 19 }, true);
    expect(r.nivel).toBe("sospechoso");
    expect(r.motivo).toMatch(/cumplidor/i);
  });

  it("cliente cumplidor medio → revisar", () => {
    const r = clasificarNoPago({ cuotasVencidas: 20, cuotasPagadas: 16 }, true); // 80%
    expect(r.nivel).toBe("revisar");
  });

  it("cliente flojo pagador → normal (no sorprende que no pague)", () => {
    const r = clasificarNoPago({ cuotasVencidas: 20, cuotasPagadas: 8 }, true); // 40%
    expect(r.nivel).toBe("normal");
  });

  it("si no es no-pago (pagó / no estaba) → normal", () => {
    const r = clasificarNoPago({ cuotasVencidas: 20, cuotasPagadas: 20 }, false);
    expect(r.nivel).toBe("normal");
  });
});
