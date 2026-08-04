// ─────────────────────────────────────────────────────────────────────────
//  Los GATES de colocar capital desde la calle. Cada uno protege plata:
//  el cobrador ahora crea créditos sin que nadie mire antes (decisión de
//  Carlos, 08-05), así que las puertas tienen que estar puestas y probadas.
//
//  Se testea la MATEMÁTICA de los límites, que es donde vive el riesgo real
//  (los gates de sesión/RLS los cubre el harness de Postgres).
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { evaluarRenovacion, topeAumentoPct, RENOVACION_CAP_TOTAL } from "@/lib/renovacion";

/** Techo auto-aprobable — misma fórmula que usa la pantalla y valida el server. */
const techoDe = (anterior: number) =>
  Math.min(RENOVACION_CAP_TOTAL, Math.round(anterior * (1 + topeAumentoPct(anterior) / 100)));

describe("Renovar desde la calle — mismos términos", () => {
  it("repetir el MISMO monto siempre está dentro del tope (aumento 0%)", () => {
    for (const monto of [5_000, 20_000, 50_000, 100_000]) {
      const e = evaluarRenovacion(monto, monto);
      expect(e.excedePct).toBe(false);
      expect(e.superaCap).toBe(false);
      expect(e.autoAprobable).toBe(true);
    }
  });

  it("un crédito heredado por encima del CAP no se puede repetir desde la calle", () => {
    // Disapp dejó créditos de más de $100.000; el CAP es duro para todos.
    expect(evaluarRenovacion(150_000, 150_000).superaCap).toBe(true);
  });
});

describe("Nueva venta desde la calle — el techo del tramo", () => {
  it("el techo que muestra la pantalla es EXACTAMENTE el que aprueba el server", () => {
    for (const anterior of [3_000, 10_000, 25_000, 60_000, 90_000]) {
      const techo = techoDe(anterior);
      // Justo en el techo: pasa.
      expect(evaluarRenovacion(anterior, techo).excedePct).toBe(false);
      // Un peso más: lo rechaza. Si esto se rompiera, la pantalla ofrecería
      // un monto que el servidor va a rechazar frente al cliente.
      const e = evaluarRenovacion(anterior, techo + 1);
      expect(e.excedePct || e.superaCap).toBe(true);
    }
  });

  it("el techo nunca supera el CAP de $100.000", () => {
    for (const anterior of [90_000, 95_000, 100_000]) {
      expect(techoDe(anterior)).toBeLessThanOrEqual(RENOVACION_CAP_TOTAL);
    }
  });

  it("bajar el monto siempre se permite (menos riesgo)", () => {
    const e = evaluarRenovacion(50_000, 20_000);
    expect(e.excedePct).toBe(false);
    expect(e.autoAprobable).toBe(true);
  });

  it("el tramo es más generoso con montos chicos que con grandes", () => {
    // Regla del negocio: 20/15/10% según el tramo del monto anterior.
    expect(topeAumentoPct(5_000)).toBeGreaterThanOrEqual(topeAumentoPct(80_000));
  });
});
