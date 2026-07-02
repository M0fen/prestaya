// Tests del núcleo de INSIGHTS (generarInsights). Fija que las señales más
// graves suban primero, que cada regla dispare cuando corresponde y que un
// negocio sano devuelva una lectura positiva.
import { describe, expect, it } from "vitest";
import { generarInsights, type EntradaInsights } from "./insights";

/** Entrada base "sana": sin mora, sin anomalías, recaudo normal. */
function base(over: Partial<EntradaInsights> = {}): EntradaInsights {
  return {
    moraPct: 0,
    montoEnMora: 0,
    morosos: 0,
    criticos: 0,
    carteraPorCobrar: 500000,
    recaudadoHoy: 20000,
    recaudadoMes: 400000,
    topRiesgo: [],
    cobradores: [],
    alertas: [],
    serie: { promedio: 20000, hoy: 20000, tendencia: 0 },
    ...over,
  };
}

describe("generarInsights", () => {
  it("negocio sano → una sola lectura positiva 'operación en orden'", () => {
    const r = generarInsights(base());
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("todo-ok");
    expect(r[0].tono).toBe("bueno");
  });

  it("prioriza lo más grave: fuera de zona por encima de la mora", () => {
    const r = generarInsights(
      base({
        criticos: 2,
        montoEnMora: 30000,
        moraPct: 0.2,
        alertas: [
          { severidad: "alta", titulo: "Pago fuera de zona", detalle: "X cobró lejos" },
        ],
      }),
    );
    expect(r[0].id).toBe("fuera-zona");
    expect(r[0].tono).toBe("critico");
    // La mora crítica sigue apareciendo, pero después.
    expect(r.some((i) => i.id === "mora-critica")).toBe(true);
  });

  it("mora crítica pesa más que mora alta (no duplica)", () => {
    const r = generarInsights(base({ criticos: 1, morosos: 3, montoEnMora: 40000, moraPct: 0.25 }));
    expect(r.some((i) => i.id === "mora-critica")).toBe(true);
    expect(r.some((i) => i.id === "mora-alta")).toBe(false);
  });

  it("mora alta (sin críticos) dispara alerta", () => {
    const r = generarInsights(base({ morosos: 2, montoEnMora: 30000, moraPct: 0.18 }));
    const m = r.find((i) => i.id === "mora-alta");
    expect(m).toBeDefined();
    expect(m!.tono).toBe("alerta");
  });

  it("cliente de mayor deuda vencida aparece con su pregunta al asesor", () => {
    const r = generarInsights(
      base({
        topRiesgo: [
          { nombre: "Ana", deudaVencida: 5000, diasSinPagar: 4, nivel: "alto", cobrador: "Pedro" },
          { nombre: "Beto", deudaVencida: 12000, diasSinPagar: 9, nivel: "crítico", cobrador: null },
        ],
      }),
    );
    const i = r.find((x) => x.id === "cliente-riesgo");
    expect(i).toBeDefined();
    expect(i!.titulo).toContain("Beto"); // el de mayor deuda, no el primero
    expect(i!.pregunta).toContain("Beto");
  });

  it("cobrador rezagado (<45%) dispara; buen recaudo del día es positivo", () => {
    const r = generarInsights(
      base({
        recaudadoHoy: 30000,
        serie: { promedio: 20000, hoy: 30000, tendencia: 0.2 },
        cobradores: [
          { nombre: "Lento", recaudado: 2000, esperado: 10000, progresoPct: 20, anomalias: 0 },
        ],
      }),
    );
    expect(r.some((i) => i.id === "cobrador-rezagado")).toBe(true);
    expect(r.some((i) => i.id === "recaudo-bueno")).toBe(true);
  });

  it("respeta el límite de insights", () => {
    const r = generarInsights(
      base({
        criticos: 3,
        moraPct: 0.3,
        montoEnMora: 90000,
        alertas: [
          { severidad: "alta", titulo: "Pago fuera de zona", detalle: "x" },
          { severidad: "media", titulo: "Float alto sin rendir", detalle: "y lleva $30.000" },
        ],
        topRiesgo: [{ nombre: "Z", deudaVencida: 8000, diasSinPagar: 6, nivel: "crítico", cobrador: "P" }],
        cobradores: [{ nombre: "L", recaudado: 1000, esperado: 9000, progresoPct: 11, anomalias: 1 }],
      }),
      3,
    );
    expect(r).toHaveLength(3);
    expect(r[0].id).toBe("fuera-zona");
  });
});
