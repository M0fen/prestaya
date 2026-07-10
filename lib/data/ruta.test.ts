import { describe, it, expect } from "vitest";
import { estadoHoyDe } from "./ruta";

describe("estadoHoyDe — regla del cartón en la lista del cobrador", () => {
  it("pagó >= cuota → pagado (día cubierto)", () => {
    expect(estadoHoyDe(100, 100, false)).toBe("pagado");
    expect(estadoHoyDe(150, 100, false)).toBe("pagado"); // pagó de más igual cubre
  });

  it("abono PARCIAL (0 < pagado < cuota) → abono, NO pagado", () => {
    expect(estadoHoyDe(60, 100, false)).toBe("abono");
    expect(estadoHoyDe(99, 100, false)).toBe("abono");
    // aunque haya visita marcada no-pago, si pagó algo, prima el abono
    expect(estadoHoyDe(40, 100, true)).toBe("abono");
  });

  it("no pagó nada + visita no-pago → no_pago", () => {
    expect(estadoHoyDe(0, 100, true)).toBe("no_pago");
  });

  it("no pagó nada, sin visita → pendiente", () => {
    expect(estadoHoyDe(0, 100, false)).toBe("pendiente");
  });

  it("cuota 0 (crédito sin cuota) nunca marca pagado por >=", () => {
    expect(estadoHoyDe(0, 0, false)).toBe("pendiente");
    expect(estadoHoyDe(50, 0, false)).toBe("abono"); // pagó algo sobre cuota 0
  });
});
