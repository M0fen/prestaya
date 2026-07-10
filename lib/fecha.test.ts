// Tests de la hora de Uruguay (UTC−3). Fijan el corte de día/mes y el día
// calendario, TZ-independiente (corra donde corra el runtime).
import { describe, expect, it } from "vitest";
import { hoyUY, inicioDiaUYIso, inicioMesUYIso, sumarDiasYmd } from "./fecha";

describe("hoyUY", () => {
  it("las 02:00 UTC (23:00 en UY) siguen siendo el día ANTERIOR", () => {
    const d = hoyUY(new Date("2026-07-01T02:00:00Z")); // UY = 2026-06-30 23:00
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // junio
    expect(d.getDate()).toBe(30);
  });

  it("las 12:00 UTC (09:00 en UY) son el mismo día", () => {
    const d = hoyUY(new Date("2026-07-01T12:00:00Z"));
    expect(d.getMonth()).toBe(6); // julio
    expect(d.getDate()).toBe(1);
  });

  // Borde EXACTO de medianoche en Uruguay (UTC−3 → 03:00 UTC).
  it("un segundo ANTES de medianoche UY (02:59:59Z = 23:59:59 UY) es el día anterior", () => {
    const d = hoyUY(new Date("2026-07-01T02:59:59Z")); // UY = 2026-06-30 23:59:59
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // junio
    expect(d.getDate()).toBe(30);
  });

  it("justo en medianoche UY (03:00:00Z = 00:00:00 UY) ya es el día nuevo", () => {
    const d = hoyUY(new Date("2026-07-01T03:00:00Z")); // UY = 2026-07-01 00:00:00
    expect(d.getMonth()).toBe(6); // julio
    expect(d.getDate()).toBe(1);
  });

  // No depende de la TZ del runtime: mismo instante, mismo resultado.
  it("es TZ-independiente: 03:00:00Z siempre da 2026-07-01 (no el reloj local)", () => {
    const d = hoyUY(new Date(Date.UTC(2026, 6, 1, 3, 0, 0)));
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(6);
  });
});

describe("cortes de día/mes en UY (ISO en UTC)", () => {
  it("inicio del día = 03:00 UTC de esa fecha UY", () => {
    expect(inicioDiaUYIso(new Date("2026-07-01T12:00:00Z"))).toBe(
      "2026-07-01T03:00:00.000Z",
    );
    // 02:00 UTC pertenece al 30/6 en UY → inicio del día 30/6.
    expect(inicioDiaUYIso(new Date("2026-07-01T02:00:00Z"))).toBe(
      "2026-06-30T03:00:00.000Z",
    );
  });

  it("inicio del mes = 03:00 UTC del día 1 UY", () => {
    expect(inicioMesUYIso(new Date("2026-07-15T12:00:00Z"))).toBe(
      "2026-07-01T03:00:00.000Z",
    );
  });
});

describe("sumarDiasYmd (nav por fecha + rangos)", () => {
  it("suma y resta días dentro del mes", () => {
    expect(sumarDiasYmd("2026-07-10", 1)).toBe("2026-07-11");
    expect(sumarDiasYmd("2026-07-10", -1)).toBe("2026-07-09");
    expect(sumarDiasYmd("2026-07-10", -6)).toBe("2026-07-04");
  });
  it("cruza el borde de mes y de año", () => {
    expect(sumarDiasYmd("2026-07-01", -1)).toBe("2026-06-30");
    expect(sumarDiasYmd("2026-07-31", 1)).toBe("2026-08-01");
    expect(sumarDiasYmd("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("respeta años bisiestos (feb 2028)", () => {
    expect(sumarDiasYmd("2028-02-28", 1)).toBe("2028-02-29");
    expect(sumarDiasYmd("2028-03-01", -1)).toBe("2028-02-29");
  });
});
