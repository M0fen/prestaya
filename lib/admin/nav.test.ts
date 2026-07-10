import { describe, it, expect } from "vitest";
import { NAV_ITEMS, NAV_GRUPOS, navVisible, navAgrupado } from "./nav";

describe("nav — visibilidad por rol", () => {
  it("el supervisor NO ve ítems solo-admin (Ventas Crédito, Valor, Comisiones)", () => {
    const hrefs = new Set(navVisible("supervisor").map((i) => i.href));
    expect(hrefs.has("/admin/informe-cartera")).toBe(false);
    expect(hrefs.has("/admin/valor")).toBe(false);
    expect(hrefs.has("/admin/comisiones")).toBe(false);
    // pero sí ve lo compartido
    expect(hrefs.has("/admin/mora")).toBe(true);
    expect(hrefs.has("/admin/cobranza")).toBe(true);
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

  it("agrupado(admin) cubre exactamente los mismos ítems que navVisible (sin perder ni duplicar)", () => {
    const { suelto, grupos } = navAgrupado("admin", true);
    const agrupados = [...suelto, ...grupos.flatMap((g) => g.items)].map((i) => i.href).sort();
    const visibles = navVisible("admin", true).map((i) => i.href).sort();
    expect(agrupados).toEqual(visibles);
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
    expect(hrefs.has("/admin/equipo")).toBe(false); // solo admin
    expect(hrefs.has("/admin/tutorial")).toBe(true); // compartido
  });
});
