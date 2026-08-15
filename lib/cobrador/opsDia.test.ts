// ─────────────────────────────────────────────────────────────────────────
//  esPagoDeHoy — el criterio ÚNICO de "cobro de hoy" para la cola offline.
//  Sella el bug de la sesión de caos (15-08): la casilla ⟳ del cartón no
//  filtraba por día (una op atascada de AYER pintaba HOY como pagado) y la
//  ficha usaba toDateString(), que rompe el corte UY en teléfonos con otra TZ.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import { esPagoDeHoy } from "./opsDia";

const CLIENTE = "cliente-1";
const op = (over: Partial<{ tipo: string; clienteId: string; prestamoId: string | null; deviceTs: number }>) => ({
  tipo: "pago",
  clienteId: CLIENTE,
  prestamoId: null,
  deviceTs: Date.parse("2026-08-05T15:00:00Z"), // miércoles 5-ago, 12:00 UY
  ...over,
});
const AHORA = new Date("2026-08-05T20:00:00Z"); // el mismo día UY, 17:00

describe("esPagoDeHoy — un solo criterio de día para todas las superficies", () => {
  it("un cobro de hoy (día UY) del cliente cuenta; el de AYER no", () => {
    expect(esPagoDeHoy(op({}), CLIENTE, AHORA)).toBe(true);
    // Ayer 22:00 UY (hoy 01:00Z): la op atascada que pintaba la casilla de hoy.
    expect(esPagoDeHoy(op({ deviceTs: Date.parse("2026-08-05T01:00:00Z") }), CLIENTE, AHORA)).toBe(false);
  });

  it("el corte es el URUGUAYO (03:00Z), no la medianoche del teléfono", () => {
    // 02:59:59Z todavía es AYER en Uruguay; 03:00:00Z ya es hoy.
    expect(esPagoDeHoy(op({ deviceTs: Date.parse("2026-08-05T02:59:59Z") }), CLIENTE, AHORA)).toBe(false);
    expect(esPagoDeHoy(op({ deviceTs: Date.parse("2026-08-05T03:00:00Z") }), CLIENTE, AHORA)).toBe(true);
    // Y no depende de la TZ del dispositivo: fechaISOUY calcula en UY siempre
    // (toDateString habría partido el día por la medianoche local del teléfono).
  });

  it("otro cliente o una visita (no-pago) no cuentan", () => {
    expect(esPagoDeHoy(op({ clienteId: "otro" }), CLIENTE, AHORA)).toBe(false);
    expect(esPagoDeHoy(op({ tipo: "no_pago" }), CLIENTE, AHORA)).toBe(false);
  });
});
