// ─────────────────────────────────────────────────────────────────────────
//  Test de periodoKeyDe — la LLAVE del candado idempotente de comisiones (0049).
//  Es lo que impide que un cobrador cobre la misma comisión dos veces: si dos
//  períodos distintos colisionaran en la misma clave, o si la clave del mismo
//  período variara, el candado se rompería (doble egreso o bloqueo indebido).
//  Por eso la forma canónica de la clave se fija con test.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { periodoKeyDe, rangoDePeriodoKey, rangosSeSolapan } from "./comisiones";

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

describe("rangoDePeriodoKey — rango de fechas que cubre una clave", () => {
  it("día → [d, d]", () => {
    expect(rangoDePeriodoKey("dia:2026-07-10")).toEqual({ desde: "2026-07-10", hasta: "2026-07-10" });
  });
  it("semana → [inicio, inicio+6]", () => {
    expect(rangoDePeriodoKey("semana:2026-07-06")).toEqual({ desde: "2026-07-06", hasta: "2026-07-12" });
  });
  it("mes → [YYYY-MM-01, último día del mes]", () => {
    expect(rangoDePeriodoKey("mes:2026-07")).toEqual({ desde: "2026-07-01", hasta: "2026-07-31" });
    // febrero de año no bisiesto
    expect(rangoDePeriodoKey("mes:2026-02")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    // febrero bisiesto
    expect(rangoDePeriodoKey("mes:2028-02")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
  });
  it("año → [YYYY-01-01, YYYY-12-31]", () => {
    expect(rangoDePeriodoKey("anio:2026")).toEqual({ desde: "2026-01-01", hasta: "2026-12-31" });
  });
  it("clave irreconocible → null", () => {
    expect(rangoDePeriodoKey("basura")).toBeNull();
    expect(rangoDePeriodoKey("dia:no-fecha")).toBeNull();
  });
});

describe("rangosSeSolapan — guardia anti-doble-comisión (día ⊂ mes)", () => {
  const dia = rangoDePeriodoKey("dia:2026-07-10")!;
  const mes = rangoDePeriodoKey("mes:2026-07")!;
  const otroMes = rangoDePeriodoKey("mes:2026-08")!;
  const semana = rangoDePeriodoKey("semana:2026-07-06")!; // 06→12, contiene el 10

  it("el día 10 se solapa con julio (mismo recaudo) → true", () => {
    expect(rangosSeSolapan(dia, mes)).toBe(true);
    expect(rangosSeSolapan(mes, dia)).toBe(true); // simétrico
  });
  it("el día 10 cae dentro de la semana 06–12 → true", () => {
    expect(rangosSeSolapan(dia, semana)).toBe(true);
  });
  it("julio y agosto NO se solapan → false", () => {
    expect(rangosSeSolapan(mes, otroMes)).toBe(false);
  });
  it("un día de agosto NO se solapa con julio → false", () => {
    expect(rangosSeSolapan(rangoDePeriodoKey("dia:2026-08-01")!, mes)).toBe(false);
  });
});
