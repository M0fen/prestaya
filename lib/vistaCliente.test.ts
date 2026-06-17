// Test de la capa de PRESENTACIÓN: formato en pesos, inicial, estado general,
// próxima cuota e historial (orden y etiquetas).
import { describe, expect, it } from "vitest";
import { construirVistaCliente } from "./vistaCliente";
import { NEGOCIO } from "./negocio";
import { clienteMock, pagosMock, prestamoMock, HOY_DEMO } from "./mock/loanData";

describe("construirVistaCliente (demo)", () => {
  const v = construirVistaCliente({
    cliente: clienteMock,
    prestamo: prestamoMock,
    pagos: pagosMock,
    negocio: NEGOCIO,
    hoy: HOY_DEMO,
  });

  it("formatea montos en pesos (UYU)", () => {
    expect(v.totalAPagar).toBe("$30.000"); // 1.000 × 30
    expect(v.totalPagado).toBe("$10.500"); // 10×1.000 + 500
    expect(v.falta).toBe("$19.500"); // 30.000 − 10.500
    expect(v.cuotaDiaria).toBe("$1.000");
  });

  it("deriva la inicial del nombre", () => {
    expect(v.inicial).toBe("M");
  });

  it("estado general con pendientes", () => {
    expect(v.estadoGeneral).toBe("Tienes pagos pendientes");
    expect(v.progresoTexto).toBe("35%");
    expect(v.alDia).toBe(false);
  });

  it("mensaje de aliento positivo (no culpa) y racha", () => {
    expect(v.mensajeAliento).toMatch(/buen camino|sigamos|excelente/i);
    expect(v.mejorRacha).toBe(10);
  });

  it("ponerse al día: $1.500 y fecha de finalización en julio", () => {
    expect(v.necesitaPonerseAlDia).toBe(true);
    expect(v.montoParaAlDia).toBe("$1.500"); // día 11 ($1.000) + falta de hoy ($500)
    expect(v.fechaFinLarga).toContain("2 de julio");
  });

  it("próxima cuota: mañana, 15 de junio", () => {
    expect(v.proxRelativo).toBe("Mañana");
    expect(v.proxFechaLarga).toContain("15 de junio");
  });

  it("historial: 11 pagos, más reciente primero, abono etiquetado", () => {
    expect(v.historial).toHaveLength(11);
    expect(v.historial[0].dia).toBe(12);
    expect(v.historial[0].estadoLabel).toBe("Abono parcial");
    expect(v.historial[0].monto).toBe("$500");
  });

  it("comprobante: cada día trae sus pagos con hora y fecha larga", () => {
    const dia12 = v.historial.find((h) => h.dia === 12)!;
    expect(dia12.pagos).toHaveLength(1);
    expect(dia12.pagos[0].monto).toBe("$500");
    expect(dia12.pagos[0].hora).toMatch(/^\d{2}:\d{2}$/);
    expect(dia12.fechaLarga).toMatch(/14 de junio/);
  });

  it("30 casillas en el cartón, una marcada como hoy", () => {
    expect(v.dias).toHaveLength(30);
    expect(v.dias.filter((d) => d.esHoy)).toHaveLength(1);
  });

  it("crédito NO completado (demo va al 35%)", () => {
    expect(v.creditoCompletado).toBe(false);
  });
});

describe("construirVistaCliente — crédito completado", () => {
  it("falta 0 → creditoCompletado true", () => {
    const v = construirVistaCliente({
      cliente: clienteMock,
      prestamo: { ...prestamoMock, total_dias: 3, fecha_inicio: "2026-06-12" },
      pagos: [1, 2, 3].map((d) => ({
        ...pagosMock[0],
        id: `p${d}`,
        dia_credito: d,
        monto: 1000,
      })),
      negocio: NEGOCIO,
      hoy: HOY_DEMO,
    });
    expect(v.creditoCompletado).toBe(true);
    expect(v.falta).toBe("$0");
  });
});
