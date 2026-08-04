// ─────────────────────────────────────────────────────────────────────────
//  El estado del alta decide qué ve el cobrador como TRABAJO PENDIENTE.
//  Si "no usa la app" no ganara, los 55 clientes con teléfono fijo de Zona
//  Centro seguirían apareciendo como pendientes para siempre y el avance
//  nunca podría llegar al 100%.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { estadoAlta } from "./acceso";

const base = { acceso_visto_en: null, acceso_entregado_en: null, app_no_aplica_en: null };

describe("estadoAlta", () => {
  it("sin nada, está pendiente", () => {
    expect(estadoAlta(base)).toBe("pendiente");
  });

  it("entregado pero sin abrir → entregado", () => {
    expect(estadoAlta({ ...base, acceso_entregado_en: "2026-08-05T10:00:00Z" })).toBe("entregado");
  });

  it("el cliente lo abrió → activo (la prueba real del alta)", () => {
    expect(
      estadoAlta({ ...base, acceso_entregado_en: "2026-08-05T10:00:00Z", acceso_visto_en: "2026-08-05T11:00:00Z" }),
    ).toBe("activo");
  });

  it("'no usa la app' GANA sobre pendiente", () => {
    expect(estadoAlta({ ...base, app_no_aplica_en: "2026-08-05T10:00:00Z" })).toBe("no_aplica");
  });

  it("'no usa la app' gana incluso si alguna vez se le entregó", () => {
    expect(
      estadoAlta({
        acceso_entregado_en: "2026-08-01T10:00:00Z",
        acceso_visto_en: null,
        app_no_aplica_en: "2026-08-05T10:00:00Z",
      }),
    ).toBe("no_aplica");
  });

  it("es REVERSIBLE: al limpiar la marca vuelve al estado que tenía", () => {
    expect(estadoAlta({ ...base, acceso_entregado_en: "2026-08-01T10:00:00Z", app_no_aplica_en: null })).toBe(
      "entregado",
    );
  });

  it("un cliente que YA usa la app y se marca por error sigue contando como no_aplica (es lo que dijo el cobrador)", () => {
    // Decisión explícita: la marca es una declaración humana y gana. Se
    // deshace de un toque desde la misma pantalla.
    expect(
      estadoAlta({
        acceso_entregado_en: "2026-08-01T10:00:00Z",
        acceso_visto_en: "2026-08-02T10:00:00Z",
        app_no_aplica_en: "2026-08-05T10:00:00Z",
      }),
    ).toBe("no_aplica");
  });

  it("tolera que 0131 no haya corrido (campo ausente)", () => {
    expect(estadoAlta({ acceso_visto_en: null, acceso_entregado_en: null })).toBe("pendiente");
  });
});
