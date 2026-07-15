// Tests de la hora de Uruguay (UTC−3). Fijan el corte de día/mes y el día
// calendario, TZ-independiente (corra donde corra el runtime).
import { describe, expect, it } from "vitest";
import {
  hoyUY,
  inicioDiaUYIso,
  inicioMesUYIso,
  sellarRegistroEn,
  sumarDiasYmd,
} from "./fecha";

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

describe("sellarRegistroEn — día contable a prueba de reloj del celular", () => {
  // "Ahora" del servidor: 2026-07-15 12:00 UY (15:00Z).
  const ahora = new Date("2026-07-15T15:00:00Z");

  it("sin hora del dispositivo (null/undefined/vacío) → usa 'ahora' del servidor", () => {
    expect(sellarRegistroEn(null, ahora)).toBe("2026-07-15T15:00:00.000Z");
    expect(sellarRegistroEn(undefined, ahora)).toBe("2026-07-15T15:00:00.000Z");
    expect(sellarRegistroEn("", ahora)).toBe("2026-07-15T15:00:00.000Z");
  });

  it("hora del dispositivo inválida → usa 'ahora'", () => {
    expect(sellarRegistroEn("no-es-fecha", ahora)).toBe("2026-07-15T15:00:00.000Z");
  });

  it("MISMO día UY, más temprano (cobro offline legítimo) → CONSERVA la hora real", () => {
    // Cobro hecho 10:00 UY (13:00Z), sincronizado 12:00 UY: se preserva para el comprobante.
    expect(sellarRegistroEn("2026-07-15T13:00:00.000Z", ahora)).toBe(
      "2026-07-15T13:00:00.000Z",
    );
  });

  it("reloj ATRASADO un día (sellaría 'ayer') → se sella con 'ahora' (anti faltante fantasma)", () => {
    // El bug: un celular con la fecha de ayer pondría el cobro fuera del día → arqueo $0.
    expect(sellarRegistroEn("2026-07-14T13:00:00.000Z", ahora)).toBe(
      "2026-07-15T15:00:00.000Z",
    );
  });

  it("reloj ADELANTADO al futuro (> tolerancia) → se sella con 'ahora'", () => {
    expect(sellarRegistroEn("2026-07-15T15:05:00.000Z", ahora)).toBe(
      "2026-07-15T15:00:00.000Z",
    );
    // Adelantado un día entero también:
    expect(sellarRegistroEn("2026-07-16T10:00:00.000Z", ahora)).toBe(
      "2026-07-15T15:00:00.000Z",
    );
  });

  it("micro-desfasaje al futuro (1 min) del mismo día → se conserva (tolerado)", () => {
    expect(sellarRegistroEn("2026-07-15T15:01:00.000Z", ahora)).toBe(
      "2026-07-15T15:01:00.000Z",
    );
  });

  it("cobro offline que cruza medianoche UY → se sella con 'ahora' (día contable = servidor)", () => {
    // Servidor 00:30 UY del 15 (03:30Z); device 23:30 UY del 14 (02:30Z). Día UY
    // distinto → gana el servidor: cuenta en el día nuevo (evita ambigüedad contable).
    const medianoche = new Date("2026-07-15T03:30:00Z");
    expect(sellarRegistroEn("2026-07-15T02:30:00.000Z", medianoche)).toBe(
      "2026-07-15T03:30:00.000Z",
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
