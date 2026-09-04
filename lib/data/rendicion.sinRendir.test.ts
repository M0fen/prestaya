// ─────────────────────────────────────────────────────────────────────────
//  JORNADAS SIN CERRAR — el número que se sella en un acta INMUTABLE.
//
//  `getJornadasSinRendir` alimenta dos pantallas: el aviso del cobrador ("te
//  quedaron N jornadas sin cerrar") y la entrega diferida del supervisor, donde
//  ese `esperado` se convierte en el monto de un acta que después NO se edita.
//  Estaba sin un solo test — y es el corazón de la queja de la caja: mientras la
//  jornada no se cierre, el arrastre no ocurre y el cobrador amanece en $0.
//
//  Lo que se fija acá:
//   · Una jornada se abre por COBROS o por BASE entregada (el peor caso medido:
//     recibió base y no cobró nada — $105.520 en alerta perpetua sin salida).
//   · Las que ya tienen acta salen de la lista.
//   · HOY nunca aparece: tiene su propio cierre en el teléfono del cobrador.
//   · El `esperado` descuenta lo que NO tiene en la mano: capital colocado y
//     gastos aprobados.
//   · La base ARRASTRADA de la última acta cuenta aunque nadie la haya cargado.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it, vi, beforeEach } from "vitest";

/** Tablas del doble; cada test las rellena antes de llamar. */
const tablas: Record<string, Record<string, unknown>[]> = {
  pagos: [],
  aperturas_caja: [],
  rendiciones: [],
  solicitudes_gasto: [],
  usuarios: [],
};

/** Doble encadenable con los filtros que la consulta usa de verdad. */
function builder(tabla: string) {
  const eq: [string, unknown][] = [];
  const inn: [string, unknown[]][] = [];
  let gte: [string, string] | null = null;
  let lt: [string, string] | null = null;
  let isNull: string | null = null;

  const filtrar = () =>
    (tablas[tabla] ?? []).filter(
      (f) =>
        eq.every(([c, v]) => f[c] === v) &&
        inn.every(([c, v]) => v.includes(f[c] as string)) &&
        (isNull == null || f[isNull] == null) &&
        (gte == null || String(f[gte[0]]) >= gte[1]) &&
        (lt == null || String(f[lt[0]]) < lt[1]),
    );

  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => (eq.push([c, v]), b),
    in: (c: string, v: unknown[]) => (inn.push([c, v]), b),
    is: (c: string, _v: null) => ((isNull = c), b),
    gte: (c: string, v: string) => ((gte = [c, v]), b),
    lt: (c: string, v: string) => ((lt = [c, v]), b),
    order: () => b,
    range: (d: number, h: number) => Promise.resolve({ data: filtrar().slice(d, h + 1), error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: filtrar(), error: null }).then(ok),
  };
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
// El capital colocado se resuelve aparte (consulta propia con service_role).
const colocado = new Map<string, number>();
vi.mock("./colocado", () => ({
  colocadoEnDias: vi.fn(async () => colocado),
  claveColocado: (c: string, ymd: string) => `${c}|${ymd}`,
}));

import { getJornadasSinRendir } from "./rendicion";
import type { SupabaseClient } from "@supabase/supabase-js";

/** La función consulta con el cliente ADMIN: este parámetro no se usa. */
const DB = { from: (t: string) => builder(t) } as unknown as SupabaseClient;

const COB = "u-maria";
const OTRO = "u-victor";
/** Jueves 03-09-2026. El día UY se resuelve adentro (corte 03:00 UTC). */
const HOY = new Date("2026-09-03T14:00:00Z");
/** Un pago de $X registrado ese día UY (mediodía: lejos del corte). */
const pago = (cobrador: string, ymd: string, monto: number) => ({
  id: `${cobrador}-${ymd}-${monto}`,
  registrado_por: cobrador,
  registrado_en: `${ymd}T15:00:00Z`,
  monto,
  anulado: false,
  origen: null,
});

beforeEach(() => {
  for (const k of Object.keys(tablas)) tablas[k] = [];
  colocado.clear();
  tablas.usuarios = [
    { id: COB, nombre: "María Artunduaga" },
    { id: OTRO, nombre: "Víctor Moralez" },
  ];
});

describe("getJornadasSinRendir — la plata que quedó sin papel", () => {
  it("un día con cobros y sin acta aparece, con la cuenta hecha", async () => {
    tablas.pagos = [pago(COB, "2026-09-01", 12_000), pago(COB, "2026-09-01", 3_000)];
    const [j] = await getJornadasSinRendir(DB, null, HOY);
    expect(j.cobradorId).toBe(COB);
    expect(j.fecha).toBe("2026-09-01");
    expect(j.recaudado).toBe(15_000);
    expect(j.cobros).toBe(2);
    expect(j.esperado).toBe(15_000); // sin base, sin gastos, sin colocado
    expect(j.antiguedad).toBe(2); // anteayer
    expect(j.cobradorNombre).toBe("María Artunduaga");
  });

  it("la que YA tiene acta no aparece", async () => {
    tablas.pagos = [pago(COB, "2026-09-01", 12_000)];
    tablas.rendiciones = [{ id: "r1", cobrador_id: COB, fecha: "2026-09-01" }];
    expect(await getJornadasSinRendir(DB, null, HOY)).toEqual([]);
  });

  it("HOY nunca aparece: tiene su propio cierre en el teléfono", async () => {
    tablas.pagos = [pago(COB, "2026-09-03", 20_000)];
    expect(await getJornadasSinRendir(DB, null, HOY)).toEqual([]);
  });

  it("⚠️ una BASE entregada abre la jornada aunque no haya cobrado NADA", async () => {
    // El peor caso medido: recibió base, no registró un cobro, y quedaba en
    // alerta perpetua sin ningún botón que lo resolviera ($105.520 el 06-08).
    tablas.aperturas_caja = [{ id: "a1", cobrador_id: COB, fecha: "2026-09-02", base: 30_000 }];
    const [j] = await getJornadasSinRendir(DB, null, HOY);
    expect(j.fecha).toBe("2026-09-02");
    expect(j.cobros).toBe(0);
    expect(j.base).toBe(30_000);
    expect(j.esperado).toBe(30_000); // la base sola ya es plata en su mano
  });

  it("el ESPERADO descuenta lo que NO tiene en la mano: colocado y gastos", async () => {
    tablas.pagos = [pago(COB, "2026-09-01", 20_000)];
    tablas.aperturas_caja = [{ id: "a1", cobrador_id: COB, fecha: "2026-09-01", base: 5_000 }];
    tablas.solicitudes_gasto = [
      { id: "g1", cobrador_id: COB, monto: 1_500, estado: "aprobada", solicitado_en: "2026-09-01T15:00:00Z" },
    ];
    colocado.set(`${COB}|2026-09-01`, 8_000);
    const [j] = await getJornadasSinRendir(DB, null, HOY);
    // 5.000 base + 20.000 cobrado − 1.500 gastos − 8.000 colocados = 15.500.
    expect(j.esperado).toBe(15_500);
    expect(j.colocado).toBe(8_000);
    expect(j.gastos).toBe(1_500);
  });

  it("un gasto NO aprobado no baja el esperado", async () => {
    tablas.pagos = [pago(COB, "2026-09-01", 10_000)];
    tablas.solicitudes_gasto = [
      { id: "g1", cobrador_id: COB, monto: 4_000, estado: "pendiente", solicitado_en: "2026-09-01T15:00:00Z" },
    ];
    expect((await getJornadasSinRendir(DB, null, HOY))[0].esperado).toBe(10_000);
  });

  it("la base ARRASTRADA del acta anterior cuenta, aunque nadie la haya cargado", async () => {
    // Cerró el lunes declarando que se quedaba $5.000; el martes cobró y no cerró.
    // Sin esto, el acta de entrega diferida del martes perdía esos $5.000.
    tablas.rendiciones = [
      { id: "r1", cobrador_id: COB, fecha: "2026-09-01", base: 0, recaudado: 20_000, gastos: 0, entregado: 15_000, colocado: 0, diferencia: 0 },
    ];
    tablas.pagos = [pago(COB, "2026-09-02", 8_000)];
    const [j] = await getJornadasSinRendir(DB, null, HOY);
    expect(j.fecha).toBe("2026-09-02");
    expect(j.base).toBe(5_000);
    expect(j.esperado).toBe(13_000); // 5.000 arrastrados + 8.000 cobrados
  });

  it("un FALTANTE del día anterior no se arrastra como base (candado anti-fraude)", async () => {
    tablas.rendiciones = [
      { id: "r1", cobrador_id: COB, fecha: "2026-09-01", base: 0, recaudado: 20_000, gastos: 0, entregado: 15_000, colocado: 0, diferencia: -5_000 },
    ];
    tablas.pagos = [pago(COB, "2026-09-02", 8_000)];
    const [j] = await getJornadasSinRendir(DB, null, HOY);
    expect(j.base).toBe(0);
    expect(j.esperado).toBe(8_000);
  });

  it("acota por cobrador cuando el supervisor mira solo su zona", async () => {
    tablas.pagos = [pago(COB, "2026-09-01", 10_000), pago(OTRO, "2026-09-01", 7_000)];
    const soloUno = await getJornadasSinRendir(DB, [COB], HOY);
    expect(soloUno).toHaveLength(1);
    expect(soloUno[0].cobradorId).toBe(COB);
    // Y con una lista vacía (supervisor sin cobradores) no devuelve nada.
    expect(await getJornadasSinRendir(DB, [], HOY)).toEqual([]);
  });

  it("ordena por antigüedad: lo más viejo primero (es lo que se olvida)", async () => {
    tablas.pagos = [
      pago(COB, "2026-09-02", 5_000),
      pago(COB, "2026-08-28", 9_000),
      pago(COB, "2026-09-01", 7_000),
    ];
    const js = await getJornadasSinRendir(DB, null, HOY);
    expect(js.map((j) => j.fecha)).toEqual(["2026-08-28", "2026-09-01", "2026-09-02"]);
    expect(js[0].antiguedad).toBeGreaterThan(js[2].antiguedad);
  });

  it("fuera de la ventana de días no se mira (30 por defecto)", async () => {
    tablas.pagos = [pago(COB, "2026-06-01", 50_000)];
    expect(await getJornadasSinRendir(DB, null, HOY)).toEqual([]);
  });

  it("los importes son SIEMPRE enteros (nunca centavos en un acta)", async () => {
    tablas.pagos = [pago(COB, "2026-09-01", 10_000.7)];
    const [j] = await getJornadasSinRendir(DB, null, HOY);
    expect(Number.isInteger(j.recaudado)).toBe(true);
    expect(Number.isInteger(j.esperado)).toBe(true);
  });

  it("sin actividad no inventa jornadas", async () => {
    expect(await getJornadasSinRendir(DB, null, HOY)).toEqual([]);
  });
});
