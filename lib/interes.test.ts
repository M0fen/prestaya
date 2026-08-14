// ─────────────────────────────────────────────────────────────────────────
//  EL INTERÉS DEL CRÉDITO — el 20% se preserva, y nunca se presta a pérdida.
//
//  EL CASO QUE LO MOTIVÓ (10-08, reportado desde la calle). A JOSE RODRÍGUEZ la app
//  le ofrecía un crédito nuevo de $5.000 en 24 cuotas y mostraba "Paga en total
//  $4.992": un crédito que devuelve MENOS de lo que se entrega. La causa: sus seis
//  créditos anteriores vienen de Disapp con cuota $600 × 30 = $18.000 sobre un
//  capital de $18.000 — o sea 0% — y la renovación ARRASTRA la tasa del anterior.
//
//  Medido sobre la cartera viva ese día: 192 créditos activos al 0% ($72.113.554 de
//  capital) y 24 con tasa NEGATIVA. Esa cartera se reproducía sola en cada
//  renovación.
//
//  La regla de Carlos: el 20% se PRESERVA. Una tasa heredada de 0% o negativa no es
//  la tasa del cliente, es un dato roto → se cae al interés del negocio. Las tasas
//  REALES distintas del 20% que conviven (3%, 3,5%, 10-19%) son > 0 y se respetan.
//
//  ⚠️ DINERO REAL: toda cifra esperada es entera.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import {
  calcularCuotaRenovacion,
  factorConPiso,
  interesEfectivo,
  cuotasQueDanJusto,
  tasaImplicita,
  RENOVACION_AUMENTO_PCT,
} from "./renovacion";
import { calcularCuotaCreditoNuevo, interesDeBase, INTERES_DEFECTO_PCT } from "./creditoNuevo";

/** El crédito real de JOSE RODRÍGUEZ: $18.000, cuota $600 × 30 = 0%. */
const JOSE = { monto: 18_000, cuota: 600, totalDias: 30 };
/** Un crédito sano al 20%: $10.000, cuota $400 × 30 = $12.000. */
const SANO = { monto: 10_000, cuota: 400, totalDias: 30 };
/** Una tasa real baja pero legítima (3%): las hay en la cartera y se respetan. */
const TRES = { monto: 10_000, cuota: 343, totalDias: 30 }; // 10.290 = +2,9%

describe("NUNCA se presta a pérdida (el caso JOSE RODRÍGUEZ)", () => {
  it("el crédito de $5.000 en 24 cuotas ya no devuelve $4.992", () => {
    const cuota = calcularCuotaCreditoNuevo(JOSE, 5_000, 24, INTERES_DEFECTO_PCT);
    const total = cuota * 24;
    expect(total).toBeGreaterThan(5_000);
    expect(cuota).toBe(250); // 6.000 / 24
    expect(total).toBe(6_000); // 20% exacto
  });

  it("la tasa 0% heredada NO se arrastra: se cae al 20% del negocio", () => {
    expect(tasaImplicita(JOSE)).toBe(1); // el dato roto, tal cual está en la base
    expect(factorConPiso(JOSE)).toBeCloseTo(1 + RENOVACION_AUMENTO_PCT / 100, 10);
    expect(interesDeBase(JOSE)).toBeNull(); // "no hay tasa usable acá"
  });

  it("una tasa NEGATIVA tampoco se arrastra", () => {
    // 24 créditos activos así: cuota × días MENOR que el capital.
    const roto = { monto: 28_050, cuota: 1_000, totalDias: 28 }; // 28.000 < 28.050
    expect(interesDeBase(roto)).toBeNull();
    const cuota = calcularCuotaRenovacion(roto, 10_000, 30);
    expect(cuota * 30).toBeGreaterThan(10_000);
  });

  it("una tasa MICROSCÓPICA (<1%) tampoco se arrastra: es import roto, no un precio", () => {
    // Medido el 12-08: 82 créditos activos entre 0% y 1% ($7.764.720) y NINGUNO
    // entre 1% y 3% — la tasa real más baja que alguien pactó es 3%. Todo lo que
    // vive debajo del 1% es resto del empalme con Disapp, así que el umbral del
    // piso es 1%, no 0%.
    const micro = { monto: 30_000, cuota: 1_001, totalDias: 30 }; // 30.030 = +0,1%
    expect(interesDeBase(micro)).toBeNull();
    expect(factorConPiso(micro)).toBeCloseTo(1 + RENOVACION_AUMENTO_PCT / 100, 10);
    const cuota = calcularCuotaRenovacion(micro, 30_000, 30);
    expect(cuota * 30).toBe(36_000); // sale al 20% del negocio
  });

  it("renovar un crédito de 0% lo saca del 0%", () => {
    const cuota = calcularCuotaRenovacion(JOSE, 18_000, 30);
    expect(cuota).toBe(720); // 21.600 / 30
    expect(cuota * 30).toBe(21_600);
    expect(interesEfectivo(18_000, cuota, 30)).toBe(20);
  });
});

describe("las tasas REALES distintas del 20% se respetan tal cual", () => {
  it("un crédito al 20% renueva al 20%", () => {
    const cuota = calcularCuotaRenovacion(SANO, 10_000, 30);
    expect(cuota).toBe(400);
    expect(interesEfectivo(10_000, cuota, 30)).toBe(20);
  });

  it("un crédito al 2,9% NO se sube al 20%: el piso solo actúa donde se perdía plata", () => {
    // Forzar 20% acá sería cobrarle de más a media cartera — el error del 06-08.
    expect(interesDeBase(TRES)).toBe(2.9);
    const cuota = calcularCuotaRenovacion(TRES, 10_000, 30);
    expect(cuota).toBe(343);
    expect(interesEfectivo(10_000, cuota, 30)).toBe(2.9);
  });

  it("un crédito por encima del 20% conserva SU tasa", () => {
    const alto = { monto: 10_000, cuota: 500, totalDias: 30 }; // 15.000 = +50%
    expect(calcularCuotaRenovacion(alto, 10_000, 30)).toBe(500);
  });
});

describe("el interés que se MUESTRA es el real, con el redondeo adentro", () => {
  it("un caso exacto muestra 20,0%", () => {
    expect(interesEfectivo(7_000, 350, 24)).toBe(20); // 8.400
  });

  it("EL CASO DE LOS $2: 7.000 en 17 cuotas da 19,97%, no 20%", () => {
    // 8.400 / 17 = 494,12 → cuota 494 → 494 × 17 = 8.398. Con una cuota diaria
    // FIJA y entera no se puede tener el total exacto Y cualquier cantidad de
    // cuotas: por eso el número que se muestra es el REAL, no el nominal.
    const cuota = calcularCuotaCreditoNuevo(null, 7_000, 17, 20);
    expect(cuota).toBe(494);
    expect(cuota * 17).toBe(8_398);
    expect(interesEfectivo(7_000, cuota, 17)).toBe(20); // 19,971 → 20,0 con 1 decimal
  });

  it("distingue 0% y negativo, que es lo que hay que poder ver", () => {
    expect(interesEfectivo(18_000, 600, 30)).toBe(0);
    expect(interesEfectivo(28_050, 1_000, 28)).toBeLessThan(0);
  });

  it("con términos inválidos devuelve 0 en vez de NaN", () => {
    expect(interesEfectivo(0, 100, 10)).toBe(0);
    expect(interesEfectivo(1_000, 0, 10)).toBe(0);
    expect(interesEfectivo(1_000, 100, 0)).toBe(0);
  });
});

describe("la salida al problema de los centavos: cuántas cuotas dan JUSTO", () => {
  it("para 7.000 al 20% (8.400), sugiere una cantidad que divide exacto", () => {
    const n = cuotasQueDanJusto(7_000, 20, 17);
    expect(n).not.toBeNull();
    expect(8_400 % n!).toBe(0);
    // Y es la MÁS CERCANA a la pedida: 16 (8.400/16 = 525) está a 1 de distancia.
    expect(Math.abs(n! - 17)).toBeLessThanOrEqual(2);
  });

  it("si la pedida ya da justo, igual devuelve una válida o null sin romper", () => {
    const n = cuotasQueDanJusto(7_000, 20, 24);
    if (n !== null) expect(8_400 % n).toBe(0);
  });

  it("no propone nada absurdo: siempre entre 1 y 366", () => {
    for (const dias of [1, 2, 30, 360, 366]) {
      const n = cuotasQueDanJusto(9_973, 20, dias);
      if (n !== null) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(366);
      }
    }
  });

  it("con datos inválidos devuelve null, no explota", () => {
    expect(cuotasQueDanJusto(0, 20, 24)).toBeNull();
    expect(cuotasQueDanJusto(7_000, 20, 0)).toBeNull();
  });
});

describe("propiedad: ningún crédito nuevo puede devolver menos de lo prestado", () => {
  it("para cualquier base y cualquier combinación razonable", () => {
    const bases = [JOSE, SANO, TRES, null, { monto: 28_050, cuota: 1_000, totalDias: 28 }];
    for (const base of bases) {
      for (const monto of [1_000, 5_000, 7_000, 18_000, 99_000]) {
        for (const dias of [7, 17, 24, 30, 45]) {
          const cuota = calcularCuotaCreditoNuevo(base, monto, dias, INTERES_DEFECTO_PCT);
          expect(cuota * dias, `base=${JSON.stringify(base)} monto=${monto} dias=${dias}`).toBeGreaterThan(monto);
        }
      }
    }
  });
});
