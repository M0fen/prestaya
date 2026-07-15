// ─────────────────────────────────────────────────────────────────────────
//  PROPERTY-BASED TESTS del núcleo de DINERO (fast-check). En vez de ejemplos
//  sueltos, fija INVARIANTES que deben valer para CUALQUIER entrada y las prueba
//  contra cientos de casos aleatorios (atrapa bugs de borde que un test por
//  ejemplo deja pasar por un año). Todo el dinero es ENTERO.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { calcularEstadosCarton } from "./cartones";
import { sellarRegistroEn, fechaISOUY } from "./fecha";
import { reconciliar, type CreditoRecon } from "./reconciliacion";

// ── El CARTÓN (cálculo central de saldos) ─────────────────────────────────
describe("calcularEstadosCarton — invariantes de dinero (PBT)", () => {
  const arbPrestamo = fc.record({
    cuota: fc.integer({ min: 1, max: 5000 }),
    totalDias: fc.integer({ min: 1, max: 60 }),
  });
  const arbPagos = fc.array(fc.integer({ min: 1, max: 5000 }), { maxLength: 100 });

  it("totalPagado = Σpagos · falta = max(0, total−pagado) · Σdías = min(pagado, total) · cada día ∈ [0, cuota]", () => {
    fc.assert(
      fc.property(arbPrestamo, arbPagos, ({ cuota, totalDias }, montos) => {
        const prestamo = { cuota_diaria: cuota, total_dias: totalDias, fecha_inicio: "2026-01-05" };
        const pagos = montos.map((m, i) => ({ dia_credito: (i % totalDias) + 1, monto: m }));
        const r = calcularEstadosCarton(prestamo, pagos, new Date(2026, 5, 1));
        const totalPagado = montos.reduce((a, b) => a + b, 0);
        const totalAPagar = cuota * totalDias;

        // 1) el total pagado es la suma exacta del libro
        expect(r.totalPagado).toBe(totalPagado);
        // 2) lo que falta nunca es negativo (si pagó de más, falta 0)
        expect(r.falta).toBe(Math.max(0, totalAPagar - totalPagado));
        // 3) FIFO: cada día se cubre a lo sumo con una cuota
        for (const d of r.dias) {
          expect(d.montoPagado).toBeGreaterThanOrEqual(0);
          expect(d.montoPagado).toBeLessThanOrEqual(cuota);
        }
        // 4) la plata "cae" en los días sin perderse: Σdías = min(pagado, total)
        const sumaDias = r.dias.reduce((a, d) => a + d.montoPagado, 0);
        expect(sumaDias).toBe(Math.min(totalPagado, totalAPagar));
        // 5) hay exactamente totalDias casillas
        expect(r.dias).toHaveLength(totalDias);
      }),
      { numRuns: 400 },
    );
  });

  it("pagar el total exacto ⇒ crédito completado (falta 0, 100% cubierto)", () => {
    fc.assert(
      fc.property(arbPrestamo, ({ cuota, totalDias }) => {
        const prestamo = { cuota_diaria: cuota, total_dias: totalDias, fecha_inicio: "2026-01-05" };
        // Un pago por día, cuota exacta → pagado = total.
        const pagos = Array.from({ length: totalDias }, (_, i) => ({ dia_credito: i + 1, monto: cuota }));
        const r = calcularEstadosCarton(prestamo, pagos, new Date(2026, 5, 1));
        expect(r.falta).toBe(0);
        expect(r.dias.every((d) => d.montoPagado === cuota)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

// ── El DÍA CONTABLE sellado (money-critical) ──────────────────────────────
describe("sellarRegistroEn — el día contable SIEMPRE es el del servidor (PBT)", () => {
  const arbDate = fc
    .integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2030, 0, 1) })
    .map((ms) => new Date(ms));

  it("para CUALQUIER reloj de dispositivo, el día UY del sello == día UY de 'ahora'", () => {
    fc.assert(
      fc.property(
        arbDate,
        fc.oneof(fc.constant(null), fc.constant(undefined), fc.constant("basura"), arbDate.map((d) => d.toISOString())),
        (ahora, deviceIso) => {
          const sello = sellarRegistroEn(deviceIso, ahora);
          // Invariante money-critical: el arqueo/caja/rendición nunca dependen de
          // un celular con la fecha corrida.
          expect(fechaISOUY(new Date(sello))).toBe(fechaISOUY(ahora));
          // El sello nunca queda en el futuro respecto de 'ahora' (± tolerancia chica).
          expect(new Date(sello).getTime()).toBeLessThanOrEqual(ahora.getTime() + 2 * 60 * 1000 + 1);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ── RECONCILIACIÓN ────────────────────────────────────────────────────────
describe("reconciliar — invariantes (PBT)", () => {
  it("si pagado_acum == Σpagos y pagado ≤ total en TODOS ⇒ la plata cuadra (ok)", () => {
    const arbOk = fc
      .record({
        pagos: fc.integer({ min: 0, max: 100000 }),
        total: fc.integer({ min: 100000, max: 200000 }),
        cuota: fc.integer({ min: 1, max: 5000 }),
      })
      .map(
        (x): CreditoRecon => ({
          id: "c",
          estado: "activo",
          pagadoAcum: x.pagos,
          pagosSuma: x.pagos, // coincide
          totalAPagar: x.total, // pagos ≤ total (pagos ≤ 100k ≤ total)
          cuotaDiaria: x.cuota,
        }),
      );
    fc.assert(
      fc.property(fc.array(arbOk, { maxLength: 50 }), (creditos) => {
        expect(reconciliar(creditos).ok).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("cualquier drift pagado_acum≠Σpagos ⇒ NO cuadra (lo detecta)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000 }), fc.integer({ min: 1, max: 10000 }), (base, drift) => {
        const c: CreditoRecon = {
          id: "c", estado: "activo",
          pagadoAcum: base + drift, pagosSuma: base,
          totalAPagar: 10_000_000, cuotaDiaria: 1000,
        };
        expect(reconciliar([c]).ok).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
