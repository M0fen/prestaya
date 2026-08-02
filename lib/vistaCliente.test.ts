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
    expect(v.estadoGeneral).toBe("Tenés pagos pendientes");
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
    expect(v.fechaFinLarga).toContain("7 de julio"); // día 30 Lun–Sáb
  });

  it("próxima cuota: mañana, 17 de junio", () => {
    expect(v.proxRelativo).toBe("Mañana");
    expect(v.proxFechaLarga).toContain("17 de junio");
  });

  it("historial: 11 pagos, más reciente primero, abono etiquetado", () => {
    // FIFO: 10.500 abonados llenan los días 1–10 y dejan el abono de 500 en el
    // día 11 (frontera del acumulado) → 11 ítems, el más reciente es el día 11.
    expect(v.historial).toHaveLength(11);
    expect(v.historial[0].dia).toBe(11);
    expect(v.historial[0].estadoLabel).toBe("Abono parcial");
    expect(v.historial[0].monto).toBe("$500");
  });

  it("comprobante: el pago real (con hora) cae en la cuota que llena (FIFO)", () => {
    const dia11 = v.historial.find((h) => h.dia === 11)!;
    expect(dia11.pagos).toHaveLength(1);
    expect(dia11.pagos[0].monto).toBe("$500");
    expect(dia11.pagos[0].hora).toMatch(/^\d{2}:\d{2}$/);
    // Fecha de la cuota 11 en el cronograma Lun–Sáb (día 11 = lunes 15 de junio).
    expect(dia11.fechaLarga).toMatch(/15 de junio/);
  });

  it("30 casillas en el cartón, una marcada como hoy", () => {
    expect(v.dias).toHaveLength(30);
    expect(v.dias.filter((d) => d.esHoy)).toHaveLength(1);
  });

  it("crédito NO completado (demo va al 35%)", () => {
    expect(v.creditoCompletado).toBe(false);
  });
});

describe("construirVistaCliente — solo la cuota de HOY (no es atraso)", () => {
  // Días 1–11 pagados completos; el día 12 (HOY_DEMO) aún sin cobrar. No hay atraso.
  const v = construirVistaCliente({
    cliente: clienteMock,
    prestamo: prestamoMock,
    pagos: Array.from({ length: 11 }, (_, i) => ({ ...pagosMock[0], id: `d${i + 1}`, dia_credito: i + 1, monto: 1000 })),
    negocio: NEGOCIO,
    hoy: HOY_DEMO,
  });
  it("NO muestra 'ponerse al día' cuando lo único sin cubrir es la cuota de hoy", () => {
    // Regla de tono: hoy jamás es reproche. montoVencido = 0 aunque montoParaAlDia > 0.
    expect(v.necesitaPonerseAlDia).toBe(false);
    expect(v.montoParaAlDia).toBe("$1.000");
  });
  it("mensaje gentil de solo-hoy (sin reproche)", () => {
    expect(v.mensajeAliento).toMatch(/solo resta la cuota de hoy/i);
    expect(v.estadoGeneral).toBe("Te falta la cuota de hoy");
  });
});

describe("construirVistaCliente — pago adelantado (reconciliación del total)", () => {
  // 13 cuotas pagadas de una vez: cubre hasta hoy (día 12) + 1 día futuro (día 13).
  const v = construirVistaCliente({
    cliente: clienteMock,
    prestamo: prestamoMock,
    pagos: [{ ...pagosMock[0], id: "ade", dia_credito: 1, monto: 13000 }],
    negocio: NEGOCIO,
    hoy: HOY_DEMO,
  });
  it("expone el monto adelantado para que 'Pagado' cuadre con los recibos visibles", () => {
    // El día 13 (futuro) quedó cubierto por el adelanto → $1.000 adelantado.
    expect(v.montoAdelantado).toBe("$1.000");
  });
  it("sin adelanto → montoAdelantado null", () => {
    const v2 = construirVistaCliente({
      cliente: clienteMock, prestamo: prestamoMock, pagos: pagosMock, negocio: NEGOCIO, hoy: HOY_DEMO,
    });
    expect(v2.montoAdelantado).toBeNull();
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
