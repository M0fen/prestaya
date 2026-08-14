// Tests del núcleo de RENDICIÓN: esperado = recaudado − gastos (>=0), y
// diferencia/estado según lo entregado (cuadra / faltante / sobrante).
import { describe, expect, it } from "vitest";
import {
  calcularRendicion,
  cajaFinal,
  puedeEntregaDiferida,
  ENTREGA_DIFERIDA_VENTANA_DIAS,
} from "./rendicion";

describe("calcularRendicion", () => {
  it("entrega exacto lo recaudado (sin gastos) → cuadra", () => {
    const r = calcularRendicion(30000, 0, 30000);
    expect(r.esperado).toBe(30000);
    expect(r.diferencia).toBe(0);
    expect(r.estado).toBe("cuadra");
  });

  it("gastos de ruta bajan lo que debe entregar", () => {
    const r = calcularRendicion(30000, 2000, 28000);
    expect(r.esperado).toBe(28000); // 30.000 − 2.000
    expect(r.diferencia).toBe(0);
    expect(r.estado).toBe("cuadra");
  });

  it("entrega de menos → faltante (diferencia negativa, señal anti-fuga)", () => {
    const r = calcularRendicion(30000, 0, 25000);
    expect(r.esperado).toBe(30000);
    expect(r.diferencia).toBe(-5000);
    expect(r.estado).toBe("faltante");
  });

  it("entrega de más → sobrante", () => {
    const r = calcularRendicion(30000, 1000, 30000);
    expect(r.esperado).toBe(29000);
    expect(r.diferencia).toBe(1000);
    expect(r.estado).toBe("sobrante");
  });

  it("gastos mayores que lo recaudado no dejan un esperado negativo", () => {
    const r = calcularRendicion(1000, 5000, 0);
    expect(r.esperado).toBe(0);
    expect(r.diferencia).toBe(0);
    expect(r.estado).toBe("cuadra");
  });

  it("redondea a peso entero (nada de float)", () => {
    const r = calcularRendicion(1000.6, 0.2, 1000.4);
    expect(Number.isInteger(r.esperado)).toBe(true);
    expect(Number.isInteger(r.diferencia)).toBe(true);
  });

  // ── Base de caja (0105): esperado = base + recaudado − gastos ──
  it("sin base explícita se comporta EXACTO como antes (cero regresión)", () => {
    // 4 args con base=0 ≡ 3 args.
    expect(calcularRendicion(30000, 2000, 28000, 0)).toEqual(calcularRendicion(30000, 2000, 28000));
  });

  it("la base sube el esperado: debe devolver base + cobros − gastos", () => {
    // Arrancó con $5.000 de base, cobró $30.000, gastó $2.000 → debe entregar 33.000.
    const r = calcularRendicion(30000, 2000, 33000, 5000);
    expect(r.esperado).toBe(33000);
    expect(r.diferencia).toBe(0);
    expect(r.estado).toBe("cuadra");
  });

  it("con base, si NO devuelve la base → faltante (se la quedó)", () => {
    // Mismo caso pero entrega solo lo cobrado − gastos (28.000): falta la base.
    const r = calcularRendicion(30000, 2000, 28000, 5000);
    expect(r.esperado).toBe(33000);
    expect(r.diferencia).toBe(-5000);
    expect(r.estado).toBe("faltante");
  });

  it("base con gastos > base+recaudado no deja esperado negativo", () => {
    const r = calcularRendicion(1000, 9000, 0, 2000);
    expect(r.esperado).toBe(0); // max(0, 2000+1000−9000)
    expect(r.estado).toBe("cuadra");
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  LA CUADRA FINAL AMANECE COMO BASE (regla de Carlos, 06-08).
//  Lo que le queda al cobrador en la mano al cerrar es con lo que arranca al día
//  siguiente, sin que nadie tenga que acordarse de cargarlo a mano.
// ─────────────────────────────────────────────────────────────────────────
describe("cajaFinal — lo que queda en la mano, y es la base de mañana", () => {
  it("entrega todo → queda 0 y mañana arranca de cero", () => {
    // base 5.000 + cobró 20.000 − gastos 1.000 = 24.000 a entregar.
    expect(cajaFinal(5000, 20000, 1000, 24000)).toBe(0);
  });

  it("se guarda un float para salir a prestar → ESO es su base de mañana", () => {
    // De los 24.000 que debía entregar, entrega 18.000: le quedan 6.000.
    expect(cajaFinal(5000, 20000, 1000, 18000)).toBe(6000);
  });

  it("el caso real de esta mañana: sin base, cobró y entregó de menos", () => {
    // Karent: base 0, cobró 41.710, sin gastos, entrega 30.000 → le quedan 11.710.
    expect(cajaFinal(0, 41710, 0, 30000)).toBe(11710);
  });

  it("los gastos de ruta salen de su bolsillo y bajan la base de mañana", () => {
    expect(cajaFinal(10000, 5000, 3000, 0)).toBe(12000);
  });

  it("entregar de MÁS no deja base negativa: es un sobrante, no una deuda", () => {
    // Arrancar el día debiendo plata no es una cosa que exista: el sobrante lo
    // reporta `calcularRendicion.diferencia`, no la base.
    expect(cajaFinal(0, 10000, 0, 15000)).toBe(0);
    expect(calcularRendicion(10000, 0, 15000, 0).estado).toBe("sobrante");
  });

  it("no usa float: todo entero, aunque entren decimales", () => {
    const r = cajaFinal(1000.4, 2000.6, 500.5, 1000.5);
    expect(Number.isInteger(r)).toBe(true);
    // Cada término se redondea POR SEPARADO antes de restar: 1000 + 2001 − 501 − 1001.
    expect(r).toBe(1499);
  });

  it("encaja con la rendición: lo esperado menos lo entregado es lo que queda", () => {
    const base = 5000, recaudado = 20000, gastos = 1000, entregado = 18000;
    const { esperado } = calcularRendicion(recaudado, gastos, entregado, base);
    expect(cajaFinal(base, recaudado, gastos, entregado)).toBe(esperado - entregado);
  });
});

describe("aFavorDelCobrador — cuando la oficina le queda debiendo a ÉL", () => {
  it("colocó más capital del que tenía encima: no es 'cuadra ✓', es plata a favor", () => {
    // Caso real del 07-08: VÍCTOR MORALEZ cobró $26.980 y colocó $56.000 en 3
    // renovaciones. Puso $29.020 de su bolsillo. El max(0,…) del esperado se los
    // tragaba y el cierre le decía "Cuadra ✓" entregando $0, sin registrar nada.
    const r = calcularRendicion(26_980, 0, 0, 0, 56_000);
    expect(r.esperado).toBe(0);
    expect(r.aFavor).toBe(29_020);
  });

  it("el caso normal no tiene nada a favor", () => {
    // JUAN JOSÉ: base 48.733 + cobró 49.320 − colocó 40.000 = entrega 58.053.
    const r = calcularRendicion(49_320, 0, 58_053, 48_733, 40_000);
    expect(r.esperado).toBe(58_053);
    expect(r.estado).toBe("cuadra");
    expect(r.aFavor).toBe(0);
  });

  it("justo en el límite (colocó exactamente lo que tenía) tampoco hay saldo a favor", () => {
    const r = calcularRendicion(10_000, 0, 0, 5_000, 15_000);
    expect(r.esperado).toBe(0);
    expect(r.aFavor).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ENTREGA DIFERIDA (Fase 2 QA, 08-14): qué días puede sellar la oficina.
//  Bordes exactos con fechas FIJAS — este gate mueve actas inmutables.
// ═══════════════════════════════════════════════════════════════════════════
describe("puedeEntregaDiferida: hoy no, ayer sí, 30 días sí, 31 no", () => {
  const HOY = "2026-08-14";
  const LIMITE = "2026-07-15"; // HOY − 30 (lo calcula la action con sumarDiasYmd)

  it("AYER se puede: es el caso normal de la jornada que quedó abierta", () => {
    expect(puedeEntregaDiferida("2026-08-13", HOY, LIMITE).ok).toBe(true);
  });

  it("HOY no: el cierre de hoy es del cobrador (le cerrarían el día en plena calle)", () => {
    const v = puedeEntregaDiferida("2026-08-14", HOY, LIMITE);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toContain("el cobrador");
  });

  it("una fecha FUTURA tampoco (sellaría un acta de un día que no pasó)", () => {
    expect(puedeEntregaDiferida("2026-08-20", HOY, LIMITE).ok).toBe(false);
  });

  it("justo en el límite de 30 días se puede; un día más atrás, no", () => {
    expect(puedeEntregaDiferida("2026-07-15", HOY, LIMITE).ok).toBe(true);
    const v = puedeEntregaDiferida("2026-07-14", HOY, LIMITE);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toContain("30 días");
  });

  it("formatos rotos se rechazan (no se compara basura lexicográficamente)", () => {
    for (const mala of ["", "14/08/2026", "2026-8-14", "hoy", "2026-08-14T10:00"]) {
      expect(puedeEntregaDiferida(mala, HOY, LIMITE).ok).toBe(false);
    }
  });

  it("la ventana declarada es 30 días (si cambia, cambia la regla de negocio)", () => {
    expect(ENTREGA_DIFERIDA_VENTANA_DIAS).toBe(30);
  });
});
