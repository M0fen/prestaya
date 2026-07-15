import { describe, it, expect } from "vitest";
import { clasificarClienteRuta, estadoHoyDe } from "./ruta";

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

describe("clasificarClienteRuta — zombies (plazo vencido) fuera del target del día", () => {
  it("crédito EN TÉRMINO → cuenta en la ruta y aporta su cuota al esperado", () => {
    const r = clasificarClienteRuta([{ cuota: 100, plazoVencido: false }], 0, false);
    expect(r.cuotaEnTermino).toBe(100);
    expect(r.soloVencido).toBe(false);
    expect(r.cuentaEnRuta).toBe(true);
    expect(r.estadoHoy).toBe("pendiente");
  });

  it("crédito VENCIDO sin actividad → NO cuenta en la ruta ni en el esperado", () => {
    const r = clasificarClienteRuta([{ cuota: 100, plazoVencido: true }], 0, false);
    expect(r.cuotaEnTermino).toBe(0); // no infla "Falta $X"
    expect(r.soloVencido).toBe(true); // cartera vencida pura
    expect(r.cuentaEnRuta).toBe(false); // no bloquea "Ruta completa 🎉"
  });

  it("crédito VENCIDO con recuperación → sigue fuera del target, pero se ve como abono", () => {
    // El recaudo (pagadoHoy) lo suma el llamador aparte: la plata cobrada es plata.
    const r = clasificarClienteRuta([{ cuota: 100, plazoVencido: true }], 80, false);
    expect(r.soloVencido).toBe(true);
    expect(r.cuentaEnRuta).toBe(false);
    expect(r.estadoHoy).toBe("abono"); // pagó algo (sobre cuota-en-término 0)
  });

  it("cliente MIXTO (uno en término + uno vencido) → cuenta en ruta con SOLO la cuota vigente", () => {
    const r = clasificarClienteRuta(
      [{ cuota: 100, plazoVencido: false }, { cuota: 300, plazoVencido: true }],
      0,
      false,
    );
    expect(r.cuotaEnTermino).toBe(100); // el vencido no suma su cuota al esperado
    expect(r.soloVencido).toBe(false);
    expect(r.cuentaEnRuta).toBe(true);
  });

  it("sin créditos activos → no es cartera vencida (soloVencido false)", () => {
    const r = clasificarClienteRuta([], 0, false);
    expect(r.soloVencido).toBe(false);
    expect(r.cuentaEnRuta).toBe(true);
    expect(r.cuotaEnTermino).toBe(0);
  });
});
