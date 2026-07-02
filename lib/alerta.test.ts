// Test del núcleo de ALERTA de mora. Fija el comportamiento con escenarios de
// cartón calculados a mano: al día, crítico (racha + sin pagar), medio, y
// crédito nuevo (datos insuficientes → no alarma).
import { describe, expect, it } from "vitest";
import { calcularAlertaMora, type EntradaAlerta } from "./alerta";

const HOY = new Date(2026, 5, 16); // 16 jun 2026 (local)

type PagoMin = { dia_credito: number; monto: number };
const pagosDias = (dias: number[], monto = 1000): PagoMin[] =>
  dias.map((d) => ({ dia_credito: d, monto }));
const rango = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function correr(
  fechaInicio: string,
  pagos: PagoMin[],
  over: Partial<EntradaAlerta["prestamo"]> = {},
) {
  return calcularAlertaMora({
    prestamo: { cuota_diaria: 1000, total_dias: 30, fecha_inicio: fechaInicio, ...over },
    pagos,
    hoy: HOY,
  });
}

describe("calcularAlertaMora", () => {
  it("al día: hoy es el día 10 y pagó los 10 → sano, riesgo 0", () => {
    const r = correr("2026-06-07", pagosDias(rango(10)));
    expect(r.datosSuficientes).toBe(true);
    expect(r.nivel).toBe("sano");
    expect(r.riesgo).toBe(0);
    expect(r.senales.rachaAtraso).toBe(0);
    expect(r.senales.diasSinPagar).toBe(0);
  });

  it("crítico: pagó los primeros 5 y se cortó hace 11 días → visitar hoy", () => {
    // Inicio jun-01 → hoy es el día 16. Pagó 1..5; 6..15 vencidos; 16 es hoy.
    const r = correr("2026-06-01", pagosDias(rango(5)));
    expect(r.senales.rachaAtraso).toBe(10);
    expect(r.senales.atrasosTotales).toBe(10);
    expect(r.senales.diasSinPagar).toBe(11);
    expect(r.riesgo).toBeGreaterThanOrEqual(70);
    expect(r.nivel).toBe("critico");
    expect(r.tendencia).toBe("empeorando");
    const claves = r.motivos.map((m) => m.clave);
    expect(claves).toContain("racha");
    expect(claves).toContain("recencia");
  });

  it("medio: 2 días seguidos sin cubrir tras venir al día → vigilar", () => {
    // Inicio jun-08 → hoy es el día 9. Pagó 1..6; 7 y 8 vencidos; 9 es hoy.
    const r = correr("2026-06-08", pagosDias(rango(6)));
    expect(r.senales.rachaAtraso).toBe(2);
    expect(r.nivel).toBe("medio");
    expect(r.riesgo).toBeGreaterThanOrEqual(20);
    expect(r.riesgo).toBeLessThan(45);
  });

  it("crédito nuevo: solo 2 días exigibles → datos insuficientes, no alarma", () => {
    // Inicio jun-15 → hoy es el día 2. Aún no hay base para juzgar.
    const r = correr("2026-06-15", []);
    expect(r.datosSuficientes).toBe(false);
    expect(r.nivel).toBe("sano");
  });

  it("hoy sin pagar todavía NO cuenta como atraso (no rompe la racha buena)", () => {
    // Inicio jun-07 → hoy día 10. Pagó 1..9; hoy (10) aún no pagó.
    const r = correr("2026-06-07", pagosDias(rango(9)));
    expect(r.senales.atrasosTotales).toBe(0);
    expect(r.senales.rachaAtraso).toBe(0);
    expect(r.nivel).toBe("sano");
  });
});
