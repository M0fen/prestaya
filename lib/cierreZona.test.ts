import { describe, it, expect } from "vitest";
import { consolidarPorZona, type RendidaLite, type PendienteLite } from "./cierreZona";

// Helpers para armar fixtures legibles.
const rend = (o: Partial<RendidaLite> & { cobradorId: string }): RendidaLite => ({
  nombre: o.nombre ?? o.cobradorId,
  recaudado: o.recaudado ?? 0,
  gastos: o.gastos ?? 0,
  entregado: o.entregado ?? 0,
  diferencia: o.diferencia ?? 0,
  estado: o.estado ?? "cuadra",
  ...o,
});

describe("consolidarPorZona", () => {
  const zonaNombre = new Map([
    ["zA", "Zona Norte"],
    ["zB", "Zona Sur"],
  ]);
  const cobradorZona = new Map<string, string | null>([
    ["c1", "zA"],
    ["c2", "zA"],
    ["c3", "zB"],
    ["c4", null], // sin zona
  ]);

  it("agrupa por zona y suma esperado/entregado/faltante/sobrante", () => {
    const rendidas: RendidaLite[] = [
      // Zona A: c1 cuadra (entregó 900 sobre 900), c2 faltante (entregó 400 sobre 500).
      rend({ cobradorId: "c1", recaudado: 1000, gastos: 100, entregado: 900, diferencia: 0, estado: "cuadra" }),
      rend({ cobradorId: "c2", recaudado: 500, gastos: 0, entregado: 400, diferencia: -100, estado: "faltante" }),
      // Zona B: c3 sobrante (entregó 620 sobre 600).
      rend({ cobradorId: "c3", recaudado: 600, gastos: 0, entregado: 620, diferencia: 20, estado: "sobrante" }),
    ];
    const { zonas, totalFaltante, totalSobrante, totalEntregado } = consolidarPorZona(
      rendidas,
      [],
      cobradorZona,
      zonaNombre,
    );

    const zA = zonas.find((z) => z.zonaId === "zA")!;
    const zB = zonas.find((z) => z.zonaId === "zB")!;
    expect(zA.zonaNombre).toBe("Zona Norte");
    expect(zA.totalEsperado).toBe(1400); // (1000−100) + 500
    expect(zA.totalEntregado).toBe(1300); // 900 + 400
    expect(zA.totalFaltante).toBe(100);
    expect(zA.totalSobrante).toBe(0);
    expect(zA.rendidos).toBe(2);

    expect(zB.totalSobrante).toBe(20);
    expect(zB.totalFaltante).toBe(0);

    // Gran total.
    expect(totalFaltante).toBe(100);
    expect(totalSobrante).toBe(20);
    expect(totalEntregado).toBe(1300 + 620);
  });

  it("un pendiente cuenta como 'por rendir', NO como faltante", () => {
    const pendientes: PendienteLite[] = [{ cobradorId: "c1", nombre: "Ana", recaudado: 800, cobros: 5 }];
    const { zonas, porRendir, totalFaltante } = consolidarPorZona([], pendientes, cobradorZona, zonaNombre);
    const zA = zonas.find((z) => z.zonaId === "zA")!;
    expect(zA.porRendir).toBe(800);
    expect(zA.pendientes).toBe(1);
    expect(zA.totalFaltante).toBe(0); // no rindió → no es faltante
    expect(zA.cobradores[0].estado).toBe("pendiente");
    expect(porRendir).toBe(800);
    expect(totalFaltante).toBe(0);
  });

  it("un cobrador sin zona cae en el balde 'Sin zona'", () => {
    const rendidas = [rend({ cobradorId: "c4", recaudado: 300, entregado: 300, estado: "cuadra" })];
    const { zonas } = consolidarPorZona(rendidas, [], cobradorZona, zonaNombre);
    const sinZona = zonas.find((z) => z.zonaId === null)!;
    expect(sinZona.zonaNombre).toBe("Sin zona");
    expect(sinZona.totalEntregado).toBe(300);
  });

  it("ordena las zonas por faltante y, dentro, faltantes/pendientes primero", () => {
    const rendidas = [
      rend({ cobradorId: "c1", recaudado: 500, entregado: 500, diferencia: 0, estado: "cuadra" }), // zA
      rend({ cobradorId: "c3", recaudado: 500, entregado: 300, diferencia: -200, estado: "faltante" }), // zB
    ];
    const pendientes: PendienteLite[] = [{ cobradorId: "c2", nombre: "Beto", recaudado: 100, cobros: 1 }]; // zA
    const { zonas } = consolidarPorZona(rendidas, pendientes, cobradorZona, zonaNombre);
    // Zona B (faltante 200) va antes que Zona A (faltante 0).
    expect(zonas[0].zonaId).toBe("zB");
    // Dentro de Zona A, el pendiente (Beto) va antes que el que cuadró (c1).
    const zA = zonas.find((z) => z.zonaId === "zA")!;
    expect(zA.cobradores[0].estado).toBe("pendiente");
  });

  it("sin datos → consolidado vacío y en cero", () => {
    const c = consolidarPorZona([], [], cobradorZona, zonaNombre);
    expect(c.zonas).toHaveLength(0);
    expect(c.totalRecaudado).toBe(0);
    expect(c.porRendir).toBe(0);
  });
});

// ── Cobro DESPUÉS de rendir: el sello de la zona tiene que ser honesto ──────
// El cierre de zona es ÚNICO e INMUTABLE por zona/día. Si un cobrador cobra
// después de haber rendido, ese efectivo está en su bolsillo y NO entró en su
// rendición: si el sello no lo cuenta, nace declarando un total que ya sabemos
// incompleto y no hay forma de corregirlo (no puede re-rendir, el cierre no se
// edita). Tiene que aflorar como faltante EN EL MOMENTO del cierre.
describe("consolidarPorZona — cobro post-rendición", () => {
  const zonaNombre = new Map([["z1", "Centro"]]);
  const cobradorZona = new Map<string, string | null>([["c1", "z1"]]);

  it("suma al esperado lo cobrado después de rendir y lo muestra como faltante", () => {
    const rendidas: RendidaLite[] = [
      {
        cobradorId: "c1", nombre: "Ana", recaudado: 1000, gastos: 0,
        entregado: 1000, diferencia: 0, estado: "cuadra",
        recaudadoVivo: 1300, // cobró 300 más DESPUÉS de cerrar
      },
    ];
    const { zonas } = consolidarPorZona(rendidas, [], cobradorZona, zonaNombre);
    const z = zonas[0];
    expect(z.cobradores[0].cobroPostCierre).toBe(300);
    expect(z.totalEsperado).toBe(1300); // 1000 rendidos + 300 en el bolsillo
    expect(z.totalEntregado).toBe(1000);
    expect(z.totalFaltante).toBe(300); // el hueco se ve al cerrar, no mañana
    expect(z.totalRecaudado).toBe(1300);
  });

  it("acumula el post-rendición sobre un faltante que ya existía", () => {
    const rendidas: RendidaLite[] = [
      {
        cobradorId: "c1", nombre: "Ana", recaudado: 1000, gastos: 0,
        entregado: 900, diferencia: -100, estado: "faltante",
        recaudadoVivo: 1200,
      },
    ];
    const { zonas, totalFaltante } = consolidarPorZona(rendidas, [], cobradorZona, zonaNombre);
    expect(zonas[0].totalEsperado).toBe(1200);
    expect(zonas[0].totalFaltante).toBe(300); // 100 del cierre + 200 cobrados después
    expect(totalFaltante).toBe(300);
  });

  it("un sobrante mayor al post-rendición sigue siendo sobrante", () => {
    const rendidas: RendidaLite[] = [
      {
        cobradorId: "c1", nombre: "Ana", recaudado: 1000, gastos: 0,
        entregado: 1500, diferencia: 500, estado: "sobrante",
        recaudadoVivo: 1200,
      },
    ];
    const { zonas } = consolidarPorZona(rendidas, [], cobradorZona, zonaNombre);
    expect(zonas[0].totalSobrante).toBe(300); // 500 de sobrante − 200 en el bolsillo
    expect(zonas[0].totalFaltante).toBe(0);
  });

  it("sin recaudadoVivo (o igual al congelado) no cambia nada", () => {
    const rendidas: RendidaLite[] = [
      { cobradorId: "c1", nombre: "Ana", recaudado: 1000, gastos: 0, entregado: 1000, diferencia: 0, estado: "cuadra" },
    ];
    const { zonas } = consolidarPorZona(rendidas, [], cobradorZona, zonaNombre);
    expect(zonas[0].totalEsperado).toBe(1000);
    expect(zonas[0].totalFaltante).toBe(0);
    expect(zonas[0].cobradores[0].cobroPostCierre).toBe(0);
  });
});

describe("RETENIDO ('me quedo para mañana') en el cierre por zona (auditoría 16-08)", () => {
  const cobradorZona = new Map<string, string | null>([["c1", "zA"], ["c2", "zA"]]);
  const zonaNombre = new Map([["zA", "Zona A"]]);

  it("un cobrador que retuvo su base y CUADRÓ no le agrega faltante al sello de la zona", () => {
    // base 5.000 + cobró 20.000 = esperado 25.000. Entregó 20.000 y se quedó 5.000
    // (declarados): su acta dice diferencia 0. El supervisor recibe 20.000, no 25.000.
    const rendidas: RendidaLite[] = [
      rend({ cobradorId: "c1", base: 5000, recaudado: 20000, gastos: 0, entregado: 20000, diferencia: 0, estado: "cuadra" }),
    ];
    const { zonas, totalFaltante } = consolidarPorZona(rendidas, [], cobradorZona, zonaNombre);
    const z = zonas[0];
    expect(z.cobradores[0].retenido).toBe(5000);
    expect(z.totalEsperado).toBe(20000); // lo que de verdad va al supervisor
    expect(z.totalEntregado).toBe(20000);
    expect(totalFaltante).toBe(0); // antes: −5.000 en un sello inmutable
  });

  it("un FALTANTE real sigue siendo faltante (retenido derivado = 0)", () => {
    const rendidas: RendidaLite[] = [
      rend({ cobradorId: "c2", base: 5000, recaudado: 20000, gastos: 0, entregado: 20000, diferencia: -5000, estado: "faltante" }),
    ];
    const { zonas, totalFaltante } = consolidarPorZona(rendidas, [], cobradorZona, zonaNombre);
    expect(zonas[0].cobradores[0].retenido).toBe(0);
    expect(zonas[0].totalEsperado).toBe(25000);
    expect(totalFaltante).toBe(5000);
  });
});
