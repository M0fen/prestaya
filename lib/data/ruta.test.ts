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
  it("DIARIO: siempre la cuota fija (el 80% de la cartera NO cambia)", () => {
    const d = { cuota: 500, totalDias: 24, fechaInicio: INICIO, frecuencia: "diario" as const, pagadoAcum: 0 };
    expect(cuotaObjetivoHoy(d, parseFecha("2026-06-15"))).toBe(500);
    // aun pagado de más (dato raro) el target diario sigue siendo la cuota
    expect(cuotaObjetivoHoy({ ...d, pagadoAcum: 999999 }, parseFecha("2026-06-15"))).toBe(500);
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
