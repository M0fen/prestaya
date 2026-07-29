// Property-based tests del saldo de ESTRELLAS (dinero-adyacente: se canjea por
// beneficios reales). Fija las invariantes anti "estrella fantasma": el saldo se
// deriva de pagos vigentes, nunca es negativo, y validarRedencion nunca deja
// pedir por encima del cupo. Complementa lib/estrellas.test.ts.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  calcularEstrellas,
  validarRedencion,
  FRAGMENTOS_POR_ESTRELLA,
  TOPE_REDENCION_CICLO,
  type RedencionMin,
  type EstadoRedencion,
} from "./estrellas";

const arbEstado: fc.Arbitrary<EstadoRedencion> = fc.constantFrom("pendiente", "aprobada", "rechazada");
const CICLO = "2026-07";
const arbRedencion: fc.Arbitrary<RedencionMin> = fc.record({
  estrellas: fc.integer({ min: 1, max: 5 }),
  estado: arbEstado,
  ciclo: fc.constantFrom(CICLO, "2026-06"),
});

describe("calcularEstrellas — invariantes (PBT)", () => {
  const arb = fc.record({
    pagosVigentes: fc.integer({ min: 0, max: 2000 }),
    redenciones: fc.array(arbRedencion, { maxLength: 20 }),
    cicloActual: fc.constant(CICLO),
  });

  it("saldo derivado, no negativo y acotado por lo ganado y el cupo del ciclo", () => {
    fc.assert(
      fc.property(arb, (e) => {
        const s = calcularEstrellas(e);
        // 1) fragmentos = pagos; estrellas ganadas = floor(frag/5)
        expect(s.fragmentos).toBe(e.pagosVigentes);
        expect(s.estrellasGanadas).toBe(Math.floor(e.pagosVigentes / FRAGMENTOS_POR_ESTRELLA));
        // 2) nada negativo
        expect(s.disponibles).toBeGreaterThanOrEqual(0);
        expect(s.redimiblesCiclo).toBeGreaterThanOrEqual(0);
        // 3) disponibles nunca supera lo ganado
        expect(s.disponibles).toBeLessThanOrEqual(s.estrellasGanadas);
        // 4) el progreso vive en [0,4] y faltan en [1,5]
        expect(s.progresoFragmento).toBeGreaterThanOrEqual(0);
        expect(s.progresoFragmento).toBeLessThan(FRAGMENTOS_POR_ESTRELLA);
        expect(s.faltanParaEstrella).toBeGreaterThanOrEqual(1);
        expect(s.faltanParaEstrella).toBeLessThanOrEqual(FRAGMENTOS_POR_ESTRELLA);
        // 5) redimible ahora ≤ disponible y ≤ tope del ciclo
        expect(s.redimiblesCiclo).toBeLessThanOrEqual(s.disponibles);
        expect(s.redimiblesCiclo).toBeLessThanOrEqual(TOPE_REDENCION_CICLO);
      }),
    );
  });

  it("validarRedencion NUNCA aprueba por encima del saldo disponible ni del cupo", () => {
    fc.assert(
      fc.property(arb, fc.integer({ min: -3, max: 10 }), (e, cantidad) => {
        const s = calcularEstrellas(e);
        const r = validarRedencion(s, cantidad);
        if (r.ok) {
          const n = Math.round(cantidad);
          expect(n).toBeGreaterThan(0);
          expect(n).toBeLessThanOrEqual(TOPE_REDENCION_CICLO);
          expect(n).toBeLessThanOrEqual(s.disponibles);
          expect(n).toBeLessThanOrEqual(s.redimiblesCiclo);
        }
      }),
    );
  });
});
