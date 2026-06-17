// Tests del NÚCLEO financiero (calcularEstadosCarton) sobre tipos reales.
// Cubren: estados de día, totales, próxima cuota, regla de oro de HOY,
// suma de abonos y la normalización de "hoy" con hora.
import { describe, expect, it } from "vitest";
import { calcularEstadosCarton } from "./cartones";
import { parseFecha } from "./format";
import type { Pago, Prestamo } from "@/types/db";

/** Préstamo base de prueba: 30 días, cuota 20.000, inicia 2026-06-03. */
const prestamoBase: Pick<Prestamo, "cuota_diaria" | "total_dias" | "fecha_inicio"> =
  {
    cuota_diaria: 20000,
    total_dias: 30,
    fecha_inicio: "2026-06-03",
  };

/** Pagos base: días 1–10 completos + abono parcial el día 12 (hoy). */
const pagosBase: Pick<Pago, "dia_credito" | "monto">[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ dia_credito: i + 1, monto: 20000 })),
  { dia_credito: 12, monto: 10000 },
];

const HOY = parseFecha("2026-06-14");

describe("calcularEstadosCarton — totales (caso base)", () => {
  const r = calcularEstadosCarton(prestamoBase, pagosBase, HOY);

  it("total a pagar = cuota × días", () => {
    expect(r.totalAPagar).toBe(600000);
  });
  it("total pagado = 10×20.000 + 10.000", () => {
    expect(r.totalPagado).toBe(210000);
  });
  it("falta = total − pagado", () => {
    expect(r.falta).toBe(390000);
  });
  it("progreso = 35%", () => {
    expect(r.progresoPct).toBe(35);
  });
  it("día actual = 12", () => {
    expect(r.diaActual).toBe(12);
  });
  it("hay pendientes", () => {
    expect(r.hayPendiente).toBe(true);
  });
  it("mejor racha = 10 (días 1–10 al hilo)", () => {
    expect(r.mejorRacha).toBe(10);
  });
  it("monto para ponerse al día = día 11 (20.000) + falta de hoy (10.000)", () => {
    expect(r.montoParaAlDia).toBe(30000);
  });
  it("fecha de finalización = día 30 (2026-07-02)", () => {
    expect(r.fechaFin).toBe("2026-07-02");
  });
});

describe("calcularEstadosCarton — estados por día (caso base)", () => {
  const r = calcularEstadosCarton(prestamoBase, pagosBase, HOY);
  const estadoDe = (dia: number) => r.dias.find((d) => d.dia === dia)!.estado;

  it("días 1–10 pagados", () => {
    for (let d = 1; d <= 10; d++) expect(estadoDe(d)).toBe("pagado");
  });
  it("día 11 (pasado sin pago) atrasado", () => {
    expect(estadoDe(11)).toBe("atrasado");
  });
  it("día 12 (hoy, abono parcial) pendiente", () => {
    expect(estadoDe(12)).toBe("pendiente");
    expect(r.dias.find((d) => d.dia === 12)!.esHoy).toBe(true);
  });
  it("días 13–30 futuros", () => {
    for (let d = 13; d <= 30; d++) expect(estadoDe(d)).toBe("futuro");
  });
});

describe("calcularEstadosCarton — regla de oro: HOY nunca es atrasado", () => {
  it("hoy sin ningún pago queda pendiente, no atrasado", () => {
    const sinPagoHoy = pagosBase.filter((p) => p.dia_credito !== 12);
    const r = calcularEstadosCarton(prestamoBase, sinPagoHoy, HOY);
    expect(r.dias.find((d) => d.dia === 12)!.estado).toBe("pendiente");
  });
});

describe("calcularEstadosCarton — normaliza 'hoy' con hora", () => {
  it("una fecha con hora se trata igual que medianoche", () => {
    const hoyConHora = new Date(2026, 5, 14, 17, 45, 30); // 14-jun 17:45
    const r = calcularEstadosCarton(prestamoBase, pagosBase, hoyConHora);
    expect(r.diaActual).toBe(12);
    expect(r.dias.find((d) => d.dia === 12)!.esHoy).toBe(true);
  });
});

describe("calcularEstadosCarton — suma varios abonos del mismo día", () => {
  it("dos abonos de 8.000 + 12.000 completan la cuota (pagado)", () => {
    const pagos = [
      { dia_credito: 12, monto: 8000 },
      { dia_credito: 12, monto: 12000 },
    ];
    const r = calcularEstadosCarton(prestamoBase, pagos, HOY);
    expect(r.dias.find((d) => d.dia === 12)!.montoPagado).toBe(20000);
    expect(r.dias.find((d) => d.dia === 12)!.estado).toBe("pagado");
  });
});

describe("calcularEstadosCarton — próxima cuota", () => {
  it("primer día futuro con días restantes", () => {
    const r = calcularEstadosCarton(prestamoBase, pagosBase, HOY);
    expect(r.proxima).not.toBeNull();
    expect(r.proxima!.dia).toBe(13);
    expect(r.proxima!.fecha).toBe("2026-06-15");
    expect(r.proxima!.diasRestantes).toBe(1); // mañana
  });

  it("sin días futuros → null", () => {
    const corto = { cuota_diaria: 20000, total_dias: 1, fecha_inicio: "2026-06-14" };
    const r = calcularEstadosCarton(corto, [{ dia_credito: 1, monto: 20000 }], HOY);
    expect(r.proxima).toBeNull();
  });
});

describe("calcularEstadosCarton — al día (sin pendientes)", () => {
  it("todos los días vencidos pagados → no hay pendientes y falta 0", () => {
    const prestamo = { cuota_diaria: 20000, total_dias: 3, fecha_inicio: "2026-06-12" };
    const pagos = [
      { dia_credito: 1, monto: 20000 },
      { dia_credito: 2, monto: 20000 },
      { dia_credito: 3, monto: 20000 },
    ];
    const r = calcularEstadosCarton(prestamo, pagos, HOY);
    expect(r.hayPendiente).toBe(false);
    expect(r.falta).toBe(0);
    expect(r.montoParaAlDia).toBe(0);
  });
});
