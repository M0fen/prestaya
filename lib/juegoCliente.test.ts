// Tests del juego del cliente derivado de los pagos reales. Fija en especial
// la racha: la cuota de HOY aún sin pagar NO rompe la racha previa.
import { describe, expect, it } from "vitest";
import { calcularJuegoCliente } from "./juegoCliente";

const HOY = new Date(2026, 5, 16); // 16 jun 2026 (local)
// Inicio miércoles 03-jun → con cobro Lun–Sáb hoy (16-jun) es el día 12 del
// crédito (se saltean los domingos 07 y 14).
const prestamo = { cuota_diaria: 300, total_dias: 25, fecha_inicio: "2026-06-03" };
const rango = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const pagosDe = (dias: number[], monto = 300) =>
  dias.map((d) => ({ dia_credito: d, monto }));

describe("calcularJuegoCliente", () => {
  it("hoy pendiente NO rompe la racha (al día días 1–11, hoy sin pagar)", () => {
    const j = calcularJuegoCliente(prestamo, pagosDe(rango(11)), HOY);
    expect(j.racha).toBe(11); // antes del fix daba 0
    expect(j.estadoRacha).toBe("al_dia");
    expect(j.nivel.nombre).toBe("Plata");
    expect(j.cuotasPagadas).toBe(11);
  });

  it("un día atrasado corta la racha pero guarda el récord (mejorRacha)", () => {
    // Días 1–10 pagos, día 11 atrasado, día 12 (hoy) sin pagar.
    const j = calcularJuegoCliente(prestamo, pagosDe(rango(10)), HOY);
    expect(j.racha).toBe(0);
    expect(j.mejorRacha).toBe(10);
    expect(j.estadoRacha).toBe("rota");
    expect(j.logros.find((l) => l.id === "racha10")?.desbloqueado).toBe(true);
  });

  it("crédito completo desbloquea el logro de mitad y marca completo", () => {
    const corto = { cuota_diaria: 300, total_dias: 3, fecha_inicio: "2026-06-12" };
    const j = calcularJuegoCliente(corto, pagosDe([1, 2, 3]), HOY);
    expect(j.completo).toBe(true);
    expect(j.logros.find((l) => l.id === "mitad")?.desbloqueado).toBe(true);
  });

  it("misiones: la meta de racha es configurable y refleja el progreso", () => {
    // Racha de 11 días; meta 10 → misión de racha completa.
    const j = calcularJuegoCliente(prestamo, pagosDe(rango(11)), HOY, { metaRacha: 10 });
    const racha = j.misiones.find((m) => m.id === "racha_meta");
    expect(racha?.titulo).toBe("Racha de 10");
    expect(racha?.completa).toBe(true);
    expect(racha?.progreso).toBe(1);

    // Con meta 20, la misma racha de 11 está a mitad de camino (0.55).
    const j2 = calcularJuegoCliente(prestamo, pagosDe(rango(11)), HOY, { metaRacha: 20 });
    const racha2 = j2.misiones.find((m) => m.id === "racha_meta");
    expect(racha2?.completa).toBe(false);
    expect(racha2?.progreso).toBeCloseTo(0.55, 5);

    // La misión "crédito al 100%" no está completa si falta.
    expect(j.misiones.find((m) => m.id === "completo")?.completa).toBe(false);
  });
});
