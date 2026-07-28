import { describe, it, expect } from "vitest";
import { estadoPublicacion } from "./publicacion";

const ahora = new Date("2026-07-27T12:00:00Z");
const ayer = "2026-07-26T12:00:00Z";
const manana = "2026-07-28T12:00:00Z";

describe("estadoPublicacion — la lista muestra lo que REALMENTE ve el cliente", () => {
  it("apagado → pausado (aunque las fechas estén vigentes)", () => {
    expect(estadoPublicacion({ activo: false, desde: ayer, hasta: manana }, ahora)).toBe("pausado");
  });

  it("activo sin ventana → en pantalla", () => {
    expect(estadoPublicacion({ activo: true }, ahora)).toBe("en_pantalla");
    expect(estadoPublicacion({ activo: true, desde: null, hasta: null }, ahora)).toBe("en_pantalla");
  });

  it("activo pero empieza mañana → programado", () => {
    expect(estadoPublicacion({ activo: true, desde: manana }, ahora)).toBe("programado");
  });

  it("activo pero venció ayer → vencido (el bug que se veía 'activo')", () => {
    expect(estadoPublicacion({ activo: true, hasta: ayer }, ahora)).toBe("vencido");
  });

  it("activo dentro de la ventana → en pantalla", () => {
    expect(estadoPublicacion({ activo: true, desde: ayer, hasta: manana }, ahora)).toBe("en_pantalla");
  });

  it("programado MANDA sobre vencido si aún no empezó (ventana futura completa)", () => {
    expect(estadoPublicacion({ activo: true, desde: manana, hasta: manana }, ahora)).toBe("programado");
  });

  it("fecha ilegible se ignora (no rompe ni marca vencido falso)", () => {
    expect(estadoPublicacion({ activo: true, desde: "no-es-fecha", hasta: "x" }, ahora)).toBe("en_pantalla");
  });
});
