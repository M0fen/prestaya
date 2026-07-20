// ─────────────────────────────────────────────────────────────────────────
//  Test de periodoKeyDe — la LLAVE del candado idempotente de comisiones (0049).
//  Es lo que impide que un cobrador cobre la misma comisión dos veces: si dos
//  períodos distintos colisionaran en la misma clave, o si la clave del mismo
//  período variara, el candado se rompería (doble egreso o bloqueo indebido).
//  Por eso la forma canónica de la clave se fija con test.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { periodoKeyDe } from "./comisiones";

describe("periodoKeyDe — clave canónica del período (candado 0049)", () => {
  it("mes → usa año-mes (ignora el día): mes:YYYY-MM", () => {
    expect(periodoKeyDe("mes", "2026-07-09")).toBe("mes:2026-07");
    // Cualquier día del mismo mes da la MISMA clave (idempotencia estable).
    expect(periodoKeyDe("mes", "2026-07-01")).toBe("mes:2026-07");
    expect(periodoKeyDe("mes", "2026-07-31")).toBe("mes:2026-07");
  });

  it("anio → usa solo el año: anio:YYYY", () => {
    expect(periodoKeyDe("anio", "2026-07-09")).toBe("anio:2026");
    expect(periodoKeyDe("anio", "2026-01-01")).toBe("anio:2026");
  });

  it("dia → inicio exacto del período: dia:YYYY-MM-DD", () => {
    expect(periodoKeyDe("dia", "2026-07-09")).toBe("dia:2026-07-09");
  });

  it("semana → inicio de la semana: semana:YYYY-MM-DD", () => {
    expect(periodoKeyDe("semana", "2026-07-06")).toBe("semana:2026-07-06");
  });

  it("períodos DISTINTOS nunca colisionan en la misma clave", () => {
    const claves = [
      periodoKeyDe("mes", "2026-07-09"),
      periodoKeyDe("mes", "2026-08-09"),
      periodoKeyDe("anio", "2026-07-09"),
      periodoKeyDe("dia", "2026-07-09"),
      periodoKeyDe("semana", "2026-07-06"),
    ];
    expect(new Set(claves).size).toBe(claves.length);
  });
});
