// Test del prompt del asesor + el volcado del resumen a texto. Puro (sin red).
import { describe, it, expect } from "vitest";
import { construirSystemPrompt, herramientasPara } from "./prompt";
import { resumenComoTexto, type ResumenFinanciero } from "@/lib/data/asesor";

const RESUMEN: ResumenFinanciero = {
  fecha: "2026-07-02T12:00:00Z",
  cartera: {
    capitalColocado: 500000,
    conIntereses: 650000,
    recaudadoAcumulado: 110000,
    carteraPorCobrar: 390000,
    porCobrarHoy: 1000,
    creditosActivos: 1,
    clientesActivos: 1,
    deudoresActivos: 1,
    creditosFinalizados: 0,
    incobrables: 0,
  },
  recaudacion: { hoy: 0, mes: 12000 },
  reportesNuevos: 0,
  mora: {
    monto: 320000,
    morosos: 1,
    moraPct: 0.82,
    tramos: [
      { tramo: "1–7 días", creditos: 0, monto: 0 },
      { tramo: "8–15 días", creditos: 0, monto: 0 },
      { tramo: "16+ días", creditos: 1, monto: 320000 },
    ],
    criticos: 1,
    vencidosCreditos: 0,
    carteraVencida: 0,
    topRiesgo: [
      {
        nombre: "María Fernanda",
        riesgo: 90,
        nivel: "critico",
        deudaVencida: 320000,
        diasSinPagar: 11,
        cobrador: "Diego",
      },
    ],
  },
  cobradores: {
    ranking: [
      { nombre: "Diego", recaudado: 0, esperado: 20000, progresoPct: 0, anomalias: 0 },
    ],
    alertas: [],
  },
};

describe("resumenComoTexto", () => {
  it("incluye los números clave del negocio", () => {
    const t = resumenComoTexto(RESUMEN);
    expect(t).toContain("Capital colocado");
    expect(t).toContain("$500.000");
    expect(t).toContain("82%"); // mora
    expect(t).toContain("María Fernanda");
    expect(t).toContain("Diego");
  });
});

describe("construirSystemPrompt", () => {
  it("define el rol e inyecta el resumen", () => {
    const sp = construirSystemPrompt(resumenComoTexto(RESUMEN));
    expect(sp).toContain("Presta Ya");
    expect(sp).toContain("FOTO DE LA OPERACIÓN");
    expect(sp).toContain("$500.000");
    // Reglas clave presentes.
    expect(sp.toLowerCase()).toContain("no inventes");
  });

  it("adapta el prompt según el rol de quien consulta", () => {
    expect(construirSystemPrompt("x", "admin")).toContain("DUEÑO");
    expect(construirSystemPrompt("x", "supervisor")).toContain("SUPERVISOR");
  });
});

describe("herramientasPara (filtrado de contexto por rol)", () => {
  it("el admin ve todas; el supervisor no ve las de dueño (caja global)", () => {
    const admin = herramientasPara("admin").map((h) => h.function.name);
    const sup = herramientasPara("supervisor").map((h) => h.function.name);
    expect(admin).toContain("proyeccion_caja");
    expect(admin).toContain("tendencia_recaudo");
    expect(admin).toContain("rentabilidad");
    // El supervisor NO ve proyección de caja, tendencia GLOBAL ni rentabilidad (dueño).
    expect(sup).not.toContain("proyeccion_caja");
    expect(sup).not.toContain("tendencia_recaudo");
    expect(sup).not.toContain("rentabilidad");
    expect(sup).toHaveLength(admin.length - 3);
    // La operación de SU zona SÍ la ve el supervisor.
    expect(sup).toContain("tablero_mora");
    expect(sup).toContain("ranking_cobradores");
    expect(sup).toContain("buscar_cliente");
    expect(sup).toContain("ruta_cobrador");
  });
});
