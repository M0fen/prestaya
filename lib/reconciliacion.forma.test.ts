// ─────────────────────────────────────────────────────────────────────────
//  INV11/INV12 — salud de FORMA de los créditos activos (auditoría 08-05).
//  Nacieron de la presentación que costó confianza: 678 créditos que Disapp
//  ya había cerrado quedaron `activo`-saldados por una línea del empalme y
//  NINGUNA invariante los miraba. Estos tests fijan que nunca más sea ciego.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { invFormaCreditoActivo, type CreditoForma } from "./reconciliacion";

const base: CreditoForma = {
  creditoId: "c1",
  importado: true,
  capital: 20_000,
  totalCredito: 24_000,
  pagado: 10_000,
};

describe("INV11 — importado saldado sin finalizar", () => {
  it("importado con pagado == total → hallazgo alto", () => {
    const h = invFormaCreditoActivo([{ ...base, pagado: 24_000 }]);
    expect(h).toHaveLength(1);
    expect(h[0].invariante).toBe("importado-saldado-sin-finalizar");
    expect(h[0].severidad).toBe("alto");
  });

  it("importado SOBRE-cobrado → hallazgo con el exceso en el detalle", () => {
    const h = invFormaCreditoActivo([{ ...base, pagado: 24_700 }]);
    expect(h).toHaveLength(1);
    expect(h[0].detalle).toContain("$700");
  });

  it("NATIVO saldado NO alerta (transitorio legítimo: espera su renovación)", () => {
    expect(invFormaCreditoActivo([{ ...base, importado: false, pagado: 24_000 }])).toHaveLength(0);
  });

  it("importado al día con saldo → sin hallazgo", () => {
    expect(invFormaCreditoActivo([base])).toHaveLength(0);
  });

  it("residuo sub-peso (cuota fraccionaria de Disapp) cuenta como saldado", () => {
    // 351,04 × 24 = 8.424,96 y el cliente pagó 8.425 enteros → saldado.
    const h = invFormaCreditoActivo([
      { ...base, capital: 7_000, totalCredito: 8_424.96, pagado: 8_425 },
    ]);
    expect(h).toHaveLength(1);
  });
});

describe("INV12 — interés negativo (total < capital)", () => {
  it("cuota×días menor que el capital → alto, venga de donde venga", () => {
    const h = invFormaCreditoActivo([
      { ...base, importado: false, capital: 100_000, totalCredito: 86_000, pagado: 0 },
    ]);
    expect(h).toHaveLength(1);
    expect(h[0].invariante).toBe("interes-negativo");
    expect(h[0].severidad).toBe("alto");
  });

  it("redondeo chico del import ($2-12, herencia Disapp) NO alerta — tolerancia $50", () => {
    expect(
      invFormaCreditoActivo([{ ...base, capital: 20_012, totalCredito: 20_000, pagado: 0 }]),
    ).toHaveLength(0);
  });

  it("un crédito puede violar las DOS a la vez (dos hallazgos)", () => {
    const h = invFormaCreditoActivo([
      { ...base, capital: 30_000, totalCredito: 24_000, pagado: 25_000 },
    ]);
    expect(h.map((x) => x.invariante).sort()).toEqual([
      "importado-saldado-sin-finalizar",
      "interes-negativo",
    ]);
  });
});
