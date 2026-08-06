// ─────────────────────────────────────────────────────────────────────────
//  FECHAS — el corte del día uruguayo (03:00 UTC), el cronograma Lun–Sáb y la
//  paridad con el calendario heredado de Disapp.
//
//  Reglas que se fijan acá (romperlas es un bug de PLATA, no de UI):
//   · El día contable de Uruguay corre de 00:00 a 24:00 UY = 03:00Z a 03:00Z.
//     Un cobro de las 23:30 y otro de las 02:00 son DÍAS DISTINTOS.
//   · Ninguna cuota vence en domingo (Lun–Sáb): si cae domingo, se corre al lunes.
//   · El cronograma diario O(1) tiene que dar EXACTAMENTE lo mismo que contar
//     días hábiles de a uno (es el calendario con el que Disapp cobró 3 años).
//   · Nada de esto puede depender de la zona horaria del runtime: Vercel corre
//     en UTC y la oficina en UY/CO. Por eso casi todo se corre en varias TZ.
//
//  Los `it.fails` marcados "⚠️ FALLA: bug real" documentan defectos CONFIRMADOS
//  de los consumidores (ver informe del auditor). No se tocó ninguna fuente.
// ─────────────────────────────────────────────────────────────────────────
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cicloUY,
  diaUYFinIso,
  diaUYInicioIso,
  diasCobrablesDelMes,
  diasCobrablesProximos,
  fechaISOUY,
  hoyUY,
  inicioDiaUYIso,
  inicioMesUYIso,
  sellarRegistroEn,
  sumarDiasYmd,
} from "./fecha";
import { cuotasDebidasHasta, fechaDeCuota, plazoVencido } from "./cartones";
import { parseFecha, toIso } from "./format";
import { ventanasDe } from "@/lib/data/presupuestoJuegos";
import { cuotaObjetivoHoy } from "@/lib/data/ruta";
import type { FrecuenciaPrestamo } from "@/types/db";

// ── Mocks para el .ics del cliente (única pieza que toca la base) ──────────
const clientePorToken = vi.fn();
const prestamoActivo = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdmin: () => ({}) }));
vi.mock("@/lib/data/clientes", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getClientePorToken: (...a: unknown[]) => clientePorToken(...a),
}));
vi.mock("@/lib/data/prestamos", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPrestamoActivoPorCliente: (...a: unknown[]) => prestamoActivo(...a),
}));
import { GET as descargarRecordatorio } from "@/app/c/[token]/recordatorio/route";

/** Corre `fn` como si el servidor estuviera en la zona horaria `tz`. Vercel corre
 *  en UTC, la oficina en UY/CO: lo que vale para la plata tiene que dar IGUAL. */
function conTZ<T>(tz: string, fn: () => T): T {
  const previa = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (previa === undefined) delete process.env.TZ;
    else process.env.TZ = previa;
  }
}

/** Zonas donde la app realmente corre (o correría): Vercel=UTC, oficina=UY/CO,
 *  y dos extremas para que el test no dependa del reloj de nadie. */
const TZS = ["UTC", "America/Montevideo", "America/Bogota", "Asia/Tokyo", "Pacific/Kiritimati"];

const FRECUENCIAS: FrecuenciaPrestamo[] = ["diario", "semanal", "quincenal", "mensual"];

// ═════════════════════════════════════════════════════════════════════════
//  1. EL DÍA URUGUAYO CORTA A LAS 03:00 UTC
// ═════════════════════════════════════════════════════════════════════════
describe("el día contable de Uruguay corre de 03:00Z a 03:00Z", () => {
  // 23:30 del martes 5-ago en UY = 02:30Z del 6-ago. 02:00 del miércoles 6-ago
  // en UY = 05:00Z del 6-ago. Mismo día UTC, DÍAS DE CAJA DISTINTOS.
  const cobroTarde = new Date("2026-08-06T02:30:00Z"); // mar 5-ago 23:30 UY
  const cobroMadrugada = new Date("2026-08-06T05:00:00Z"); // mié 6-ago 02:00 UY

  it("un cobro de las 23:30 y otro de las 02:00 caen en días de caja distintos", () => {
    for (const tz of TZS) {
      conTZ(tz, () => {
        expect(fechaISOUY(cobroTarde)).toBe("2026-08-05");
        expect(fechaISOUY(cobroMadrugada)).toBe("2026-08-06");
        expect(inicioDiaUYIso(cobroTarde)).toBe("2026-08-05T03:00:00.000Z");
        expect(inicioDiaUYIso(cobroMadrugada)).toBe("2026-08-06T03:00:00.000Z");
      });
    }
  });

  it("el corte es exacto: 02:59:59Z es de ayer y 03:00:00Z ya es de hoy", () => {
    for (const tz of TZS) {
      conTZ(tz, () => {
        expect(fechaISOUY(new Date("2026-08-06T02:59:59Z"))).toBe("2026-08-05");
        expect(fechaISOUY(new Date("2026-08-06T03:00:00Z"))).toBe("2026-08-06");
        const ayer = hoyUY(new Date("2026-08-06T02:59:59Z"));
        const hoy = hoyUY(new Date("2026-08-06T03:00:00Z"));
        expect(toIso(ayer)).toBe("2026-08-05");
        expect(toIso(hoy)).toBe("2026-08-06");
      });
    }
  });

  it("la ventana de un día UY dura exactamente 24 h y no pisa la del día siguiente", () => {
    for (const tz of TZS) {
      conTZ(tz, () => {
        const desde = Date.parse(diaUYInicioIso("2026-08-06"));
        const hasta = Date.parse(diaUYFinIso("2026-08-06"));
        expect(hasta - desde).toBe(86_400_000);
        expect(desde).toBe(Date.parse("2026-08-06T03:00:00Z"));
        expect(hasta).toBe(Date.parse("2026-08-07T03:00:00Z"));
        // Un cobro de las 23:30 UY todavía es de ESE día (adentro del rango).
        expect(Date.parse("2026-08-07T02:30:00Z")).toBeLessThan(hasta);
        // Y el de las 00:30 UY del día siguiente ya quedó afuera.
        expect(Date.parse("2026-08-07T03:30:00Z")).toBeGreaterThanOrEqual(hasta);
      });
    }
  });

  it("el fin de la ventana cruza bien el fin de mes, el fin de año y el 29 de febrero", () => {
    expect(diaUYFinIso("2026-08-31")).toBe("2026-09-01T00:00:00-03:00");
    expect(diaUYFinIso("2026-12-31")).toBe("2027-01-01T00:00:00-03:00");
    expect(diaUYFinIso("2028-02-28")).toBe("2028-02-29T00:00:00-03:00"); // bisiesto
    expect(diaUYFinIso("2028-02-29")).toBe("2028-03-01T00:00:00-03:00");
    expect(diaUYFinIso("2027-02-28")).toBe("2027-03-01T00:00:00-03:00"); // no bisiesto
  });

  it("el ciclo MENSUAL también corta a las 03:00Z: el cobro del 31 a las 23:30 es de JULIO", () => {
    const ultimoDeJulio = new Date("2026-08-01T02:30:00Z"); // 31-jul 23:30 UY
    const primeroDeAgosto = new Date("2026-08-01T03:30:00Z"); // 1-ago 00:30 UY
    for (const tz of TZS) {
      conTZ(tz, () => {
        expect(cicloUY(ultimoDeJulio)).toBe("2026-07");
        expect(cicloUY(primeroDeAgosto)).toBe("2026-08");
        expect(inicioMesUYIso(ultimoDeJulio)).toBe("2026-07-01T03:00:00.000Z");
        expect(inicioMesUYIso(primeroDeAgosto)).toBe("2026-08-01T03:00:00.000Z");
      });
    }
  });

  it("sellarRegistroEn usa el día URUGUAYO, no el día UTC: 10:00 y 23:00 del mismo día se conservan", () => {
    // Servidor: 6-ago 23:00 UY (7-ago 02:00Z). Celular: 6-ago 10:00 UY (13:00Z).
    // Distinto día UTC, MISMO día UY → el comprobante conserva la hora real.
    const ahora = new Date("2026-08-07T02:00:00Z");
    expect(sellarRegistroEn("2026-08-06T13:00:00.000Z", ahora)).toBe("2026-08-06T13:00:00.000Z");
    // Un minuto después ya es otro día UY (7-ago 00:00) → el sello lo trae al día
    // del servidor, para que el arqueo del cobrador no le marque faltante fantasma.
    const yaEsManana = new Date("2026-08-07T03:00:00Z");
    expect(sellarRegistroEn("2026-08-06T13:00:00.000Z", yaEsManana)).toBe("2026-08-07T03:00:00.000Z");
  });

  it("sumarDiasYmd no se corre por zona horaria (mismo resultado en toda TZ)", () => {
    for (const tz of TZS) {
      conTZ(tz, () => {
        expect(sumarDiasYmd("2026-08-06", 1)).toBe("2026-08-07");
        expect(sumarDiasYmd("2026-03-01", -1)).toBe("2026-02-28");
        expect(sumarDiasYmd("2028-03-01", -1)).toBe("2028-02-29"); // bisiesto
        expect(sumarDiasYmd("2026-01-01", -1)).toBe("2025-12-31");
      });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  2. parseFecha / toIso: un "YYYY-MM-DD" NUNCA se corre un día
// ═════════════════════════════════════════════════════════════════════════
describe("parseFecha — la fecha_inicio importada de Disapp no se corre un día", () => {
  it("ida y vuelta exacta en 400 fechas seguidas, en cualquier zona horaria", () => {
    for (const tz of TZS) {
      conTZ(tz, () => {
        let ymd = "2025-12-01";
        for (let k = 0; k < 400; k++) {
          expect(toIso(parseFecha(ymd))).toBe(ymd);
          ymd = sumarDiasYmd(ymd, 1);
        }
      });
    }
  });

  it("da el día calendario pedido, no el que saldría de interpretarlo como UTC", () => {
    // La trampa: new Date("2026-08-06") se parsea como UTC y en UY/CO cae el 5.
    for (const tz of TZS) {
      conTZ(tz, () => {
        const d = parseFecha("2026-08-06");
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(7); // agosto
        expect(d.getDate()).toBe(6);
        expect(d.getHours()).toBe(0);
        // 1-ene y 31-dic son los que más se corren si se usa UTC.
        expect(toIso(parseFecha("2026-01-01"))).toBe("2026-01-01");
        expect(toIso(parseFecha("2026-12-31"))).toBe("2026-12-31");
        expect(toIso(parseFecha("2028-02-29"))).toBe("2028-02-29");
      });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  3. CRONOGRAMA: domingo nunca, y el O(1) igual a contar de a uno
// ═════════════════════════════════════════════════════════════════════════

/** Cronograma diario contando días hábiles DE A UNO (la forma "ingenua" y obvia).
 *  Es el patrón de oro contra el que se valida el atajo O(1) de producción. */
function fechaDiariaContandoDeAUno(inicio: Date, i: number): Date {
  const d = new Date(inicio);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // arranca domingo → lunes
  let faltan = i;
  while (faltan > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0) faltan--; // el domingo no cuenta como día de cobro
  }
  return d;
}

describe("cronograma diario — el atajo O(1) es el mismo calendario que contar de a uno", () => {
  it("coincide en las 400 cuotas, arranque el crédito el día de la semana que sea", () => {
    // 2026-08-03 (lunes) … 2026-08-09 (domingo): los 7 arranques posibles.
    for (let dia = 3; dia <= 9; dia++) {
      const inicio = parseFecha(`2026-08-0${dia}`);
      for (let i = 0; i < 400; i++) {
        expect(toIso(fechaDeCuota(inicio, i, "diario"))).toBe(
          toIso(fechaDiariaContandoDeAUno(inicio, i)),
        );
      }
    }
  });

  it("400 cuotas diarias = 400 días de cobro reales: ninguna en domingo y una por día hábil", () => {
    const inicio = parseFecha("2026-08-03"); // lunes
    const fechas = Array.from({ length: 400 }, (_, i) => fechaDeCuota(inicio, i, "diario"));
    const vistas = new Set(fechas.map(toIso));
    expect(vistas.size).toBe(400); // sin repetir: una cuota por día
    for (const f of fechas) expect(f.getDay()).not.toBe(0);
    // Entre la 1ª y la 400ª no puede quedar ningún día hábil sin cuota ni
    // aparecer un domingo: día por día del calendario, tiene que dar exacto.
    const dias = Math.round((fechas[399].getTime() - fechas[0].getTime()) / 86_400_000);
    const d = new Date(fechas[0]);
    for (let k = 0; k <= dias; k++) {
      expect(vistas.has(toIso(d))).toBe(d.getDay() !== 0);
      d.setDate(d.getDate() + 1);
    }
  });
});

describe("ninguna cuota vence en domingo — barrido de 400 arranques × 4 frecuencias", () => {
  it("ni una sola fecha del cronograma cae en domingo", () => {
    let ymd = "2026-01-01";
    for (let k = 0; k < 400; k++) {
      const inicio = parseFecha(ymd);
      for (const frec of FRECUENCIAS) {
        for (let i = 0; i < 24; i++) {
          expect(fechaDeCuota(inicio, i, frec).getDay()).not.toBe(0);
        }
      }
      ymd = sumarDiasYmd(ymd, 1);
    }
  });

  it("el cronograma siempre avanza: la cuota i+1 nunca cae antes ni el mismo día que la i", () => {
    let ymd = "2026-01-01";
    for (let k = 0; k < 400; k++) {
      const inicio = parseFecha(ymd);
      for (const frec of FRECUENCIAS) {
        for (let i = 0; i < 23; i++) {
          const a = fechaDeCuota(inicio, i, frec).getTime();
          const b = fechaDeCuota(inicio, i + 1, frec).getTime();
          expect(b).toBeGreaterThan(a);
        }
      }
      ymd = sumarDiasYmd(ymd, 1);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  4. PASOS DE CADA FRECUENCIA (paridad con el calendario de Disapp)
// ═════════════════════════════════════════════════════════════════════════
describe("frecuencias — el paso de cada modalidad, con sus bordes", () => {
  it("QUINCENAL avanza de a 15 días (no 14) y corre al lunes cuando cae domingo", () => {
    const inicio = parseFecha("2026-06-01"); // lunes
    const fechas = Array.from({ length: 8 }, (_, i) => toIso(fechaDeCuota(inicio, i, "quincenal")));
    expect(fechas).toEqual([
      "2026-06-01",
      "2026-06-16",
      "2026-07-01",
      "2026-07-16",
      "2026-07-31",
      "2026-08-15",
      "2026-08-31", // el 30-ago es domingo → lunes 31
      "2026-09-14", // el 13-sep es domingo → lunes 14
    ]);
    // Con paso de 14 (lo que manda el .ics) la 8ª cuota se adelantaría 7 días.
    const conPaso14 = new Date(inicio);
    conPaso14.setDate(inicio.getDate() + 7 * 14);
    expect(toIso(conPaso14)).not.toBe(fechas[7]);
    expect(
      Math.round((parseFecha(fechas[7]).getTime() - conPaso14.getTime()) / 86_400_000),
    ).toBe(7);
  });

  it("SEMANAL cae siempre el mismo día de la semana", () => {
    const inicio = parseFecha("2026-06-01"); // lunes
    const fechas = Array.from({ length: 6 }, (_, i) => toIso(fechaDeCuota(inicio, i, "semanal")));
    expect(fechas).toEqual([
      "2026-06-01",
      "2026-06-08",
      "2026-06-15",
      "2026-06-22",
      "2026-06-29",
      "2026-07-06",
    ]);
  });

  it("MENSUAL con inicio 31: cae al último día real del mes y no se 'derrama' al siguiente", () => {
    const inicio = parseFecha("2026-01-31");
    const fechas = Array.from({ length: 5 }, (_, i) => toIso(fechaDeCuota(inicio, i, "mensual")));
    expect(fechas).toEqual([
      "2026-01-31",
      "2026-02-28", // febrero no tiene 31 (y 2026 no es bisiesto)
      "2026-03-31",
      "2026-04-30", // abril no tiene 31
      "2026-06-01", // el 31-may-2026 es DOMINGO → se corre al lunes 1-jun
    ]);
  });

  it("MENSUAL en año BISIESTO: 31-ene + 1 mes = 29-feb", () => {
    const inicio = parseFecha("2028-01-31"); // 2028 es bisiesto
    expect(toIso(fechaDeCuota(inicio, 1, "mensual"))).toBe("2028-02-29");
    expect(toIso(fechaDeCuota(inicio, 2, "mensual"))).toBe("2028-03-31");
    // Un crédito que arranca el 29-feb: al año siguiente ese día no existe y la
    // cuota cae al último día real de febrero, NO se derrama al 1-mar.
    const bisiesto = parseFecha("2028-02-29");
    expect(toIso(fechaDeCuota(bisiesto, 12, "mensual"))).toBe("2029-02-28");
  });

  it("MENSUAL con inicio 30: los meses de 31 NO lo empujan al 31", () => {
    const inicio = parseFecha("2026-08-30"); // domingo → 1ª cuota el lunes 31
    const fechas = Array.from({ length: 4 }, (_, i) => toIso(fechaDeCuota(inicio, i, "mensual")));
    expect(fechas).toEqual(["2026-08-31", "2026-09-30", "2026-10-30", "2026-11-30"]);
  });

  it("un crédito que arranca DOMINGO empieza a cobrarse el lunes, en las 4 frecuencias", () => {
    const domingo = parseFecha("2026-08-09");
    for (const frec of FRECUENCIAS) {
      expect(toIso(fechaDeCuota(domingo, 0, frec))).toBe("2026-08-10");
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  5. PLAZO VENCIDO — el borde exacto, frecuencia por frecuencia
// ═════════════════════════════════════════════════════════════════════════
describe("plazoVencido — el último día todavía es 'en término'", () => {
  const casos: { frec: FrecuenciaPrestamo; dias: number; inicio: string; fin: string; siguiente: string }[] = [
    { frec: "diario", dias: 24, inicio: "2026-08-03", fin: "2026-08-29", siguiente: "2026-08-30" },
    { frec: "semanal", dias: 6, inicio: "2026-06-01", fin: "2026-07-06", siguiente: "2026-07-07" },
    { frec: "quincenal", dias: 8, inicio: "2026-06-01", fin: "2026-09-14", siguiente: "2026-09-15" },
    { frec: "mensual", dias: 5, inicio: "2026-01-31", fin: "2026-06-01", siguiente: "2026-06-02" },
  ];

  it("el día de la última cuota NO está vencido; el día siguiente SÍ (las 4 frecuencias)", () => {
    for (const c of casos) {
      const prestamo = {
        cuota_diaria: 1000,
        total_dias: c.dias,
        fecha_inicio: c.inicio,
        frecuencia: c.frec,
      };
      expect(toIso(fechaDeCuota(parseFecha(c.inicio), c.dias - 1, c.frec))).toBe(c.fin);
      expect(plazoVencido(prestamo, parseFecha(c.fin))).toBe(false);
      expect(plazoVencido(prestamo, parseFecha(c.siguiente))).toBe(true);
    }
  });

  it("la hora del último día no adelanta el vencimiento (23:59 sigue en término)", () => {
    const prestamo = { cuota_diaria: 1000, total_dias: 24, fecha_inicio: "2026-08-03" };
    expect(plazoVencido(prestamo, new Date(2026, 7, 29, 23, 59, 59))).toBe(false);
    expect(plazoVencido(prestamo, new Date(2026, 7, 30, 0, 0, 1))).toBe(true);
  });

  it("un crédito sin cuotas (total_dias 0, dato roto de la migración) nunca es 'vencido'", () => {
    expect(plazoVencido({ cuota_diaria: 1000, total_dias: 0, fecha_inicio: "2020-01-01" }, parseFecha("2026-08-06"))).toBe(false);
  });

  it("el veredicto no cambia con la zona horaria del servidor", () => {
    const prestamo = { cuota_diaria: 1000, total_dias: 24, fecha_inicio: "2026-08-03" };
    for (const tz of TZS) {
      conTZ(tz, () => {
        expect(plazoVencido(prestamo, parseFecha("2026-08-29"))).toBe(false);
        expect(plazoVencido(prestamo, parseFecha("2026-08-30"))).toBe(true);
      });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  6. CUOTAS DEBIDAS — el domingo no agrega deuda
// ═════════════════════════════════════════════════════════════════════════
describe("cuotasDebidasHasta — el domingo no suma una cuota", () => {
  const diario = { cuota_diaria: 1000, total_dias: 24, fecha_inicio: "2026-08-03" }; // lunes

  it("el DOMINGO se debe lo mismo que el sábado; recién el lunes sube", () => {
    expect(cuotasDebidasHasta(diario, parseFecha("2026-08-08"))).toBe(6); // sábado
    expect(cuotasDebidasHasta(diario, parseFecha("2026-08-09"))).toBe(6); // domingo: igual
    expect(cuotasDebidasHasta(diario, parseFecha("2026-08-10"))).toBe(7); // lunes
  });

  it("antes de arrancar no se debe nada, y nunca se pasa del total del crédito", () => {
    expect(cuotasDebidasHasta(diario, parseFecha("2026-08-01"))).toBe(0);
    expect(cuotasDebidasHasta(diario, parseFecha("2027-01-01"))).toBe(24);
    expect(cuotasDebidasHasta({ ...diario, total_dias: 0 }, parseFecha("2027-01-01"))).toBe(0);
  });

  it("un crédito SEMANAL no debe una cuota nueva cada día", () => {
    const semanal = { cuota_diaria: 5000, total_dias: 6, fecha_inicio: "2026-06-01", frecuencia: "semanal" as const };
    expect(cuotasDebidasHasta(semanal, parseFecha("2026-06-01"))).toBe(1);
    expect(cuotasDebidasHasta(semanal, parseFecha("2026-06-05"))).toBe(1); // viernes: sigue 1
    expect(cuotasDebidasHasta(semanal, parseFecha("2026-06-07"))).toBe(1); // domingo
    expect(cuotasDebidasHasta(semanal, parseFecha("2026-06-08"))).toBe(2); // lunes
  });

  it("crédito HEREDADO de Disapp (24 cuotas de 351,04): el calendario es Lun–Sáb igual", () => {
    // La cuota es fraccionaria (8425/24) pero el CALENDARIO no tiene nada de raro.
    const disapp = { cuota_diaria: 351.04, total_dias: 24, fecha_inicio: "2026-08-03" };
    expect(toIso(fechaDeCuota(parseFecha(disapp.fecha_inicio), 23, "diario"))).toBe("2026-08-29");
    expect(cuotasDebidasHasta(disapp, parseFecha("2026-08-09"))).toBe(6);
    expect(plazoVencido(disapp, parseFecha("2026-08-29"))).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  7. DÍAS COBRABLES (proyecciones que no pueden contar domingos)
// ═════════════════════════════════════════════════════════════════════════
describe("días de cobro Lun–Sáb en las proyecciones", () => {
  it("los próximos 7 días de calendario son 6 días de cobro, arranque donde arranque", () => {
    for (let dia = 3; dia <= 9; dia++) {
      expect(diasCobrablesProximos(parseFecha(`2026-08-0${dia}`), 7)).toBe(6);
    }
    expect(diasCobrablesProximos(parseFecha("2026-08-06"), 0)).toBe(0);
    expect(diasCobrablesProximos(parseFecha("2026-08-08"), 1)).toBe(0); // mañana es domingo
  });

  it("agosto 2026 tiene 26 días de cobro (31 menos 5 domingos)", () => {
    const r = diasCobrablesDelMes(parseFecha("2026-08-06"));
    expect(r.total).toBe(26);
    expect(r.transcurridos).toBe(5); // del 1 al 6, sin el domingo 2
  });

  it("el mes se cierra completo el último día (transcurridos = total)", () => {
    const r = diasCobrablesDelMes(parseFecha("2026-08-31"));
    expect(r.transcurridos).toBe(r.total);
  });

  it("febrero bisiesto (2028) cuenta sus 29 días descontando domingos", () => {
    const r = diasCobrablesDelMes(parseFecha("2028-02-29"));
    let domingos = 0;
    for (let d = 1; d <= 29; d++) if (new Date(2028, 1, d).getDay() === 0) domingos++;
    expect(r.total).toBe(29 - domingos);
    expect(r.transcurridos).toBe(r.total);
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  8. ⚠️ HALLAZGO ALTO — la ventana del día del PRESUPUESTO DE JUEGOS
//     cierra a las 21:00 UY cuando el runtime es UTC (Vercel).
// ═════════════════════════════════════════════════════════════════════════
describe("presupuesto de juegos — la ventana del día tiene que cerrar a las 24:00 UY", () => {
  const HOY = new Date("2026-08-06T15:00:00Z"); // jueves 6-ago, 12:00 UY

  it("el ARRANQUE de la ventana está bien puesto (00:00 UY) en cualquier zona", () => {
    for (const tz of TZS) {
      conTZ(tz, () => {
        const v = ventanasDe(HOY);
        expect(Date.parse(v[0].desde)).toBe(Date.parse("2026-08-06T03:00:00Z"));
        expect(Date.parse(v[2].desde)).toBe(Date.parse("2026-08-01T03:00:00Z")); // 1-ago 00:00 UY
      });
    }
  });

  it("con el servidor en hora de URUGUAY la ventana del día es correcta (24 h justas)", () => {
    conTZ("America/Montevideo", () => {
      const v = ventanasDe(HOY);
      expect(Date.parse(v[0].hasta)).toBe(Date.parse("2026-08-07T03:00:00Z"));
      expect(Date.parse(v[0].hasta) - Date.parse(v[0].desde)).toBe(86_400_000);
      // Una raspadita ganada HOY a las 22:00 UY entra en el gasto de hoy.
      const premio = Date.parse("2026-08-07T01:00:00Z");
      expect(premio).toBeGreaterThanOrEqual(Date.parse(v[0].desde));
      expect(premio).toBeLessThan(Date.parse(v[0].hasta));
    });
  });

  // ⚠️ FALLA: bug real, ver informe. En el runtime de Vercel (UTC) `hoyUY()+1 día`
  // se convierte con toISOString() desde la medianoche LOCAL → la ventana cierra a
  // las 21:00 UY. Las 4 ventanas comparten ese `hasta`.
  it.fails("EL DÍA CIERRA A LAS 21:00 UY EN VERCEL: la ventana de hoy debería terminar a las 24:00 UY", () => {
    conTZ("UTC", () => {
      const v = ventanasDe(HOY);
      expect(Date.parse(v[0].hasta)).toBe(Date.parse("2026-08-07T03:00:00Z"));
    });
  });

  // ⚠️ FALLA: bug real, ver informe.
  it.fails("EL PREMIO ENTREGADO A LAS 22:00 UY DESAPARECE del gasto de hoy", () => {
    conTZ("UTC", () => {
      const v = ventanasDe(HOY);
      const premio = Date.parse("2026-08-07T01:00:00Z"); // hoy 22:00 UY
      expect(premio).toBeLessThan(Date.parse(v[0].hasta));
    });
  });

  // ⚠️ FALLA: bug real, ver informe. Este es el caso caro: el premio de $8.000
  // entregado el 31 a las 22:00 UY no cuenta en el mes y en septiembre la ventana
  // ya se movió → se pierde para siempre del tope/semáforo.
  it.fails("EL PREMIO DEL ÚLTIMO DÍA DEL MES A LAS 22:00 UY se pierde del gasto mensual", () => {
    conTZ("UTC", () => {
      const v = ventanasDe(new Date("2026-08-31T15:00:00Z"));
      const premio = Date.parse("2026-09-01T01:00:00Z"); // 31-ago 22:00 UY
      expect(premio).toBeLessThan(Date.parse(v[2].hasta)); // ventana "Este mes"
    });
  });

  // ⚠️ FALLA: bug real, ver informe. Efecto colateral del mismo `hoyUY()` en UTC:
  // `hace6` se recalcula con fechaISOUY sobre una medianoche local → 8 días.
  it.fails("LOS 'ÚLTIMOS 7 DÍAS' MIDEN 8 EN VERCEL", () => {
    conTZ("UTC", () => {
      const v = ventanasDe(HOY);
      expect(Date.parse(v[1].hasta) - Date.parse(v[1].desde)).toBe(7 * 86_400_000);
    });
  });

  // ⚠️ FALLA: bug real, ver informe. `enVentana` no está exportado, así que se
  // reproduce su comparación (texto contra texto, como llega de PostgREST): los
  // bordes vienen con offsets MEZCLADOS ("-03:00" y "Z"), y el orden alfabético
  // no es el cronológico → el premio de AYER 22:00 UY se cuenta como de HOY.
  it.fails("EL PREMIO DE AYER A LAS 22:00 UY SE CUENTA COMO DE HOY (bordes con offsets mezclados)", () => {
    conTZ("UTC", () => {
      const v = ventanasDe(HOY);
      const deAyer = "2026-08-06T01:00:00+00:00"; // 5-ago 22:00 UY, tal cual PostgREST
      const cae = deAyer >= v[0].desde && deAyer < v[0].hasta;
      expect(cae).toBe(false);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  9. ⚠️ HALLAZGO MEDIO — el DOMINGO en la ruta del cobrador
// ═════════════════════════════════════════════════════════════════════════
describe("ruta del cobrador — el domingo no vence ninguna cuota", () => {
  const alDia = {
    cuota: 1000,
    totalDias: 24,
    fechaInicio: "2026-08-03", // lunes
    frecuencia: "diario" as FrecuenciaPrestamo,
    pagadoAcum: 6000, // pagó de lunes a sábado: está AL DÍA
  };

  it("el LUNES el crédito diario al día sí tiene su cuota para cobrar", () => {
    expect(cuotaObjetivoHoy(alDia, parseFecha("2026-08-10"))).toBe(1000);
  });

  it("el DOMINGO un crédito SEMANAL al día muestra 'hoy no toca' (objetivo 0)", () => {
    expect(
      cuotaObjetivoHoy(
        { cuota: 5000, totalDias: 6, fechaInicio: "2026-06-01", frecuencia: "semanal", pagadoAcum: 5000 },
        parseFecha("2026-06-07"), // domingo
      ),
    ).toBe(0);
  });

  it("el DOMINGO un crédito diario ATRASADO sigue debiendo (la deuda no se borra)", () => {
    // Pagó 3 de las 6 cuotas vencidas → debe 3.000, capado a una cuota del día.
    expect(cuotaObjetivoHoy({ ...alDia, pagadoAcum: 3000 }, parseFecha("2026-08-09"))).toBe(1000);
  });

  // ✅ ARREGLADO (06-08). `cuotaObjetivoHoy` cortaba en la primera línea para
  // "diario" y devolvía la cuota sin mirar el calendario hábil: el domingo la ruta
  // le marcaba "Pendiente · Falta $1.000" a TODOS los diarios al día, y el panel
  // mostraba la meta del día en 0%. El cartón del mismo cliente decía lo contrario
  // (fechaDeCuota nunca genera un domingo). Ahora las dos cuentas coinciden.
  it("el domingo un diario al día no debe nada: ruta y cartón dicen lo mismo", () => {
    expect(cuotaObjetivoHoy(alDia, parseFecha("2026-08-09"))).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  10. ⚠️ HALLAZGO MEDIO — el recordatorio .ics que se lleva el cliente
// ═════════════════════════════════════════════════════════════════════════

/** Los días en que el celular del cliente haría sonar la alarma, leídos del .ics
 *  que le mandamos (DTSTART + RRULE). Es lo que el cliente REALMENTE ve. */
function alarmasDelIcs(ics: string, cuantas: number): string[] {
  const dt = /DTSTART:(\d{4})(\d{2})(\d{2})/.exec(ics);
  const rr = /RRULE:([^\r\n]+)/.exec(ics);
  if (!dt || !rr) throw new Error("el .ics no trae DTSTART/RRULE");
  const partes: Record<string, string> = {};
  for (const p of rr[1].split(";")) {
    const [k, v] = p.split("=");
    partes[k] = v;
  }
  const paso = Number(partes.INTERVAL ?? 1);
  const d = new Date(Number(dt[1]), Number(dt[2]) - 1, Number(dt[3]));
  const salida: string[] = [];
  while (salida.length < cuantas) {
    if (partes.FREQ !== "DAILY" || d.getDay() !== 0) salida.push(toIso(d));
    if (partes.FREQ === "WEEKLY") d.setDate(d.getDate() + 7 * paso);
    else if (partes.FREQ === "MONTHLY") d.setMonth(d.getMonth() + paso);
    else d.setDate(d.getDate() + paso);
  }
  return salida;
}

interface PrestamoIcs {
  id: string;
  cuota_diaria: number;
  total_dias: number;
  fecha_inicio: string;
  frecuencia: FrecuenciaPrestamo;
}

describe("recordatorio .ics — la alarma del cliente tiene que caer el día de SU cuota", () => {
  const TOKEN = "tokendemo123";

  beforeEach(() => {
    vi.useFakeTimers();
    clientePorToken.mockResolvedValue({ id: "cli-1" });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function icsDe(prestamo: PrestamoIcs, ahoraIso: string): Promise<string> {
    vi.setSystemTime(new Date(ahoraIso));
    prestamoActivo.mockResolvedValue(prestamo);
    const res = await descargarRecordatorio(
      new Request(`https://presta.ya/c/${TOKEN}/recordatorio`),
      { params: Promise.resolve({ token: TOKEN }) },
    );
    expect(res.status).toBe(200);
    return res.text();
  }

  it("DIARIO: suena de lunes a sábado y termina el día de la última cuota", async () => {
    const ics = await icsDe(
      { id: "p1", cuota_diaria: 1000, total_dias: 24, fecha_inicio: "2026-08-03", frecuencia: "diario" },
      "2026-08-06T15:00:00Z", // jueves 6-ago 12:00 UY
    );
    expect(ics).toContain("BYDAY=MO,TU,WE,TH,FR,SA");
    expect(ics).toContain("UNTIL=20260829T235959"); // la 24ª cuota, con el calendario hábil
    // Las 6 primeras alarmas coinciden con las 6 cuotas que le quedan desde hoy.
    const inicio = parseFecha("2026-08-03");
    expect(alarmasDelIcs(ics, 6)).toEqual(
      Array.from({ length: 6 }, (_, k) => toIso(fechaDeCuota(inicio, 3 + k, "diario"))),
    );
  });

  it("el .ics no le pide plata a un cliente que descarga ANTES de que arranque su crédito", async () => {
    const ics = await icsDe(
      { id: "p2", cuota_diaria: 1000, total_dias: 24, fecha_inicio: "2026-08-17", frecuencia: "diario" },
      "2026-08-06T15:00:00Z",
    );
    expect(ics).toContain("DTSTART:20260817T090000"); // arranca con el crédito, no hoy
  });

  // ⚠️ FALLA: bug real, ver informe. El DTSTART se ancla en el DÍA DE LA DESCARGA:
  // el cliente semanal que baja el .ics un jueves queda avisado todos los jueves,
  // 3 días TARDE respecto de su cuota, todas las semanas hasta el final.
  it.fails("SEMANAL: LA ALARMA SUENA EL DÍA QUE DESCARGÓ, NO EL DÍA DE LA CUOTA", async () => {
    const ics = await icsDe(
      { id: "p3", cuota_diaria: 5000, total_dias: 12, fecha_inicio: "2026-06-01", frecuencia: "semanal" },
      "2026-08-06T15:00:00Z", // jueves; sus cuotas caen los LUNES
    );
    expect(ics).toContain("DTSTART:20260810T090000"); // el próximo lunes
  });

  // ⚠️ FALLA: bug real, ver informe. El RRULE quincenal usa FREQ=WEEKLY;INTERVAL=2
  // (14 días) mientras el cronograma real avanza 15: la alarma se adelanta 1 día
  // por cuota. Acá se descarga JUSTO el día de una cuota, así que el DTSTART está
  // bien y lo único que falla es el paso.
  it.fails("QUINCENAL: EL PASO DE LA ALARMA ES DE 14 DÍAS Y LA CUOTA ES CADA 15", async () => {
    const ics = await icsDe(
      { id: "p4", cuota_diaria: 8000, total_dias: 8, fecha_inicio: "2026-06-01", frecuencia: "quincenal" },
      "2026-07-31T15:00:00Z", // viernes 31-jul: ES día de cuota (la 5ª)
    );
    const alarmas = alarmasDelIcs(ics, 3);
    expect(alarmas[0]).toBe("2026-07-31");
    expect(alarmas[1]).toBe("2026-08-15"); // el .ics dice 2026-08-14
  });

  it("sin crédito activo no se entrega ningún recordatorio", async () => {
    vi.setSystemTime(new Date("2026-08-06T15:00:00Z"));
    prestamoActivo.mockResolvedValue(null);
    const res = await descargarRecordatorio(
      new Request(`https://presta.ya/c/${TOKEN}/recordatorio`),
      { params: Promise.resolve({ token: TOKEN }) },
    );
    expect(res.status).toBe(404);
  });
});
