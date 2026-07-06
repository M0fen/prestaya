// Tests del núcleo PURO de estrellas (dinero-adyacente). Cubren las reglas de
// negocio exactas + el caso crítico: un pago ANULADO no deja estrella fantasma.
import { describe, it, expect } from "vitest";
import {
  calcularEstrellas,
  validarRedencion,
  claveCiclo,
  FRAGMENTOS_POR_ESTRELLA,
  TOPE_REDENCION_CICLO,
  type RedencionMin,
} from "./estrellas";

const CICLO = "2026-07";
const base = (pagosVigentes: number, redenciones: RedencionMin[] = []) =>
  calcularEstrellas({ pagosVigentes, redenciones, cicloActual: CICLO });

describe("estrellas — acumulación", () => {
  it("1 pago = 1 fragmento", () => {
    const s = base(1);
    expect(s.fragmentos).toBe(1);
    expect(s.estrellasGanadas).toBe(0);
    expect(s.progresoFragmento).toBe(1);
    expect(s.faltanParaEstrella).toBe(4);
  });

  it("5 fragmentos = 1 estrella completa", () => {
    const s = base(5);
    expect(s.estrellasGanadas).toBe(1);
    expect(s.progresoFragmento).toBe(0);
    expect(s.disponibles).toBe(1);
  });

  it("se acumulan SIN tope (53 pagos → 10 estrellas + 3 fragmentos)", () => {
    const s = base(53);
    expect(s.estrellasGanadas).toBe(10);
    expect(s.progresoFragmento).toBe(3);
    expect(s.disponibles).toBe(10);
  });

  it("constantes de negocio correctas", () => {
    expect(FRAGMENTOS_POR_ESTRELLA).toBe(5);
    expect(TOPE_REDENCION_CICLO).toBe(5);
  });
});

describe("estrellas — pago anulado NO deja fragmento fantasma", () => {
  it("si baja la cantidad de pagos vigentes (anulación), baja el saldo", () => {
    // 10 pagos → 2 estrellas.
    expect(base(10).estrellasGanadas).toBe(2);
    // Se anula uno → 9 pagos vigentes → 1 estrella (el fragmento desaparece solo).
    expect(base(9).estrellasGanadas).toBe(1);
  });
});

describe("estrellas — redención y reservas", () => {
  it("una redención APROBADA descuenta del saldo", () => {
    const s = base(20, [{ estrellas: 2, estado: "aprobada", ciclo: "2026-05" }]);
    expect(s.estrellasGanadas).toBe(4);
    expect(s.estrellasRedimidas).toBe(2);
    expect(s.disponibles).toBe(2);
  });

  it("una redención PENDIENTE reserva el saldo (no se puede re-pedir)", () => {
    const s = base(20, [{ estrellas: 3, estado: "pendiente", ciclo: CICLO }]);
    expect(s.estrellasPendientes).toBe(3);
    expect(s.disponibles).toBe(1); // 4 ganadas − 3 reservadas
  });

  it("una redención RECHAZADA no consume saldo ni cupo", () => {
    const s = base(20, [{ estrellas: 5, estado: "rechazada", ciclo: CICLO }]);
    expect(s.disponibles).toBe(4);
    expect(s.redimiblesCiclo).toBe(4);
  });
});

describe("estrellas — tope de 5 por ciclo (mes)", () => {
  it("con saldo de sobra, el tope del ciclo limita a 5", () => {
    const s = base(50); // 10 estrellas disponibles
    expect(s.disponibles).toBe(10);
    expect(s.redimiblesCiclo).toBe(5); // tope mensual
  });

  it("lo ya usado en el ciclo descuenta del cupo", () => {
    // 10 disponibles, ya 3 aprobadas este mes → puede pedir 2 más.
    const s = base(50, [{ estrellas: 3, estado: "aprobada", ciclo: CICLO }]);
    expect(s.redimiblesCiclo).toBe(2);
  });

  it("redenciones de OTRO ciclo no tocan el cupo de este mes", () => {
    const s = base(50, [{ estrellas: 5, estado: "aprobada", ciclo: "2026-06" }]);
    expect(s.redimiblesCiclo).toBe(5); // el mes pasado no limita este mes
  });
});

describe("claveCiclo (ciclo definible por el admin)", () => {
  it("modo mes → usa el mes calendario", () => {
    expect(claveCiclo("mes", { cicloMes: "2026-07", prestamoId: "p1" })).toBe("2026-07");
  });
  it("modo credito → usa el préstamo (se reinicia con cada crédito)", () => {
    expect(claveCiclo("credito", { cicloMes: "2026-07", prestamoId: "p1" })).toBe("cred:p1");
  });
  it("modo credito sin préstamo → cae al mes", () => {
    expect(claveCiclo("credito", { cicloMes: "2026-07", prestamoId: null })).toBe("2026-07");
  });
});

describe("validarRedencion", () => {
  const saldo = base(50); // 10 disp, redimibles 5 este ciclo
  it("acepta una cantidad válida", () => {
    expect(validarRedencion(saldo, 3)).toEqual({ ok: true });
  });
  it("rechaza 0 o negativo", () => {
    expect(validarRedencion(saldo, 0).ok).toBe(false);
  });
  it("rechaza más que el tope por ciclo", () => {
    expect(validarRedencion(saldo, 6).ok).toBe(false);
  });
  it("rechaza más que lo disponible", () => {
    const poco = base(6); // 1 estrella
    expect(validarRedencion(poco, 2).ok).toBe(false);
  });
});
