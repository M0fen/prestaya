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
