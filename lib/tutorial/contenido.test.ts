import { describe, it, expect } from "vitest";
import { GUIAS, guiasPara, rolesVisiblesPara } from "./contenido";
import type { Rol } from "@/types/db";

const rolesDe = (rol: Rol) => new Set(guiasPara(rol).map((g) => g.rol));

describe("acceso al tutorial por rol", () => {
  it("el cobrador ve SOLO guías de cobrador", () => {
    expect([...rolesDe("cobrador")]).toEqual(["cobrador"]);
  });

  it("el supervisor ve cobrador + supervisor (no admin)", () => {
    const roles = rolesDe("supervisor");
    expect(roles.has("cobrador")).toBe(true);
    expect(roles.has("supervisor")).toBe(true);
    expect(roles.has("admin")).toBe(false);
  });

  it("el admin ve todas las guías de todos los roles", () => {
    const roles = rolesDe("admin");
    expect(roles.has("cobrador")).toBe(true);
    expect(roles.has("supervisor")).toBe(true);
    expect(roles.has("admin")).toBe(true);
    expect(guiasPara("admin").length).toBe(GUIAS.length);
  });

  it("el cobrador nunca ve contenido de mando (aislamiento)", () => {
    const ids = guiasPara("cobrador").map((g) => g.id);
    expect(ids.some((id) => id.startsWith("adm-") || id.startsWith("sup-"))).toBe(false);
  });

  it("rolesVisiblesPara respeta la jerarquía", () => {
    expect(rolesVisiblesPara("cobrador")).toEqual(["cobrador"]);
    expect(rolesVisiblesPara("supervisor")).toEqual(["cobrador", "supervisor"]);
    expect(rolesVisiblesPara("admin")).toEqual(["cobrador", "supervisor", "admin"]);
  });
});

describe("integridad del contenido", () => {
  it("toda guía tiene id único, título, resumen y al menos un paso", () => {
    const ids = new Set<string>();
    for (const g of GUIAS) {
      expect(g.titulo.length).toBeGreaterThan(0);
      expect(g.resumen.length).toBeGreaterThan(0);
      expect(g.pasos.length).toBeGreaterThan(0);
      expect(ids.has(g.id)).toBe(false);
      ids.add(g.id);
      for (const p of g.pasos) {
        expect(p.titulo.length).toBeGreaterThan(0);
        expect(p.cuerpo.length).toBeGreaterThan(0);
      }
    }
  });
});
