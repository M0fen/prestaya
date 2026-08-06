// Test del núcleo de RENOVACIÓN: la cuota del nuevo crédito arrastra la tasa
// del anterior. Es dinero: se fija con números redondos y bordes inválidos.
import { describe, expect, it } from "vitest";
import {
  calcularCuotaRenovacion,
  tasaImplicita,
  evaluarRenovacion,
  montoRenovacionAutoAprobable,
  montoRenovacionPedido,
  montoRenovacionSugerido,
  requiereAprobacionAdmin,
  topeAumentoPct,
  RENOVACION_AUMENTO_PCT,
  RENOVACION_CAP_TOTAL,
} from "./renovacion";

// Anterior: prestó 10.000, cuota 400 × 30 días = 12.000 a pagar → tasa 1.2.
const ANT = { monto: 10000, cuota: 400, totalDias: 30 };

describe("tasaImplicita", () => {
  it("total a pagar / capital", () => {
    expect(tasaImplicita(ANT)).toBeCloseTo(1.2, 10);
  });
  it("monto anterior inválido → 0 (no divide por cero)", () => {
    expect(tasaImplicita({ monto: 0, cuota: 400, totalDias: 30 })).toBe(0);
  });
});

describe("calcularCuotaRenovacion", () => {
  it("mismo monto y días → misma cuota", () => {
    expect(calcularCuotaRenovacion(ANT, 10000, 30)).toBe(400);
  });

  it("sube el capital manteniendo la tasa (1.2) y los días", () => {
    // 15.000 × 1.2 / 30 = 600.
    expect(calcularCuotaRenovacion(ANT, 15000, 30)).toBe(600);
  });

  it("cambia los días → recalcula la cuota (redondeada a peso)", () => {
    // 10.000 × 1.2 / 24 = 500.
    expect(calcularCuotaRenovacion(ANT, 10000, 24)).toBe(500);
    // 10.000 × 1.2 / 40 = 300.
    expect(calcularCuotaRenovacion(ANT, 10000, 40)).toBe(300);
  });

  it("términos inválidos → 0 (el llamador rechaza)", () => {
    expect(calcularCuotaRenovacion(ANT, 0, 30)).toBe(0);
    expect(calcularCuotaRenovacion(ANT, 10000, 0)).toBe(0);
  });
});

describe("topeAumentoPct (escalonado por tramo del monto anterior)", () => {
  it("≤ 30.000 → 20%", () => {
    expect(topeAumentoPct(30000)).toBe(20);
    expect(topeAumentoPct(10000)).toBe(20);
  });
  it("30.001–60.000 → 15%", () => {
    expect(topeAumentoPct(30001)).toBe(15);
    expect(topeAumentoPct(60000)).toBe(15);
  });
  it("60.001–90.000 → 10%", () => {
    expect(topeAumentoPct(60001)).toBe(10);
    expect(topeAumentoPct(90000)).toBe(10);
  });
  it("> 90.000 → 0% (ya en el máximo)", () => {
    expect(topeAumentoPct(90001)).toBe(0);
    expect(topeAumentoPct(100000)).toBe(0);
  });
});

describe("evaluarRenovacion (tramo escalonado + cap $100.000)", () => {
  it("mismo monto o menos → auto-aprobable", () => {
    expect(evaluarRenovacion(50000, 50000).autoAprobable).toBe(true);
    expect(evaluarRenovacion(50000, 40000).autoAprobable).toBe(true);
  });

  it("tramo ≤30k: +20% en el borde → auto-aprobable; +21% → excede", () => {
    const ok = evaluarRenovacion(25000, 30000); // +20%
    expect(ok.autoAprobable).toBe(true);
    expect(ok.topePct).toBe(20);
    const no = evaluarRenovacion(25000, 30250); // +21%
    expect(no.autoAprobable).toBe(false);
    expect(no.excedePct).toBe(true);
    expect(no.motivo).toContain("20%");
  });

  it("tramo 31–60k: máximo +15%", () => {
    expect(evaluarRenovacion(50000, 57500).autoAprobable).toBe(true); // +15%
    const no = evaluarRenovacion(50000, 58000); // +16%
    expect(no.autoAprobable).toBe(false);
    expect(no.motivo).toContain("15%");
  });

  it("tramo 61–90k: máximo +10%", () => {
    expect(evaluarRenovacion(80000, 88000).autoAprobable).toBe(true); // +10%
    expect(evaluarRenovacion(80000, 89000).autoAprobable).toBe(false); // +11,25%
  });

  it("tramo >90k: sin aumento (0%); mismo monto sí, más no", () => {
    expect(evaluarRenovacion(95000, 95000).autoAprobable).toBe(true);
    const no = evaluarRenovacion(95000, 96000);
    expect(no.autoAprobable).toBe(false);
    expect(no.topePct).toBe(0);
  });

  it("CAP $100.000: superar el total marca superaCap (duro para todos)", () => {
    const e = evaluarRenovacion(90000, 100001);
    expect(e.superaCap).toBe(true);
    expect(e.autoAprobable).toBe(false);
    expect(e.motivo).toContain("100.000");
    // Exactamente en el cap NO lo supera.
    expect(evaluarRenovacion(90000, RENOVACION_CAP_TOTAL).superaCap).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  El +20% del negocio (regla de Carlos, 06-08).
//  "Siempre es 20% para renovación a no ser que admin cambie esto."
//  Renovar = repetir el crédito que la persona TERMINÓ, subido un 20%. Antes la
//  oficina proponía un monto inventado por el scoring y la calle repetía el mismo
//  monto sin aumento (reporte de campo 08-05, caso 4).
// ─────────────────────────────────────────────────────────────────────────
describe("montoRenovacionSugerido (lo que se PROPONE en la oficina)", () => {
  it("la regla es +20% sobre el crédito anterior", () => {
    expect(RENOVACION_AUMENTO_PCT).toBe(20);
    expect(montoRenovacionSugerido(10000)).toBe(12000);
    expect(montoRenovacionSugerido(25000)).toBe(30000);
    expect(montoRenovacionSugerido(5000)).toBe(6000);
  });

  it("devuelve pesos ENTEROS aunque el anterior no sea redondo", () => {
    // 8.425 × 1,20 = 10.110 exacto. Y un monto que da decimales se redondea:
    // 8.333 × 1,20 = 9.999,6 → 10.000. Nunca sale un centavo a la calle.
    expect(montoRenovacionSugerido(8425)).toBe(10110);
    expect(montoRenovacionSugerido(8333)).toBe(10000);
    expect(Number.isInteger(montoRenovacionSugerido(7777))).toBe(true);
  });

  it("el CAP de $100.000 recorta el +20% (duro para todos, incluso el admin)", () => {
    // 90.000 + 20% = 108.000 → se recorta al cap.
    expect(montoRenovacionSugerido(90000)).toBe(RENOVACION_CAP_TOTAL);
    expect(montoRenovacionSugerido(100000)).toBe(RENOVACION_CAP_TOTAL);
    // 83.333 + 20% = 99.999,6 → 100.000: justo en el cap, no lo pasa.
    expect(montoRenovacionSugerido(83333)).toBe(RENOVACION_CAP_TOTAL);
  });

  it("nunca propone más que el cap, para ningún monto anterior", () => {
    for (let m = 500; m <= 120000; m += 500)
      expect(montoRenovacionSugerido(m)).toBeLessThanOrEqual(RENOVACION_CAP_TOTAL);
  });

  it("montos inválidos → 0 (el llamador decide qué hacer, no inventa plata)", () => {
    expect(montoRenovacionSugerido(0)).toBe(0);
    expect(montoRenovacionSugerido(-5000)).toBe(0);
    expect(montoRenovacionSugerido(Number.NaN)).toBe(0);
  });
});

describe("montoRenovacionAutoAprobable (lo que el COBRADOR coloca sin permiso)", () => {
  it("hasta $30.000 el tramo permite 20%: da exactamente el +20% del negocio", () => {
    // Es la enorme mayoría de la cartera: acá la regla se aplica tal cual.
    expect(montoRenovacionAutoAprobable(10000)).toBe(12000);
    expect(montoRenovacionAutoAprobable(30000)).toBe(36000);
    expect(montoRenovacionAutoAprobable(30000)).toBe(montoRenovacionSugerido(30000));
  });

  it("sobre $30.000 se recorta al tope del tramo (no al 20%)", () => {
    // 50.000: el negocio querría 60.000 pero el tramo tapa en +15% = 57.500.
    expect(montoRenovacionSugerido(50000)).toBe(60000);
    expect(montoRenovacionAutoAprobable(50000)).toBe(57500);
    // 80.000: tramo +10% = 88.000.
    expect(montoRenovacionAutoAprobable(80000)).toBe(88000);
    // >90.000: el tramo no admite aumento → se renueva por lo mismo.
    expect(montoRenovacionAutoAprobable(95000)).toBe(95000);
  });

  it("INVARIANTE: lo que ofrece la calle el servidor SIEMPRE lo acepta", () => {
    // La lista de "Renovar" no puede prometer un monto que después rebota: ese
    // fue justo el reclamo de campo (el cobrador queda parado frente al cliente).
    for (let m = 500; m <= RENOVACION_CAP_TOTAL; m += 500) {
      const nuevo = montoRenovacionAutoAprobable(m);
      const e = evaluarRenovacion(m, nuevo);
      expect(e.autoAprobable, `anterior ${m} → nuevo ${nuevo}`).toBe(true);
      expect(e.superaCap).toBe(false);
    }
  });

  it("nunca BAJA el capital del cliente", () => {
    for (let m = 500; m <= RENOVACION_CAP_TOTAL; m += 500)
      expect(montoRenovacionAutoAprobable(m)).toBeGreaterThanOrEqual(m);
  });

  it("montos inválidos → 0", () => {
    expect(montoRenovacionAutoAprobable(0)).toBe(0);
    expect(montoRenovacionAutoAprobable(-1)).toBe(0);
  });
});

describe("lo que no se puede aprobar solo va al admin (no es callejón sin salida)", () => {
  it("un crédito heredado por encima del tope requiere aprobación", () => {
    // 135 activos así, hasta $1.750.000. Antes desaparecían mudos de la lista de
    // "Renovar" y el error decía "lo tiene que renovar la oficina" — pero la
    // oficina tampoco podía. Ahora se pide y el admin autoriza.
    expect(requiereAprobacionAdmin(1_750_000)).toBe(true);
    expect(requiereAprobacionAdmin(120_000)).toBe(true);
  });

  it("lo pedido NUNCA le baja el capital al cliente", () => {
    // La trampa: `montoRenovacionSugerido` recorta al CAP, así que para un crédito
    // de $1.750.000 propondría $100.000 — una rebaja del 94% disfrazada de
    // renovación. `montoRenovacionPedido` no recorta.
    expect(montoRenovacionSugerido(1_750_000)).toBe(RENOVACION_CAP_TOTAL); // el recorte
    expect(montoRenovacionPedido(1_750_000)).toBe(1_750_000); // sin recorte
    for (const m of [110_000, 250_000, 843_200, 1_750_000])
      expect(montoRenovacionPedido(m)).toBeGreaterThanOrEqual(m);
  });

  it("un crédito grande se pide SIN aumento (su tramo no lo admite)", () => {
    // >$90.000 tiene tope 0%: se renueva por lo mismo. Lo conservador.
    expect(montoRenovacionPedido(1_750_000)).toBe(1_750_000);
    expect(montoRenovacionPedido(95_000)).toBe(95_000);
  });

  it("solo pide aprobación lo que YA venía por encima del tope", () => {
    // Propiedad que sale de los tramos: el aumento permitido baja a medida que el
    // crédito crece (20/15/10/0%), así que el monto pedido nunca CRUZA el cap por
    // sí solo — el techo de cada tramo es 36.000 / 69.000 / 99.000 / el mismo
    // monto. O sea: renovar nunca empuja a un crédito sano por encima del tope.
    for (let m = 500; m <= RENOVACION_CAP_TOTAL; m += 500)
      expect(requiereAprobacionAdmin(m), `anterior ${m}`).toBe(false);
    expect(requiereAprobacionAdmin(RENOVACION_CAP_TOTAL + 1)).toBe(true);
    expect(requiereAprobacionAdmin(1_750_000)).toBe(true);
  });

  it("monto inválido no pide nada", () => {
    expect(montoRenovacionPedido(0)).toBe(0);
    expect(requiereAprobacionAdmin(0)).toBe(false);
  });
});

describe("el +20% junto con la cuota (lo que el cliente termina pagando)", () => {
  it("subir el capital 20% sube la cuota 20%, manteniendo la tasa", () => {
    // Anterior: 10.000 → cuota 400 × 30 (tasa 1,2). Renovado a 12.000:
    // 12.000 × 1,2 / 30 = 480 = 400 + 20%.
    const nuevoMonto = montoRenovacionSugerido(ANT.monto);
    expect(nuevoMonto).toBe(12000);
    const cuota = calcularCuotaRenovacion(ANT, nuevoMonto, ANT.totalDias);
    expect(cuota).toBe(480);
    // El total a devolver también sube 20% y sigue siendo entero.
    expect(cuota * ANT.totalDias).toBe(14400);
  });

  // La cartera real tiene tasas MUY distintas y conviven: 0%, 3%, 3,5%, 20%…
  // (confirmado por Carlos, 06-08). El +20% sube el CAPITAL; la TASA de cada
  // cliente es suya y no se toca. Si alguna vez alguien "normaliza" todo al 20%,
  // estos tests se ponen en rojo: sería cobrarle de más a media cartera.
  describe("conserva la tasa REAL de cada crédito al renovar", () => {
    const CASOS = [
      { interesPct: 0, nombre: "sin interés" },
      { interesPct: 3, nombre: "3%" },
      { interesPct: 3.5, nombre: "3,5%" },
      { interesPct: 10, nombre: "10%" },
      { interesPct: 20, nombre: "20% (el grueso de la cartera)" },
    ];

    for (const { interesPct, nombre } of CASOS) {
      it(`crédito al ${nombre} → el renovado sigue al ${nombre}`, () => {
        const dias = 30;
        const montoAnt = 10000;
        const cuotaAnt = Math.round((montoAnt * (1 + interesPct / 100)) / dias);
        const anterior = { monto: montoAnt, cuota: cuotaAnt, totalDias: dias };

        const montoNuevo = montoRenovacionSugerido(montoAnt); // 12.000 (+20% capital)
        expect(montoNuevo).toBe(12000);

        const cuotaNueva = calcularCuotaRenovacion(anterior, montoNuevo, dias);
        // Interés efectivo del crédito nuevo, en puntos porcentuales.
        const efectivo = ((cuotaNueva * dias) / montoNuevo - 1) * 100;
        // Tolerancia por el redondeo de la cuota a peso entero, no por la tasa.
        expect(efectivo).toBeGreaterThan(interesPct - 0.3);
        expect(efectivo).toBeLessThan(interesPct + 0.3);
      });
    }

    it("el 0% NO se convierte en 20% por la regla del aumento", () => {
      // Prestó 10.000 y devuelve 10.000 (cuota 500 × 20). Renovar a 12.000 tiene
      // que devolver 12.000, no 14.400: el +20% es del capital, no del interés.
      const sinInteres = { monto: 10000, cuota: 500, totalDias: 20 };
      const nuevo = montoRenovacionSugerido(sinInteres.monto);
      const cuota = calcularCuotaRenovacion(sinInteres, nuevo, 20);
      expect(cuota).toBe(600);
      expect(cuota * 20).toBe(12000);
    });
  });

  it("con cuota heredada FRACCIONARIA la cuota nueva sale entera", () => {
    // Caso real de Disapp: 8.425 en 24 cuotas de 351,04 (tasa 1,0000…).
    const heredado = { monto: 8425, cuota: 8425 / 24, totalDias: 24 };
    const nuevo = montoRenovacionSugerido(heredado.monto); // 10.110
    const cuota = calcularCuotaRenovacion(heredado, nuevo, 24);
    expect(Number.isInteger(cuota)).toBe(true);
    expect(cuota).toBe(421); // 10.110 / 24 = 421,25 → 421
  });
});
