// Test del núcleo de SCORING. Fija el comportamiento del scorecard con
// escenarios reales: excelente, regular con mora, riesgo por incobrable
// (techo) y nuevo por datos insuficientes.
import { describe, expect, it } from "vitest";
import { calcularScore, evolucionScore, type EntradaScoring } from "./scoring";
import type { Pago, Prestamo } from "@/types/db";

const HOY = new Date(2026, 5, 16); // 16 jun 2026 (local)

function prestamo(over: Partial<Prestamo>): Prestamo {
  return {
    id: "p",
    cliente_id: "c",
    cobrador_id: null,
    monto_prestado: 10000,
    cuota_diaria: 1000,
    total_dias: 30,
    frecuencia: "diario",
    fecha_inicio: "2026-01-01",
    estado: "activo",
    creado_por: null,
    creado_en: "",
    actualizado_en: "",
    finalizado_en: null,
    ...over,
  };
}

/** Pagos completos para una lista de días de un préstamo. */
function pagosDias(prestamoId: string, dias: number[], monto = 1000): Pago[] {
  return dias.map((d) => ({
    id: `${prestamoId}-${d}`,
    prestamo_id: prestamoId,
    dia_credito: d,
    monto,
    registrado_por: null,
    registrado_en: "2026-01-01T10:00:00Z",
    gps_lat: null,
    gps_lng: null,
    anulado: false,
    anulado_por: null,
    anulado_en: null,
    motivo_anulacion: null,
  }));
}

const rango = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function correr(
  prestamos: Prestamo[],
  pagos: Record<string, Pago[]>,
): ReturnType<typeof calcularScore> {
  const entrada: EntradaScoring = { prestamos, pagosPorPrestamo: pagos, hoy: HOY };
  return calcularScore(entrada);
}

describe("evolucionScore", () => {
  it("serie mensual desde el primer crédito hasta hoy; el último punto coincide con el score actual", () => {
    const a = prestamo({ id: "a", estado: "activo", fecha_inicio: "2026-01-01", total_dias: 180 });
    const pagos = { a: pagosDias("a", rango(120)) };
    const serie = evolucionScore({ prestamos: [a], pagosPorPrestamo: pagos, hoy: HOY });
    expect(serie.length).toBe(6); // ene, feb, mar, abr, may, jun
    expect(serie[serie.length - 1].fecha).toBe("2026-06-16");
    const full = calcularScore({ prestamos: [a], pagosPorPrestamo: pagos, hoy: HOY });
    expect(serie[serie.length - 1].puntaje).toBe(full.puntaje);
    expect(serie[serie.length - 1].banda).toBe(full.banda);
  });

  it("respeta el tope de puntos (últimos N meses)", () => {
    const a = prestamo({ id: "a", estado: "finalizado", fecha_inicio: "2025-01-01", total_dias: 30 });
    const serie = evolucionScore(
      { prestamos: [a], pagosPorPrestamo: { a: pagosDias("a", rango(30)) }, hoy: HOY },
      { puntos: 4 },
    );
    expect(serie.length).toBe(4);
  });

  it("cliente sin créditos → serie vacía", () => {
    expect(evolucionScore({ prestamos: [], pagosPorPrestamo: {}, hoy: HOY })).toEqual([]);
  });
});

describe("calcularScore", () => {
  it("excelente: 2 créditos pagados + activo al día → pre-aprobado", () => {
    const a = prestamo({ id: "a", estado: "finalizado", fecha_inicio: "2026-01-01", monto_prestado: 15000 });
    const b = prestamo({ id: "b", estado: "finalizado", fecha_inicio: "2026-03-01", monto_prestado: 15000 });
    const c = prestamo({ id: "c", estado: "activo", fecha_inicio: "2026-06-07", monto_prestado: 20000 });

    const r = correr([a, b, c], {
      a: pagosDias("a", rango(30)),
      b: pagosDias("b", rango(30)),
      c: pagosDias("c", rango(10)), // hoy = día 10, todos pagos
    });

    expect(r.banda).toBe("excelente");
    expect(r.puntaje).toBeGreaterThanOrEqual(800);
    expect(r.datosSuficientes).toBe(true);
    expect(r.metricas.creditosFinalizados).toBe(2);
    expect(r.metricas.diasAtrasoActual).toBe(0);
    expect(r.recomendacion.accion).toBe("preaprobado");
    // Último préstamo (más reciente) = activo $20.000 → +30% = $26.000.
    expect(r.recomendacion.montoSugerido).toBe(26000);
  });

  it("regular: activo con 1 día de atraso → revisar", () => {
    // Inicio = hoy − 11 → hoy es el día 12. Días 1..10 pagos; 11 atrasado; 12 hoy.
    const c = prestamo({ id: "c", estado: "activo", fecha_inicio: "2026-06-05", monto_prestado: 12000 });
    const r = correr([c], { c: pagosDias("c", rango(10)) });

    expect(r.metricas.diasAtrasoActual).toBe(1);
    expect(r.datosSuficientes).toBe(true);
    expect(r.banda).toBe("regular");
    expect(r.recomendacion.accion).toBe("revisar");
  });

  it("riesgo: un incobrable aplica TECHO al puntaje aunque tenga un activo sano", () => {
    const malo = prestamo({ id: "m", estado: "incobrable", fecha_inicio: "2026-02-01", monto_prestado: 10000 });
    const act = prestamo({ id: "x", estado: "activo", fecha_inicio: "2026-06-11", monto_prestado: 10000 });
    const r = correr([malo, act], {
      m: pagosDias("m", [1, 2, 3]), // pagó 3 de 30 y se cortó
      x: pagosDias("x", rango(6)), // hoy = día 6, al día
    });

    expect(r.metricas.incobrables).toBe(1);
    expect(r.puntaje).toBe(350); // techo por incobrable
    expect(r.banda).toBe("riesgo");
    expect(r.recomendacion.accion).toBe("no_recomendado");
  });

  it("nuevo: poca historia → datos insuficientes, evaluación manual", () => {
    const c = prestamo({ id: "c", estado: "activo", fecha_inicio: "2026-06-14", monto_prestado: 8000 });
    const r = correr([c], { c: pagosDias("c", [1]) }); // hoy = día 3, solo 3 exigibles

    expect(r.datosSuficientes).toBe(false);
    expect(r.banda).toBe("nuevo");
    expect(r.recomendacion.accion).toBe("manual");
    expect(r.recomendacion.montoSugerido).toBe(8000);
  });

  it("los factores explican el puntaje (desglose visible para el operador)", () => {
    const c = prestamo({ id: "c", estado: "activo", fecha_inicio: "2026-06-07" });
    const r = correr([c], { c: pagosDias("c", rango(10)) });
    const claves = r.factores.map((f) => f.clave);
    expect(claves).toContain("cumplimiento");
    expect(claves).toContain("mora_actual");
    // La suma de aportes positivos no supera el puntaje máximo.
    const total = r.factores.reduce((s, f) => s + f.puntos, 0);
    expect(total).toBeLessThanOrEqual(1000);
  });
});
