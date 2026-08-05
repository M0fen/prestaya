// Tests del NÚCLEO financiero (calcularEstadosCarton) sobre tipos reales.
// Cubren: estados de día, totales, próxima cuota, regla de oro de HOY,
// suma de abonos y la normalización de "hoy" con hora.
import { describe, expect, it } from "vitest";
import { calcularEstadosCarton, fechaDeCuota, plazoVencido, totalCredito, saldoCredito } from "./cartones";
import { parseFecha, toIso } from "./format";
import type { Pago, Prestamo } from "@/types/db";

// Deuda #9: los helpers canónicos deben coincidir con lo que calcula el cartón,
// para que reemplazar los hand-rewrites (mora/reconciliación/ruta) no mueva ningún
// número. Se fija la equivalencia, incluida la cuota fraccionaria y el sobre-pago.
describe("totalCredito / saldoCredito — equivalentes al cartón (deuda #9)", () => {
  const casos: { cuota: number; dias: number; pagado: number }[] = [
    { cuota: 20000, dias: 30, pagado: 210000 },   // parcial
    { cuota: 20000, dias: 30, pagado: 0 },         // nada pagado
    { cuota: 20000, dias: 30, pagado: 600000 },    // saldado exacto
    { cuota: 20000, dias: 30, pagado: 999999 },    // sobre-pago → falta 0
    { cuota: 351.04, dias: 24, pagado: 8424 },     // cuota fraccionaria (Disapp)
  ];
  it("totalCredito === carton.totalAPagar y saldoCredito === carton.falta", () => {
    for (const c of casos) {
      const pagos = c.pagado > 0 ? [{ dia_credito: 1, monto: c.pagado }] : [];
      const r = calcularEstadosCarton(
        { cuota_diaria: c.cuota, total_dias: c.dias, fecha_inicio: "2026-06-03" },
        pagos,
        parseFecha("2026-07-03"),
      );
      expect(totalCredito(c.cuota, c.dias)).toBe(c.cuota * c.dias);
      expect(saldoCredito(c.cuota, c.dias, c.pagado)).toBeCloseTo(r.falta, 6);
    }
  });
  it("saldoCredito nunca es negativo (sobre-pago → 0)", () => {
    expect(saldoCredito(20000, 30, 700000)).toBe(0);
  });
});

// ── Cuota FRACCIONARIA de Disapp + pagos ENTEROS (QA 08-05) ────────────────
// El FIFO concentra el residuo (0,04×k) en el día frontera: con la tolerancia
// FIJA de 0,5, a la cuota 13 un cliente que pagó PERFECTO ($351 cada día de una
// cuota de 351,04) pasaba a "Abono parcial · Tenés pagos pendientes" (40
// cartones ya estaban así en la base). La tolerancia acumulativa (f×día) lo
// arregla SIN aflojar las cuotas enteras (f=0 → tolerancia 0,5 como siempre).
describe("cuota fraccionaria + pagos enteros — el cliente perfecto nunca queda 'pendiente'", () => {
  const cred = { cuota_diaria: 351.04, total_dias: 24, fecha_inicio: "2026-06-03" };
  const pagosEnteros = (k: number) =>
    Array.from({ length: k }, (_, i) => ({ dia_credito: i + 1, monto: 351 }));

  it("13 pagos enteros: los 13 días PAGADOS (antes el 13º caía a 'pendiente')", () => {
    // Día 15 del crédito (Lun–Sáb desde mié 03-jun) — con 13 cuotas pagas al día 13.
    const r = calcularEstadosCarton(cred, pagosEnteros(13), parseFecha("2026-06-17"));
    expect(r.dias.slice(0, 13).every((d) => d.estado === "pagado")).toBe(true);
  });

  it("24 pagos enteros (crédito completo): sin vencido, sin 'ponerse al día' fantasma", () => {
    const r = calcularEstadosCarton(cred, pagosEnteros(24), parseFecha("2026-07-10"));
    expect(r.dias.every((d) => d.estado === "pagado")).toBe(true);
    expect(r.montoVencido).toBe(0);
    expect(r.montoParaAlDia).toBe(0);
    // El residuo incobrable queda en falta (0,96) — los umbrales <1 lo absorben.
    expect(r.falta).toBeLessThan(1);
  });

  it("un abono parcial REAL sigue sin pasar (no se aflojó de más)", () => {
    // 12 cuotas justas + $300 de la 13ª (faltan $51): el día 13 NO es pagado.
    const pagos = [...pagosEnteros(12), { dia_credito: 13, monto: 300 }];
    const r = calcularEstadosCarton(cred, pagos, parseFecha("2026-06-17"));
    expect(r.dias[12].estado).toBe("pendiente");
  });

  it("cuota ENTERA: la tolerancia sigue siendo 0,5 (un peso menos = pendiente)", () => {
    const r = calcularEstadosCarton(
      { cuota_diaria: 300, total_dias: 30, fecha_inicio: "2026-06-03" },
      [{ dia_credito: 1, monto: 299 }],
      parseFecha("2026-06-04"),
    );
    expect(r.dias[0].estado).toBe("pendiente");
  });
});

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

// Con cobro Lun–Sáb, la 12ª cuota diaria del crédito (inicio miércoles 03-jun)
// cae el martes 16-jun (03-jun era la 1ª; se saltea el domingo 07 y el 14).
const HOY = parseFecha("2026-06-16");

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
  it("día en curso = 12 (en un día de cobro coincide con diaActual)", () => {
    expect(r.diaEnCurso).toBe(12);
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
  it("fecha de finalización = día 30 (Lun–Sáb → 2026-07-07)", () => {
    expect(r.fechaFin).toBe("2026-07-07");
  });
});

describe("diaEnCurso — avance mostrado robusto (domingos y plazo vencido)", () => {
  it("DOMINGO: diaActual cae a 0, pero diaEnCurso se queda en el día del sábado (no 'Día 0/30')", () => {
    // 2026-06-07 es domingo. El día de cobro no cae domingo → diaActual = 0.
    // Días con fecha ≤ domingo: 1(mié 03) 2(jue 04) 3(vie 05) 4(sáb 06) → diaEnCurso = 4.
    const r = calcularEstadosCarton(prestamoBase, [], parseFecha("2026-06-07"));
    expect(r.diaActual).toBe(0); // hoy no es día de cobro
    expect(r.diaEnCurso).toBe(4); // el avance NO se rompe: "Día 4/30"
  });

  it("PLAZO VENCIDO: pasado el último día, diaEnCurso llega a total_dias (no 0)", () => {
    // 2026-07-20 es posterior al día 30 (2026-07-07) → diaActual 0, avance completo.
    const r = calcularEstadosCarton(prestamoBase, [], parseFecha("2026-07-20"));
    expect(r.diaActual).toBe(0);
    expect(r.diaEnCurso).toBe(30); // "Día 30/30", no "Día 0/30"
  });

  it("antes de arrancar (hoy < fecha_inicio): diaEnCurso 0 (el crédito aún no empezó)", () => {
    const r = calcularEstadosCarton(prestamoBase, [], parseFecha("2026-06-01"));
    expect(r.diaEnCurso).toBe(0);
  });
});

describe("calcularEstadosCarton — estados por día (caso base)", () => {
  const r = calcularEstadosCarton(prestamoBase, pagosBase, HOY);
  const estadoDe = (dia: number) => r.dias.find((d) => d.dia === dia)!.estado;

  it("días 1–10 pagados", () => {
    for (let d = 1; d <= 10; d++) expect(estadoDe(d)).toBe("pagado");
  });
  it("día 11 (frontera del acumulado: cae el abono parcial de 10.000) pendiente", () => {
    // FIFO: 210.000 abonados llenan los días 1–10 (20.000 c/u) y dejan 10.000
    // en el día 11 → abono parcial → pendiente (antes, con el modelo por fecha
    // exacta, este día quedaba "atrasado"; FIFO es lo correcto para cobro diario).
    expect(estadoDe(11)).toBe("pendiente");
    expect(r.dias.find((d) => d.dia === 11)!.montoPagado).toBe(10000);
  });
  it("día 12 (hoy, sin plata restante) pendiente por regla de HOY", () => {
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

describe("calcularEstadosCarton — montoVencido EXCLUYE hoy (mora precisa)", () => {
  it("base: montoVencido cuenta solo lo vencido de verdad (sin la cuota de hoy)", () => {
    const r = calcularEstadosCarton(prestamoBase, pagosBase, HOY);
    // FIFO: 210.000 abonados llenan días 1–10 completos + día 11 parcial (10.000);
    // hoy (día 12) queda sin pagar (20.000). montoParaAlDia = 10.000 (día 11) +
    // 20.000 (hoy) = 30.000; montoVencido EXCLUYE hoy → solo el día 11 = 10.000.
    expect(r.montoParaAlDia).toBe(30000);
    expect(r.montoVencido).toBe(10000);
  });
  it("cliente que SOLO debe hoy → montoVencido 0 (nada venció aún)", () => {
    // Pagó los días 1–11 completos (FIFO); hoy (día 12) sin pagar.
    const pagos = Array.from({ length: 11 }, (_, i) => ({ dia_credito: i + 1, monto: 20000 }));
    const r = calcularEstadosCarton(prestamoBase, pagos, HOY);
    expect(r.montoVencido).toBe(0);
    expect(r.montoParaAlDia).toBe(20000); // solo la cuota de hoy
  });
});

describe("calcularEstadosCarton — normaliza 'hoy' con hora", () => {
  it("una fecha con hora se trata igual que medianoche", () => {
    const hoyConHora = new Date(2026, 5, 16, 17, 45, 30); // 16-jun 17:45 (día 12)
    const r = calcularEstadosCarton(prestamoBase, pagosBase, hoyConHora);
    expect(r.diaActual).toBe(12);
    expect(r.dias.find((d) => d.dia === 12)!.esHoy).toBe(true);
  });
});

describe("calcularEstadosCarton — suma varios abonos (acumulado)", () => {
  it("dos abonos de 8.000 + 12.000 completan una cuota (pagado)", () => {
    // FIFO: 20.000 abonados llenan la 1ª cuota, sin importar en qué día se pagó.
    const prestamo = { cuota_diaria: 20000, total_dias: 1, fecha_inicio: "2026-06-14" };
    const pagos = [
      { dia_credito: 99, monto: 8000 }, // dia_credito ya NO se usa (era el bug)
      { dia_credito: 99, monto: 12000 },
    ];
    const r = calcularEstadosCarton(prestamo, pagos, HOY);
    expect(r.dias[0].montoPagado).toBe(20000);
    expect(r.dias[0].estado).toBe("pagado");
  });
});

describe("calcularEstadosCarton — próxima cuota", () => {
  it("primer día futuro con días restantes", () => {
    const r = calcularEstadosCarton(prestamoBase, pagosBase, HOY);
    expect(r.proxima).not.toBeNull();
    expect(r.proxima!.dia).toBe(13);
    expect(r.proxima!.fecha).toBe("2026-06-17"); // miércoles siguiente a hoy (mar 16)
    expect(r.proxima!.diasRestantes).toBe(1); // mañana
  });

  it("sin días futuros → null", () => {
    const corto = { cuota_diaria: 20000, total_dias: 1, fecha_inicio: "2026-06-14" };
    const r = calcularEstadosCarton(corto, [{ dia_credito: 1, monto: 20000 }], HOY);
    expect(r.proxima).toBeNull();
  });

  // Regresión: pago ADELANTADO. El excedente FIFO "llena" cuotas futuras; próxima
  // debe saltear las ya cubiertas (si no, le pedía pagar una cuota que ya abonó).
  it("saltea las cuotas futuras cubiertas por un pago adelantado", () => {
    // 13 cuotas pagadas de una vez (260.000) sobre un crédito cuyo día en curso es el 12.
    const adelantado = [{ dia_credito: 1, monto: 20000 * 13 }];
    const r = calcularEstadosCarton(prestamoBase, adelantado, HOY);
    // El día 13 (futuro) quedó cubierto por el adelanto → próxima es el 14, no el 13.
    expect(r.proxima?.dia).toBe(14);
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

describe("calcularEstadosCarton — modalidades (frecuencia)", () => {
  it("fechaDeCuota respeta el paso de cada frecuencia", () => {
    const inicio = parseFecha("2026-06-03");
    expect(toIso(fechaDeCuota(inicio, 2, "diario"))).toBe("2026-06-05");
    expect(toIso(fechaDeCuota(inicio, 2, "semanal"))).toBe("2026-06-17");
    expect(toIso(fechaDeCuota(inicio, 2, "quincenal"))).toBe("2026-07-03");
    expect(toIso(fechaDeCuota(inicio, 1, "mensual"))).toBe("2026-07-03");
  });

  it("mensual con inicio 31: cae al último día real de cada mes", () => {
    const inicio = parseFecha("2026-01-31");
    expect(toIso(fechaDeCuota(inicio, 1, "mensual"))).toBe("2026-02-28"); // feb no tiene 31
    expect(toIso(fechaDeCuota(inicio, 2, "mensual"))).toBe("2026-03-31");
  });

  it("crédito SEMANAL: las cuotas caen cada 7 días y el estado es correcto", () => {
    const prestamo = {
      cuota_diaria: 5000,
      total_dias: 4,
      fecha_inicio: "2026-06-03",
      frecuencia: "semanal" as const,
    };
    // Hoy = fecha de la 3ª cuota (jun-17). Pagó las cuotas 1 y 2.
    const pagos = [
      { dia_credito: 1, monto: 5000 },
      { dia_credito: 2, monto: 5000 },
    ];
    const r = calcularEstadosCarton(prestamo, pagos, parseFecha("2026-06-17"));

    expect(r.dias[0].fecha).toBe("2026-06-03");
    expect(r.dias[1].fecha).toBe("2026-06-10");
    expect(r.dias[2].fecha).toBe("2026-06-17");
    expect(r.dias[3].fecha).toBe("2026-06-24");
    expect(r.dias[0].estado).toBe("pagado");
    expect(r.dias[2].esHoy).toBe(true);
    expect(r.diaActual).toBe(3);
    expect(r.fechaFin).toBe("2026-06-24");
    expect(r.proxima?.diasRestantes).toBe(7);
  });

  it("DIARIO saltea domingos: ninguna cuota vence en domingo", () => {
    // Inicio miércoles 03-jun. 12 cuotas diarias → 2 semanas Lun–Sáb.
    const inicio = parseFecha("2026-06-03");
    const fechas = Array.from({ length: 12 }, (_, i) => toIso(fechaDeCuota(inicio, i, "diario")));
    // Ninguna cae en domingo (getDay 0).
    for (const f of fechas) expect(parseFecha(f).getDay()).not.toBe(0);
    // Se saltean los domingos 07 y 14 de junio.
    expect(fechas).not.toContain("2026-06-07");
    expect(fechas).not.toContain("2026-06-14");
    // La 4ª cuota (sáb 06) → la 5ª es lunes 08, no domingo 07.
    expect(fechas[4]).toBe("2026-06-08");
  });

  it("si el crédito arranca un domingo, la 1ª cuota se cobra el lunes", () => {
    const inicio = parseFecha("2026-06-07"); // domingo
    expect(toIso(fechaDeCuota(inicio, 0, "diario"))).toBe("2026-06-08"); // lunes
  });

  it("una cuota semanal que caería en domingo se corre al lunes", () => {
    const inicio = parseFecha("2026-06-07"); // domingo
    // +7 = domingo 14 → se corre al lunes 15.
    expect(toIso(fechaDeCuota(inicio, 1, "semanal"))).toBe("2026-06-15");
  });

  it("diario y semanal difieren: el mismo día i cae en fechas distintas", () => {
    const base = { cuota_diaria: 1000, total_dias: 5, fecha_inicio: "2026-06-03" };
    const diario = calcularEstadosCarton({ ...base, frecuencia: "diario" }, [], parseFecha("2026-06-03"));
    const semanal = calcularEstadosCarton({ ...base, frecuencia: "semanal" }, [], parseFecha("2026-06-03"));
    expect(diario.dias[4].fecha).toBe("2026-06-08"); // +4 días hábiles (saltea dom 07)
    expect(semanal.dias[4].fecha).toBe("2026-07-01"); // +4 semanas
  });
});

describe("plazoVencido — cartera vencida vs crédito en término", () => {
  it("crédito con la última cuota en el pasado → plazo VENCIDO", () => {
    // 10 cuotas desde 2026-01-01, mirado el 16-jun: terminó hace meses.
    expect(
      plazoVencido({ cuota_diaria: 1000, total_dias: 10, fecha_inicio: "2026-01-01" }, HOY),
    ).toBe(true);
  });

  it("crédito todavía dentro de su plazo → NO vencido", () => {
    // 30 cuotas desde 2026-06-10, mirado el 16-jun: sigue corriendo.
    expect(
      plazoVencido({ cuota_diaria: 1000, total_dias: 30, fecha_inicio: "2026-06-10" }, HOY),
    ).toBe(false);
  });

  it("el DÍA de la última cuota aún es 'en término' (no vencido); un día después, sí", () => {
    // prestamoBase termina el 2026-07-07 (verificado arriba).
    const fin = parseFecha("2026-07-07");
    expect(plazoVencido(prestamoBase, fin)).toBe(false);
    const finMas1 = parseFecha("2026-07-08");
    expect(plazoVencido(prestamoBase, finMas1)).toBe(true);
  });

  it("ignora la hora de 'hoy' (compara por día)", () => {
    const finConHora = new Date(2026, 6, 7, 23, 30); // 07-jul 23:30 = último día
    expect(plazoVencido(prestamoBase, finConHora)).toBe(false);
  });
});
