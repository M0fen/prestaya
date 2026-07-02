// Tests de la hora de Uruguay (UTC−3). Fijan el corte de día/mes y el día
// calendario, TZ-independiente (corra donde corra el runtime).
import { describe, expect, it } from "vitest";
import { hoyUY, inicioDiaUYIso, inicioMesUYIso } from "./fecha";

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
