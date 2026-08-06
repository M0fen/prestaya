import { describe, it, expect } from "vitest";
import { clasificarClienteRuta, estadoHoyDe, cuotaObjetivoHoy } from "./ruta";
import { fechaDeCuota, cuotasDebidasHasta } from "@/lib/cartones";
import { parseFecha } from "@/lib/format";

describe("estadoHoyDe — regla del cartón en la lista del cobrador", () => {
  it("pagó >= cuota → pagado (día cubierto)", () => {
    expect(estadoHoyDe(100, 100, false)).toBe("pagado");
    expect(estadoHoyDe(150, 100, false)).toBe("pagado"); // pagó de más igual cubre
  });

  it("abono PARCIAL (0 < pagado < cuota) → abono, NO pagado", () => {
    expect(estadoHoyDe(60, 100, false)).toBe("abono");
    expect(estadoHoyDe(99, 100, false)).toBe("abono");
    // aunque haya visita marcada no-pago, si pagó algo, prima el abono
    expect(estadoHoyDe(40, 100, true)).toBe("abono");
  });

  it("cuota FRACCIONARIA cobrada completa → pagado (tolerancia sub-peso, espejo del cartón)", () => {
    // Cuota importada de Disapp 351,04; el pago se asienta entero (351). Sin la
    // tolerancia −0,5 se veía "abono" y la ruta nunca mostraba "Ruta completa".
    expect(estadoHoyDe(351, 351.04, false)).toBe("pagado");
    // un abono real por debajo del margen sigue siendo abono (no lo enmascara)
    expect(estadoHoyDe(350, 351.04, false)).toBe("abono");
  });

  it("no pagó nada + visita no-pago → no_pago", () => {
    expect(estadoHoyDe(0, 100, true)).toBe("no_pago");
  });

  it("no pagó nada, sin visita → pendiente", () => {
    expect(estadoHoyDe(0, 100, false)).toBe("pendiente");
  });

  it("cuota 0 (crédito sin cuota) nunca marca pagado por >=", () => {
    expect(estadoHoyDe(0, 0, false)).toBe("pendiente");
    expect(estadoHoyDe(50, 0, false)).toBe("abono"); // pagó algo sobre cuota 0
  });
});

describe("clasificarClienteRuta — zombies (plazo vencido) fuera del target del día", () => {
  it("crédito EN TÉRMINO → cuenta en la ruta y aporta su cuota al esperado", () => {
    const r = clasificarClienteRuta([{ cuota: 100, pagadoHoy: 0, plazoVencido: false }], false);
    expect(r.cuotaEnTermino).toBe(100);
    expect(r.soloVencido).toBe(false);
    expect(r.cuentaEnRuta).toBe(true);
    expect(r.estadoHoy).toBe("pendiente");
  });

  it("crédito VENCIDO sin actividad → NO cuenta en la ruta ni en el esperado", () => {
    const r = clasificarClienteRuta([{ cuota: 100, pagadoHoy: 0, plazoVencido: true }], false);
    expect(r.cuotaEnTermino).toBe(0); // no infla "Falta $X"
    expect(r.soloVencido).toBe(true); // cartera vencida pura
    expect(r.cuentaEnRuta).toBe(false); // no bloquea "Ruta completa 🎉"
  });

  it("crédito VENCIDO con recuperación → fuera del target; el recaudo total SÍ la suma", () => {
    const r = clasificarClienteRuta([{ cuota: 100, pagadoHoy: 80, plazoVencido: true }], false);
    expect(r.soloVencido).toBe(true);
    expect(r.cuentaEnRuta).toBe(false);
    expect(r.pagadoHoyTotal).toBe(80); // la plata cobrada es plata
    expect(r.pagadoHoyEnTermino).toBe(0); // pero NO hacia una cuota de hoy
  });

  it("cliente MIXTO (uno en término + uno vencido) → cuenta en ruta con SOLO la cuota vigente", () => {
    const r = clasificarClienteRuta(
      [
        { cuota: 100, pagadoHoy: 0, plazoVencido: false },
        { cuota: 300, pagadoHoy: 0, plazoVencido: true },
      ],
      false,
    );
    expect(r.cuotaEnTermino).toBe(100); // el vencido no suma su cuota al esperado
    expect(r.soloVencido).toBe(false);
    expect(r.cuentaEnRuta).toBe(true);
  });

  it("REGRESIÓN: recuperar un vencido NO debe marcar 'pagado' la cuota de hoy impaga (cliente mixto)", () => {
    // Crédito A en término (cuota 100, sin pago hoy) + B vencido (cuota 100, recuperó 100).
    // El estado del cliente debe seguir mostrando que HOY (crédito A) está impago.
    const r = clasificarClienteRuta(
      [
        { cuota: 100, pagadoHoy: 0, plazoVencido: false }, // A: cuota de hoy impaga
        { cuota: 100, pagadoHoy: 100, plazoVencido: true }, // B: recuperación de deuda vieja
      ],
      false,
    );
    expect(r.estadoHoy).toBe("pendiente"); // NO "pagado": el cobrador NO debe saltearlo
    expect(r.pagadoHoyEnTermino).toBe(0); // la recuperación no cuenta hacia la cuota de hoy
    expect(r.pagadoHoyTotal).toBe(100); // pero el recaudo del día sí la incluye
    expect(r.cuentaEnRuta).toBe(true);
  });

  it("sin créditos activos → no es cartera vencida (soloVencido false)", () => {
    const r = clasificarClienteRuta([], false);
    expect(r.soloVencido).toBe(false);
    expect(r.cuentaEnRuta).toBe(true);
    expect(r.cuotaEnTermino).toBe(0);
  });
});

// ── Frecuencia en la ruta (hallazgo #5): un crédito NO-diario no debe figurar
//    "Pendiente" ni sumar al esperado TODOS los días. ────────────────────────
const INICIO = "2026-06-01";
const semanal = (pagadoAcum: number) => ({
  cuota: 1000, totalDias: 10, fechaInicio: INICIO, frecuencia: "semanal" as const, pagadoAcum,
});

describe("cuotaObjetivoHoy — la ruta respeta la frecuencia (#5)", () => {
  it("DIARIO atrasado: el target del día es UNA cuota (no toda la deuda)", () => {
    const d = { cuota: 500, totalDias: 24, fechaInicio: INICIO, frecuencia: "diario" as const, pagadoAcum: 0 };
    // Al 15-06 tiene 13 cuotas vencidas y no pagó ninguna: igual se le pide UNA.
    expect(cuotaObjetivoHoy(d, parseFecha("2026-06-15"))).toBe(500);
  });

  it("DIARIO que pagó de MÁS: no se le pide otra cuota", () => {
    // Antes la rama diaria ignoraba `pagadoAcum` y devolvía la cuota igual. Con un
    // crédito de 24×500 = 12.000 ya cubierto, seguir pidiendo 500 es cobrarle de
    // más a alguien que no debe nada: el cartón lo da por pagado y la ruta no.
    const d = { cuota: 500, totalDias: 24, fechaInicio: INICIO, frecuencia: "diario" as const, pagadoAcum: 999999 };
    expect(cuotaObjetivoHoy(d, parseFecha("2026-06-15"))).toBe(0);
  });

  it("DIARIO al día: si ya cubrió la cuota de hoy, hoy no se le pide nada", () => {
    // 01-06 (lunes) arranca; al 15-06 vencieron 13 cuotas (los domingos no cuentan).
    // Pagó exactamente esas 13 → está al día, incluida la de hoy.
    const d = { cuota: 500, totalDias: 24, fechaInicio: INICIO, frecuencia: "diario" as const, pagadoAcum: 13 * 500 };
    expect(cuotaObjetivoHoy(d, parseFecha("2026-06-15"))).toBe(0);
    // Con una cuota menos pagada, sí le toca la de hoy.
    expect(cuotaObjetivoHoy({ ...d, pagadoAcum: 12 * 500 }, parseFecha("2026-06-15"))).toBe(500);
  });

  it("DIARIO el DOMINGO: al día → 0 (ninguna cuota vence en domingo)", () => {
    // 14-06-2026 es domingo. El cobro es Lun–Sáb: si viene al día, hoy no toca.
    const alDia = { cuota: 500, totalDias: 24, fechaInicio: INICIO, frecuencia: "diario" as const, pagadoAcum: 12 * 500 };
    expect(parseFecha("2026-06-14").getDay()).toBe(0); // es domingo, de verdad
    expect(cuotaObjetivoHoy(alDia, parseFecha("2026-06-14"))).toBe(0);
  });

  it("DIARIO en el TRAMO FINAL: pide el saldo que queda, no la cuota entera", () => {
    // Le quedan $200 de un crédito de cuota $750. Pedirle $750 hacía que el
    // servidor clampeara el asiento a $200 y el cobrador se quedara con $550
    // físicos sin registrar (sobrante en la rendición, plata a devolver).
    const d = { cuota: 750, totalDias: 24, fechaInicio: "2026-05-04", frecuencia: "diario" as const, pagadoAcum: 17800 };
    expect(cuotaObjetivoHoy(d, parseFecha("2026-06-15"))).toBe(200);
  });

  it("DIARIO que todavía no arrancó (fecha de inicio futura) → 0", () => {
    const d = { cuota: 500, totalDias: 24, fechaInicio: "2026-07-01", frecuencia: "diario" as const, pagadoAcum: 0 };
    expect(cuotaObjetivoHoy(d, parseFecha("2026-06-15"))).toBe(0);
  });

  it("SEMANAL al día, en un día SIN cuota → 0 (no figura pendiente a diario)", () => {
    const c0 = fechaDeCuota(parseFecha(INICIO), 0, "semanal"); // 1ª cuota
    const medioSemana = new Date(c0);
    medioSemana.setDate(c0.getDate() + 3); // después de la 1ª, antes de la 2ª (+7)
    expect(cuotaObjetivoHoy(semanal(1000), medioSemana)).toBe(0); // pagó la 1ª → al día
  });

  it("SEMANAL el día que vence la 2ª cuota (pagó la 1ª) → una cuota", () => {
    const c1 = fechaDeCuota(parseFecha(INICIO), 1, "semanal"); // 2ª cuota
    expect(cuotaObjetivoHoy(semanal(1000), c1)).toBe(1000);
  });

  it("SEMANAL atrasado (no pagó nada) → target de UNA cuota (como el diario)", () => {
    const c1 = fechaDeCuota(parseFecha(INICIO), 1, "semanal");
    expect(cuotaObjetivoHoy(semanal(0), c1)).toBe(1000); // debe 2, pero el target del día es 1
  });

  it("SEMANAL con cuota FRACCIONARIA al día (pagos enteros) → 0 (tolerancia sub-peso)", () => {
    // cuota 351,04; pagó 351 por cada una de las 2 cuotas vencidas (702, entero).
    const frac = { cuota: 351.04, totalDias: 10, fechaInicio: INICIO, frecuencia: "semanal" as const, pagadoAcum: 702 };
    const c1 = fechaDeCuota(parseFecha(INICIO), 1, "semanal");
    // residuo = 2*351,04 - 702 = 0,08 (<0,5) → 0, no centavos fantasma
    expect(cuotaObjetivoHoy(frac, c1)).toBe(0);
  });

  it("el objetivo se computa con lo pagado ANTES de hoy (evita descontar 2× el pago de hoy)", () => {
    // El llamador pasa pagadoAcum = acum − pagadoHoy. Si hoy vence la 2ª (pagó la 1ª)
    // y aún no cobró nada hoy, el objetivo debe ser la cuota ENTERA (1000), no encoger.
    const c1 = fechaDeCuota(parseFecha(INICIO), 1, "semanal");
    expect(cuotaObjetivoHoy(semanal(1000), c1)).toBe(1000);
  });

  it("cuotasDebidasHasta: cuenta las cuotas cuya fecha ya llegó (frecuencia-aware)", () => {
    const p = { cuota_diaria: 1000, total_dias: 10, fecha_inicio: INICIO, frecuencia: "semanal" as const };
    const c0 = fechaDeCuota(parseFecha(INICIO), 0, "semanal");
    const c2 = fechaDeCuota(parseFecha(INICIO), 2, "semanal");
    expect(cuotasDebidasHasta(p, c0)).toBe(1);
    expect(cuotasDebidasHasta(p, c2)).toBe(3);
  });
});

describe("clasificarClienteRuta — 'al día' (no-diario) NO es cartera vencida", () => {
  it("crédito EN TÉRMINO al día (cuota-hoy 0, alDia=true) → pagado, cuenta en ruta, NO soloVencido", () => {
    const clase = clasificarClienteRuta([{ cuota: 0, pagadoHoy: 0, plazoVencido: false, alDia: true }], false);
    expect(clase.soloVencido).toBe(false);
    expect(clase.cuentaEnRuta).toBe(true);
    expect(clase.estadoHoy).toBe("pagado");
    expect(clase.cuotaEnTermino).toBe(0);
  });

  it("crédito ROTO (cuota 0 SIN alDia) NO se enmascara: sigue pendiente (visible)", () => {
    const clase = clasificarClienteRuta([{ cuota: 0, pagadoHoy: 0, plazoVencido: false }], false);
    expect(clase.estadoHoy).toBe("pendiente"); // no "pagado": el dato roto queda a la vista
    expect(clase.soloVencido).toBe(false);
  });

  it("crédito diario en término impago sigue 'pendiente' (sin regresión)", () => {
    const clase = clasificarClienteRuta([{ cuota: 500, pagadoHoy: 0, plazoVencido: false }], false);
    expect(clase.estadoHoy).toBe("pendiente");
    expect(clase.cuotaEnTermino).toBe(500);
  });

  it("cliente MIXTO: un no-diario al día + un diario pendiente → pendiente (no lo saltea)", () => {
    const clase = clasificarClienteRuta(
      [
        { cuota: 0, pagadoHoy: 0, plazoVencido: false, alDia: true }, // no-diario al día
        { cuota: 500, pagadoHoy: 0, plazoVencido: false }, // diario impago
      ],
      false,
    );
    expect(clase.estadoHoy).toBe("pendiente"); // el diario impago manda
    expect(clase.cuotaEnTermino).toBe(500);
  });
});

describe("cliente COMPARTIDO entre dos cobradores — cada uno cobra lo SUYO", () => {
  // Caso real de campo (08-05): SONIA TELIS tiene 8 créditos activos, 6 de Juan
  // José Castro ($5.350 de cuota) y 2 de Alejandro Cardona ($1.200), y está en
  // las dos rutas. Antes la consulta traía TODOS los créditos del cliente, así
  // que los dos veían $6.550 y los dos salían a cobrar el total: doble cobro al
  // cliente y arqueo inflado en los dos. La cuota de cada uno es la de SUS
  // créditos; `clasificarClienteRuta` ya opera sobre la lista que se le pasa,
  // así que la regla se cumple filtrando el crédito por dueño ANTES de llamarla.
  it("cada cobrador ve solo la cuota de sus propios créditos, no la del compañero", () => {
    const deJuanJose = [1200, 1200, 550, 600, 1200, 600].map((cuota) => ({
      cuota,
      pagadoHoy: 0,
      plazoVencido: false,
    }));
    const deAlejandro = [600, 600].map((cuota) => ({ cuota, pagadoHoy: 0, plazoVencido: false }));

    expect(clasificarClienteRuta(deJuanJose, false).cuotaEnTermino).toBe(5350);
    expect(clasificarClienteRuta(deAlejandro, false).cuotaEnTermino).toBe(1200);
    // Y NUNCA el total del cliente: si alguno viera 6550, está cobrando lo ajeno.
    expect(clasificarClienteRuta([...deJuanJose, ...deAlejandro], false).cuotaEnTermino).toBe(6550);
  });

  it("el cobro del compañero no marca 'pagado' al cliente en MI ruta", () => {
    // Alejandro no le cobró nada; que Juan José haya cobrado sus $5.350 no puede
    // dejar la parada de Alejandro en "Cobrado" (se saltearía su propia cuota).
    const soloLosMios = [
      { cuota: 600, pagadoHoy: 0, plazoVencido: false },
      { cuota: 600, pagadoHoy: 0, plazoVencido: false },
    ];
    expect(clasificarClienteRuta(soloLosMios, false).estadoHoy).toBe("pendiente");
  });
});
