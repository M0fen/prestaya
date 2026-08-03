// Tests de las invariantes NUEVAS de reconciliación (07-29): estrellas fantasma,
// base de caja consistente, lead→crédito de tienda. Codifican como "monitoreo"
// las zonas dinero-adyacentes que se agregaron esta sesión.
import { describe, expect, it } from "vitest";
import {
  invEstrellasFantasma,
  invBaseCaja,
  invLeadConvertido,
  type EstrellasRecon,
  type BaseCajaRecon,
  type LeadRecon,
  invRutaCredito,
  type RutaRecon,
} from "./reconciliacion";

describe("invEstrellasFantasma", () => {
  it("no marca nada cuando redimidas ≤ ganadas", () => {
    const rows: EstrellasRecon[] = [
      { clienteId: "a", estrellasGanadas: 5, estrellasRedimidas: 5 },
      { clienteId: "b", estrellasGanadas: 3, estrellasRedimidas: 0 },
    ];
    expect(invEstrellasFantasma(rows)).toHaveLength(0);
  });

  it("marca crítico cuando alguien redimió más de lo que ganó", () => {
    const h = invEstrellasFantasma([{ clienteId: "x", estrellasGanadas: 2, estrellasRedimidas: 3 }]);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("critico");
    expect(h[0].creditoId).toBe("x");
    expect(h[0].invariante).toBe("estrellas-no-fantasma");
  });
});

describe("invBaseCaja", () => {
  it("ignora al cobrador que aún no rindió (baseRendicion null)", () => {
    const rows: BaseCajaRecon[] = [{ cobradorId: "c1", fecha: "2026-07-29", baseApertura: 1000, baseRendicion: null }];
    expect(invBaseCaja(rows)).toHaveLength(0);
  });

  it("no marca si la base de apertura coincide con la del cierre", () => {
    const rows: BaseCajaRecon[] = [{ cobradorId: "c1", fecha: "2026-07-29", baseApertura: 1000, baseRendicion: 1000 }];
    expect(invBaseCaja(rows)).toHaveLength(0);
  });

  it("marca alto si la base se cambió entre apertura y cierre (posible faltante enmascarado)", () => {
    const rows: BaseCajaRecon[] = [{ cobradorId: "c1", fecha: "2026-07-29", baseApertura: 1000, baseRendicion: 500 }];
    const h = invBaseCaja(rows);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("alto");
    expect(h[0].invariante).toBe("base-caja-consistente");
  });
});

describe("invLeadConvertido", () => {
  it("no marca leads abiertos ni conversiones sanas a crédito de tienda", () => {
    const rows: LeadRecon[] = [
      { leadId: "l1", estado: "nueva", prestamoId: null, prestamoExiste: false, prestamoOrigen: null },
      { leadId: "l2", estado: "convertida", prestamoId: "p2", prestamoExiste: true, prestamoOrigen: "tienda" },
    ];
    expect(invLeadConvertido(rows)).toHaveLength(0);
  });

  it("marca crítico un lead convertido SIN crédito válido", () => {
    const rows: LeadRecon[] = [
      { leadId: "l3", estado: "convertida", prestamoId: null, prestamoExiste: false, prestamoOrigen: null },
      { leadId: "l4", estado: "convertida", prestamoId: "p4", prestamoExiste: false, prestamoOrigen: null },
    ];
    const h = invLeadConvertido(rows);
    expect(h).toHaveLength(2);
    expect(h.every((x) => x.severidad === "critico")).toBe(true);
  });

  it("marca alto un lead que apunta a un crédito que NO es de tienda", () => {
    const rows: LeadRecon[] = [
      { leadId: "l5", estado: "convertida", prestamoId: "p5", prestamoExiste: true, prestamoOrigen: "credito" },
    ];
    const h = invLeadConvertido(rows);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("alto");
  });
});

// ── INV10 — crédito activo sin ruta / comisión desalineada ──────────────────
// Es la invariante que le faltaba al vigilante: el "cliente fantasma" (crédito
// activo que no está en la ruta de nadie) sólo se descubrió en una auditoría
// manual, con 46 créditos y $634.666 dando vueltas sin dueño.
describe("invRutaCredito (INV10)", () => {
  const ok: RutaRecon = {
    creditoId: "c1", saldo: 5000, tieneRuta: true, clienteActivo: true,
    duenoCredito: "cob-A", cobradoresEnRuta: ["cob-A"],
  };

  it("no dice nada cuando la ruta y el dueño coinciden", () => {
    expect(invRutaCredito([ok])).toHaveLength(0);
  });

  it("marca CRÍTICO el crédito activo sin ninguna asignación (fantasma)", () => {
    const h = invRutaCredito([{ ...ok, tieneRuta: false, cobradoresEnRuta: [] }]);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("critico");
    expect(h[0].invariante).toBe("credito-sin-ruta");
    expect(h[0].creditoId).toBe("c1");
    expect(h[0].detalle).toContain("5000"); // el saldo en la calle, para dimensionar
  });

  it("trata la lista vacía de cobradores como fantasma aunque tieneRuta mienta", () => {
    const h = invRutaCredito([{ ...ok, tieneRuta: true, cobradoresEnRuta: [] }]);
    expect(h).toHaveLength(1);
    expect(h[0].invariante).toBe("credito-sin-ruta");
  });

  it("marca ALTO cuando la comisión va a alguien que no lo cobra", () => {
    const h = invRutaCredito([{ ...ok, duenoCredito: "cob-B", cobradoresEnRuta: ["cob-A"] }]);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("alto");
    expect(h[0].invariante).toBe("comision-desalineada");
  });

  it("acepta multi-cobrador (0038) si el dueño es UNO de los de la ruta", () => {
    const h = invRutaCredito([{ ...ok, duenoCredito: "cob-B", cobradoresEnRuta: ["cob-A", "cob-B"] }]);
    expect(h).toHaveLength(0);
  });

  it("no acusa desalineación si el crédito no tiene dueño (sólo cuenta la ruta)", () => {
    const h = invRutaCredito([{ ...ok, duenoCredito: null }]);
    expect(h).toHaveLength(0);
  });

  it("un fantasma no genera además una desalineación (un hallazgo por crédito)", () => {
    const h = invRutaCredito([
      { creditoId: "c9", saldo: 100, tieneRuta: false, clienteActivo: true, duenoCredito: "cob-Z", cobradoresEnRuta: [] },
    ]);
    expect(h).toHaveLength(1);
  });
});

describe("invRutaCredito — cliente archivado con crédito vivo", () => {
  const base: RutaRecon = {
    creditoId: "c2", saldo: 8000, tieneRuta: true, clienteActivo: true,
    duenoCredito: "cob-A", cobradoresEnRuta: ["cob-A"],
  };

  it("marca CRÍTICO el crédito activo de un cliente archivado", () => {
    // Sale de la ruta del cobrador (que filtra activo=true) pero su saldo sigue
    // contando en la cartera del admin: deuda que nadie va a ir a cobrar.
    const h = invRutaCredito([{ ...base, clienteActivo: false }]);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("critico");
    expect(h[0].invariante).toBe("credito-de-cliente-archivado");
  });

  it("el archivado tapa al resto: un solo hallazgo, el que importa", () => {
    const h = invRutaCredito([
      { ...base, clienteActivo: false, tieneRuta: false, cobradoresEnRuta: [] },
    ]);
    expect(h).toHaveLength(1);
    expect(h[0].invariante).toBe("credito-de-cliente-archivado");
  });
});
