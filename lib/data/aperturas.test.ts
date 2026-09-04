// ─────────────────────────────────────────────────────────────────────────
//  EL ARRASTRE DE LA CAJA — "que la cuadra final siempre amanezca como base
//  diaria todos los días" (regla de Carlos, 06-08).
//
//  POR QUÉ ESTE ARCHIVO EXISTE. Las reglas puras del cierre (cajaFinal,
//  baseDeMananaDesdeActa) estaban probadas, pero la función que las CONECTA con
//  la base de datos —la que de verdad decide con cuánta plata amanece el
//  cobrador— no tenía un solo test. Y esa promesa es exactamente la queja que
//  volvió del piloto: "de un día a otro la caja no permanece".
//
//  El orden de verdad que se fija acá:
//    1. La base CARGADA por el supervisor para hoy siempre gana (es plata que
//       él contó y entregó, y es la forma de corregir un arrastre torcido).
//    2. Si no hay, la CAJA FINAL de la última acta rendida.
//    3. Si nunca rindió, 0.
//  Y el candado anti-fraude: un FALTANTE nunca se convierte en base.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// `colocadoEnDias` sale a buscar el capital colocado con el cliente ADMIN
// (service_role). Acá se neutraliza: los casos pasan el `colocado` ya sellado en
// el acta (0136), que es lo que hace la base viva desde entonces.
vi.mock("./colocado", () => ({
  colocadoEnDias: vi.fn(async () => new Map()),
  claveColocado: (cobradorId: string, ymd: string) => `${cobradorId}|${ymd}`,
}));

import { getBaseDelDia } from "./aperturas";

const COB = "u-maria";
/** Jueves 03-09-2026, a media mañana: el día UY se resuelve adentro. */
const HOY = new Date("2026-09-03T14:00:00Z");

/** Acta de rendición, con los términos que de verdad guarda la tabla. */
function acta(o: {
  fecha: string;
  base?: number;
  recaudado?: number;
  gastos?: number;
  entregado?: number;
  colocado?: number | null;
  diferencia?: number;
}) {
  return {
    cobrador_id: COB,
    fecha: o.fecha,
    base: o.base ?? 0,
    recaudado: o.recaudado ?? 0,
    gastos: o.gastos ?? 0,
    entregado: o.entregado ?? 0,
    colocado: o.colocado ?? 0,
    diferencia: o.diferencia ?? 0,
  };
}

/**
 * Doble de Supabase, encadenable, con los filtros que importan: la fecha de la
 * apertura (igualdad) y el rango de las rendiciones (gte/lt) con su orden.
 */
function crearDb(tablas: { aperturas?: Record<string, unknown>[]; rendiciones: Record<string, unknown>[] }) {
  const db = {
    from(tabla: string) {
      const filas =
        tabla === "aperturas_caja" ? (tablas.aperturas ?? []) : tabla === "rendiciones" ? tablas.rendiciones : [];
      const eq: [string, unknown][] = [];
      let gte: string | null = null;
      let lt: string | null = null;
      let desc = false;

      const filtrar = () =>
        filas.filter(
          (f) =>
            eq.every(([c, v]) => f[c] === v) &&
            (gte == null || String(f.fecha) >= gte) &&
            (lt == null || String(f.fecha) < lt),
        );

      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => (eq.push([c, v]), b),
        gte: (_c: string, v: string) => ((gte = v), b),
        lt: (_c: string, v: string) => ((lt = v), b),
        order: (_c: string, o?: { ascending?: boolean }) => ((desc = o?.ascending === false), b),
        limit: (n: number) => {
          const out = filtrar().sort((a, z) =>
            desc ? String(z.fecha).localeCompare(String(a.fecha)) : String(a.fecha).localeCompare(String(z.fecha)),
          );
          return Promise.resolve({ data: out.slice(0, n), error: null });
        },
        maybeSingle: () => Promise.resolve({ data: filtrar()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: filtrar(), error: null }).then(ok),
      };
      return b;
    },
  };
  return db as unknown as SupabaseClient;
}

describe("getBaseDelDia — con cuánta plata amanece el cobrador", () => {
  it("se quedó $5.000 declarados al cerrar ayer → hoy amanece con $5.000", async () => {
    // Base 0, cobró 20.000, entregó 15.000 y declaró quedarse 5.000 (cuadra: dif 0).
    const db = crearDb({
      rendiciones: [acta({ fecha: "2026-09-02", recaudado: 20_000, entregado: 15_000, diferencia: 0 })],
    });
    const r = await getBaseDelDia(db, COB, HOY);
    expect(r.base).toBe(5_000);
    expect(r.origen).toBe("arrastre");
    expect(r.desdeFecha).toBe("2026-09-02");
    // Y dice de dónde salió el número, para que el supervisor siga la cuenta.
    expect(r.detalle).toMatchObject({ recaudado: 20_000, entregado: 15_000 });
  });

  it("entregó TODO → amanece en 0, como siempre fue", async () => {
    const db = crearDb({
      rendiciones: [acta({ fecha: "2026-09-02", recaudado: 20_000, entregado: 20_000, diferencia: 0 })],
    });
    const r = await getBaseDelDia(db, COB, HOY);
    expect(r.base).toBe(0);
    expect(r.origen).toBe("sin_base");
  });

  it("⚠️ CANDADO ANTI-FRAUDE: un FALTANTE no se convierte en base de mañana", async () => {
    // Cobró 20.000 y entregó 15.000 SIN declarar que se quedaba nada: faltan
    // 5.000. Si eso volviera como base, mañana el cierre se lo prellenaría en
    // "Me quedo" y el que se guarda plata cuadraría para siempre.
    const db = crearDb({
      rendiciones: [acta({ fecha: "2026-09-02", recaudado: 20_000, entregado: 15_000, diferencia: -5_000 })],
    });
    const r = await getBaseDelDia(db, COB, HOY);
    expect(r.base).toBe(0);
    expect(r.origen).toBe("sin_base");
  });

  it("faltante PARCIAL: arrastra solo lo declarado, no lo que falta", async () => {
    // Esperado 20.000: entregó 13.000, declaró quedarse 5.000 → faltan 2.000.
    // Arrastran los 5.000 declarados; los 2.000 siguen siendo faltante.
    const db = crearDb({
      rendiciones: [acta({ fecha: "2026-09-02", recaudado: 20_000, entregado: 13_000, diferencia: -2_000 })],
    });
    expect((await getBaseDelDia(db, COB, HOY)).base).toBe(5_000);
  });

  it("el CAPITAL COLOCADO no vuelve como base: esa plata está en la calle", async () => {
    // Cobró 20.000, colocó 8.000 en un crédito y entregó 10.000: en la mano le
    // quedan 2.000, no 10.000. Sin descontar el colocado, el capital prestado
    // se auto-perpetuaba como base (el fantasma que mató la 0136).
    const db = crearDb({
      rendiciones: [
        acta({ fecha: "2026-09-02", recaudado: 20_000, colocado: 8_000, entregado: 10_000, diferencia: 0 }),
      ],
    });
    expect((await getBaseDelDia(db, COB, HOY)).base).toBe(2_000);
  });

  it("la base CARGADA por el supervisor gana sobre el arrastre (es la corrección)", async () => {
    const db = crearDb({
      aperturas: [{ cobrador_id: COB, fecha: "2026-09-03", base: 12_000 }],
      rendiciones: [acta({ fecha: "2026-09-02", recaudado: 20_000, entregado: 15_000, diferencia: 0 })],
    });
    const r = await getBaseDelDia(db, COB, HOY);
    expect(r.base).toBe(12_000);
    expect(r.origen).toBe("cargada");
  });

  it("salta los días que no salió a la calle: busca la última acta hacia atrás", async () => {
    // Rindió el lunes 31-08 y no trabajó martes ni miércoles. El jueves sigue
    // amaneciendo con lo suyo: mirar solo AYER perdía el arrastre por un feriado.
    const db = crearDb({
      rendiciones: [acta({ fecha: "2026-08-31", recaudado: 9_000, entregado: 6_000, diferencia: 0 })],
    });
    const r = await getBaseDelDia(db, COB, HOY);
    expect(r.base).toBe(3_000);
    expect(r.desdeFecha).toBe("2026-08-31");
  });

  it("toma la MÁS RECIENTE cuando hay varias actas en la ventana", async () => {
    const db = crearDb({
      rendiciones: [
        acta({ fecha: "2026-08-31", recaudado: 9_000, entregado: 6_000 }),
        acta({ fecha: "2026-09-02", recaudado: 20_000, entregado: 15_000 }),
        acta({ fecha: "2026-09-01", recaudado: 5_000, entregado: 1_000 }),
      ],
    });
    const r = await getBaseDelDia(db, COB, HOY);
    expect(r.desdeFecha).toBe("2026-09-02");
    expect(r.base).toBe(5_000);
  });

  it("una acta de HOY no es base de hoy (la jornada todavía está abierta)", async () => {
    const db = crearDb({
      rendiciones: [acta({ fecha: "2026-09-03", recaudado: 20_000, entregado: 15_000 })],
    });
    expect((await getBaseDelDia(db, COB, HOY)).base).toBe(0);
  });

  it("actas viejas fuera de la ventana no arrastran (7 días por defecto)", async () => {
    const db = crearDb({
      rendiciones: [acta({ fecha: "2026-08-01", recaudado: 20_000, entregado: 15_000 })],
    });
    expect((await getBaseDelDia(db, COB, HOY)).origen).toBe("sin_base");
  });

  it("cobrador que NUNCA rindió: 0, sin inventar plata", async () => {
    expect((await getBaseDelDia(crearDb({ rendiciones: [] }), COB, HOY)).base).toBe(0);
  });

  it("la base de OTRO cobrador no se mezcla", async () => {
    const db = crearDb({
      rendiciones: [
        { ...acta({ fecha: "2026-09-02", recaudado: 50_000, entregado: 0 }), cobrador_id: "u-otro" },
      ],
    });
    // El doble filtra por cobrador_id igual que la consulta real.
    expect((await getBaseDelDia(db, COB, HOY)).base).toBe(0);
  });

  it("SIEMPRE devuelve pesos enteros (nunca float en dinero)", async () => {
    const db = crearDb({
      rendiciones: [acta({ fecha: "2026-09-02", recaudado: 20_000.6, entregado: 15_000.2, diferencia: 0 })],
    });
    const r = await getBaseDelDia(db, COB, HOY);
    expect(Number.isInteger(r.base)).toBe(true);
  });
});
