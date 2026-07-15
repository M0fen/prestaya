// Tests de las INVARIANTES de dinero (reconciliación diaria). Fijan qué cuenta
// como "la plata cuadra" y qué dispara un incidente.
import { describe, expect, it } from "vitest";
import {
  invPagadoAcum,
  invSobrecobro,
  invRecaudoDia,
  invHuerfanos,
  reconciliar,
  type CreditoRecon,
} from "./reconciliacion";

const credito = (over: Partial<CreditoRecon> = {}): CreditoRecon => ({
  id: "c1",
  estado: "activo",
  pagadoAcum: 5000,
  pagosSuma: 5000,
  totalAPagar: 30000,
  cuotaDiaria: 1000,
  ...over,
});

describe("invPagadoAcum — el denormalizado debe igualar el libro", () => {
  it("cuadra: sin hallazgos", () => {
    expect(invPagadoAcum([credito()])).toHaveLength(0);
  });
  it("drift de 1 (o más) → hallazgo crítico", () => {
    const h = invPagadoAcum([credito({ pagadoAcum: 5001, pagosSuma: 5000 })]);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("critico");
    expect(h[0].creditoId).toBe("c1");
  });
  it("drift negativo también se detecta", () => {
    expect(invPagadoAcum([credito({ pagadoAcum: 4000, pagosSuma: 5000 })])).toHaveLength(1);
  });
});

describe("invSobrecobro — nunca pagado > total", () => {
  it("pagado == total (crédito saldado) NO es sobre-cobro", () => {
    expect(invSobrecobro([credito({ pagosSuma: 30000, totalAPagar: 30000 })])).toHaveLength(0);
  });
  it("exceso < 1 cuota → MEDIO (redondeo del último pago, ruido de baseline)", () => {
    const h = invSobrecobro([credito({ pagosSuma: 30500, totalAPagar: 30000, cuotaDiaria: 1000 })]);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("medio"); // exceso 500 < cuota 1000
  });
  it("exceso ≥ 1 cuota → CRÍTICO (se cobró un día de más o pago mal imputado)", () => {
    const h = invSobrecobro([credito({ pagosSuma: 32000, totalAPagar: 30000, cuotaDiaria: 1000 })]);
    expect(h[0].severidad).toBe("critico"); // exceso 2000 ≥ cuota 1000
  });
});

describe("invRecaudoDia — las tres vistas del recaudo coinciden", () => {
  it("pagos == caja == dashboard → sin hallazgos", () => {
    expect(invRecaudoDia({ pagos: 100000, caja: 100000, dashboard: 100000 })).toHaveLength(0);
  });
  it("caja diverge del libro → hallazgo alto", () => {
    const h = invRecaudoDia({ pagos: 100000, caja: 98000, dashboard: 100000 });
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("alto");
    expect(h[0].detalle).toContain("caja");
  });
  it("fuentes nulas se ignoran (no todas las corridas traen caja/dashboard)", () => {
    expect(invRecaudoDia({ pagos: 100000, caja: null, dashboard: undefined })).toHaveLength(0);
  });
});

describe("invHuerfanos", () => {
  it("0 huérfanos → sin hallazgos", () => {
    expect(invHuerfanos(0)).toHaveLength(0);
  });
  it("N>0 huérfanos → hallazgo crítico", () => {
    expect(invHuerfanos(3)[0].severidad).toBe("critico");
  });
});

describe("reconciliar — resumen global", () => {
  it("todo cuadra → ok=true, peorSeveridad=null", () => {
    const r = reconciliar([credito(), credito({ id: "c2" })]);
    expect(r.ok).toBe(true);
    expect(r.peorSeveridad).toBeNull();
    expect(r.totalCreditos).toBe(2);
  });
  it("mezcla de hallazgos → ok=false, agrupa por invariante y reporta la peor severidad", () => {
    const r = reconciliar(
      [
        credito({ id: "c1", pagadoAcum: 5001, pagosSuma: 5000 }), // crítico
        credito({ id: "c2" }), // ok
      ],
      invRecaudoDia({ pagos: 100000, caja: 90000 }), // alto
    );
    expect(r.ok).toBe(false);
    expect(r.porInvariante["pagado_acum==Σpagos"]).toBe(1);
    expect(r.porInvariante["recaudo-consistente"]).toBe(1);
    expect(r.peorSeveridad).toBe("critico");
  });
});
