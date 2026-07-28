import { describe, it, expect } from "vitest";
import { NAV_ITEMS, NAV_GRUPOS, navVisible, navAgrupado, ordenSuelto } from "./nav";

describe("nav — visibilidad por rol", () => {
  it("el supervisor NO ve ítems solo-admin (Ventas Crédito, Valor)", () => {
    const hrefs = new Set(navVisible("supervisor").map((i) => i.href));
    expect(hrefs.has("/admin/informe-cartera")).toBe(false);
    expect(hrefs.has("/admin/valor")).toBe(false);
    // pero sí ve lo compartido — incluido Comisiones (solo lectura: no fija ni liquida)
    expect(hrefs.has("/admin/comisiones")).toBe(true);
    expect(hrefs.has("/admin/mora")).toBe(true);
    expect(hrefs.has("/admin/cobranza")).toBe(true);
  });

  it("Desempeño (historial por rango) lo ven admin y supervisor", () => {
    expect(navVisible("admin").some((i) => i.href === "/admin/desempeno")).toBe(true);
    expect(navVisible("supervisor").some((i) => i.href === "/admin/desempeno")).toBe(true);
    expect(navVisible("cobrador").some((i) => i.href === "/admin/desempeno")).toBe(false);
  });

  it("el ítem Dev solo aparece para desarrolladores", () => {
    expect(navVisible("admin", false).some((i) => i.href === "/admin/dev")).toBe(false);
    expect(navVisible("admin", true).some((i) => i.href === "/admin/dev")).toBe(true);
  });
});

describe("nav — agrupación del sidebar", () => {
  it("Dashboard y Mi jornada quedan sueltos (destacados) arriba, Dashboard primero", () => {
    const { suelto } = navAgrupado("admin", true);
    expect(suelto[0].href).toBe("/admin");
    expect(suelto.map((i) => i.href)).toEqual(["/admin", "/admin/jornada"]);
  });

  it("los grupos respetan el orden de NAV_GRUPOS y no vienen vacíos", () => {
    const { grupos } = navAgrupado("admin", true);
    const nombres = grupos.map((g) => g.grupo);
    // subsecuencia del orden canónico
    const idx = nombres.map((n) => NAV_GRUPOS.indexOf(n));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    for (const g of grupos) expect(g.items.length).toBeGreaterThan(0);
  });

  it("agrupado(admin) cubre navVisible EXCEPTO los ítems `oculto` (que solo van al buscador)", () => {
    const { suelto, grupos } = navAgrupado("admin", true);
    const agrupados = [...suelto, ...grupos.flatMap((g) => g.items)].map((i) => i.href).sort();
    // navVisible incluye los ocultos (para el Cmd+K); navAgrupado los excluye.
    const visiblesSinOcultos = navVisible("admin", true)
      .filter((i) => !i.oculto)
      .map((i) => i.href)
      .sort();
    expect(agrupados).toEqual(visiblesSinOcultos);
  });

  it("los ítems `oculto` (p. ej. Zona de juego) NO están en el menú pero SÍ en el buscador", () => {
    const { grupos } = navAgrupado("admin", true);
    const enMenu = new Set(grupos.flatMap((g) => g.items).map((i) => i.href));
    const enBuscador = new Set(navVisible("admin", true).map((i) => i.href));
    expect(enMenu.has("/admin/juego")).toBe(false); // fuera del menú
    expect(enBuscador.has("/admin/juego")).toBe(true); // pero encontrable en Cmd+K
    expect(enMenu.has("/admin/para-clientes")).toBe(true); // el hub sí está en el menú
  });

  it("todo ítem (salvo los sueltos destacados) declara un grupo válido", () => {
    const sueltos = new Set(["/admin", "/admin/jornada"]);
    for (const i of NAV_ITEMS) {
      if (sueltos.has(i.href)) continue;
      expect(i.grupo, `${i.href} sin grupo`).toBeTruthy();
      expect(NAV_GRUPOS).toContain(i.grupo);
    }
  });

  it("para el supervisor, la Configuración no incluye ítems solo-admin", () => {
    const { grupos } = navAgrupado("supervisor");
    const config = grupos.find((g) => g.grupo === "Configuración");
    const hrefs = new Set(config?.items.map((i) => i.href) ?? []);
    expect(hrefs.has("/admin/zonas")).toBe(false); // solo admin
    expect(hrefs.has("/admin/tutorial")).toBe(true); // compartido
  });

  it("el supervisor SÍ ve Equipo (para restablecer el acceso de sus cobradores)", () => {
    // La lista viene acotada por RLS (0060): ve a sus cobradores + gestores; el
    // alta de usuarios queda solo para el admin (guard en la página + server).
    const { grupos } = navAgrupado("supervisor");
    const config = grupos.find((g) => g.grupo === "Configuración");
    const hrefs = new Set(config?.items.map((i) => i.href) ?? []);
    expect(hrefs.has("/admin/equipo")).toBe(true);
  });
});

describe("nav — arranque por rol (cada uno en su pantalla)", () => {
  it("el supervisor NO ve el Resumen del negocio (/admin): arranca en Mi jornada", () => {
    const { suelto } = navAgrupado("supervisor");
    const hrefs = suelto.map((i) => i.href);
    expect(hrefs).not.toContain("/admin");
    expect(hrefs[0]).toBe("/admin/jornada");
  });

  it("el admin sí gobierna desde el Resumen del negocio, que va primero", () => {
    const { suelto } = navAgrupado("admin");
    expect(suelto.map((i) => i.href)).toEqual(["/admin", "/admin/jornada"]);
  });

  it("ordenSuelto pone Mi jornada primero para el supervisor y el Dashboard primero para el admin", () => {
    expect(ordenSuelto("supervisor")[0]).toBe("/admin/jornada");
    expect(ordenSuelto("admin")[0]).toBe("/admin");
  });
});
