// Tests de las INVARIANTES de dinero (reconciliación diaria). Fijan qué cuenta
// como "la plata cuadra" y qué dispara un incidente.
import { describe, expect, it } from "vitest";
import {
  invPagadoAcum,
  invSobrecobro,
  invRecaudoDia,
  invHuerfanos,
  invRendicionVsLibro,
  invGastosRendicion,
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
  it("borde: exceso EXACTAMENTE = una cuota → material (≥, no >)", () => {
    // exceso 1000 == cuota 1000 → debe ser MATERIAL (crítico). Fija el `>=`.
    const h = invSobrecobro([credito({ pagosSuma: 31000, totalAPagar: 30000, cuotaDiaria: 1000 })]);
    expect(h[0].severidad).toBe("critico");
  });
  it("rama del 5%: exceso < cuota pero ≥ 5% del total → material (crédito de pocas cuotas grandes)", () => {
    // total 100000, cuota 50000 (2 cuotas). exceso 6000: < cuota 50000 PERO ≥ 5% (5000).
    // Sin la 2ª rama del OR quedaría 'medio'; debe ser 'critico'.
    const h = invSobrecobro([credito({ pagosSuma: 106000, totalAPagar: 100000, cuotaDiaria: 50000 })]);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("critico");
  });
  it("rama del 5% al borde: exceso == 5% exacto → material", () => {
    const h = invSobrecobro([credito({ pagosSuma: 105000, totalAPagar: 100000, cuotaDiaria: 50000 })]);
    expect(h[0].severidad).toBe("critico"); // exceso 5000 == 5% de 100000
  });
  it("cuotaDiaria = 0 (dato roto): igual detecta material por la rama del 5%", () => {
    // Sin cuota válida, la 1ª rama (cuotaDiaria>0) no aplica; la 2ª (5%) sí.
    const h = invSobrecobro([credito({ pagosSuma: 110000, totalAPagar: 100000, cuotaDiaria: 0 })]);
    expect(h[0].severidad).toBe("critico");
  });
  it("exceso EXACTAMENTE 1 (tolerancia de drift) → se reporta (medio)", () => {
    const h = invSobrecobro([credito({ pagosSuma: 30001, totalAPagar: 30000, cuotaDiaria: 1000 })]);
    expect(h).toHaveLength(1);
    expect(h[0].severidad).toBe("medio");
  });
  it("el detalle dice MATERIAL vs redondeo según el caso", () => {
    const mat = invSobrecobro([credito({ pagosSuma: 32000, totalAPagar: 30000, cuotaDiaria: 1000 })]);
    expect(mat[0].detalle).toContain("MATERIAL");
    expect(mat[0].detalle).toContain("exceso 2000");
    const red = invSobrecobro([credito({ pagosSuma: 30500, totalAPagar: 30000, cuotaDiaria: 1000 })]);
    expect(red[0].detalle).toContain("redondeo");
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
  it("N>0 huérfanos → hallazgo crítico con el conteo en el detalle", () => {
    const h = invHuerfanos(3);
    expect(h[0].severidad).toBe("critico");
    expect(h[0].invariante).toBe("sin-huerfanos");
    expect(h[0].detalle).toContain("3");
  });
  it("cantidad negativa (no debería pasar) → sin hallazgos", () => {
    expect(invHuerfanos(-1)).toHaveLength(0);
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
  it("la peor severidad gana AUNQUE aparezca DESPUÉS de una menor (fija el orden de ORDEN_SEV)", () => {
    // Primero un sobre-cobro MEDIO, después un huérfano CRÍTICO (extra, va al final).
    // Si ORDEN_SEV no ordenara bien, quedaría 'medio' (el primero) → este test lo mata.
    const r = reconciliar(
      [credito({ id: "c1", pagosSuma: 30500, totalAPagar: 30000, cuotaDiaria: 1000 })], // medio
      invHuerfanos(2), // crítico, agregado DESPUÉS
    );
    expect(r.peorSeveridad).toBe("critico");
  });
  it("solo hallazgos ALTOS → peorSeveridad='alto' (no salta a crítico ni baja a medio)", () => {
    const r = reconciliar([credito()], invRecaudoDia({ pagos: 100000, caja: 90000 }));
    expect(r.peorSeveridad).toBe("alto");
  });
});

// ── INV8: la rendición de un día YA CERRADO vs el libro ─────────────────────
// Es el detector del efectivo que se movía DESPUÉS del cierre y se volvía
// invisible a medianoche (cobro post-rendición, anulación posterior, no-rendición).
describe("invRendicionVsLibro — re-mira el día ya cerrado", () => {
  const base = { cobradorId: "cob-1", fecha: "2026-08-01" };

  it("rendición == libro → sin hallazgos (el día cuadra)", () => {
    expect(invRendicionVsLibro([{ ...base, recaudadoRendicion: 38000, pagosSuma: 38000 }])).toEqual([]);
  });

  it("cobró DESPUÉS de rendir → alto (efectivo sin sello de entrega)", () => {
    const r = invRendicionVsLibro([{ ...base, recaudadoRendicion: 38000, pagosSuma: 44000 }]);
    expect(r).toHaveLength(1);
    expect(r[0].severidad).toBe("alto");
    expect(r[0].invariante).toBe("rendicion==libro");
    expect(r[0].detalle).toMatch(/DESPUÉS de rendir/);
  });

  it("se ANULÓ un pago tras rendir → alto (histórico descuadrado)", () => {
    const r = invRendicionVsLibro([{ ...base, recaudadoRendicion: 38000, pagosSuma: 37000 }]);
    expect(r).toHaveLength(1);
    expect(r[0].detalle).toMatch(/se anuló un pago/);
  });

  it("recaudó y NO rindió → alto (la plata quedó en la calle)", () => {
    const r = invRendicionVsLibro([{ ...base, recaudadoRendicion: null, pagosSuma: 50000 }]);
    expect(r).toHaveLength(1);
    expect(r[0].invariante).toBe("rendicion-existe");
    expect(r[0].detalle).toMatch(/50000/);
  });

  it("no rindió porque NO recaudó (día libre) → sin hallazgos (no acusa al honesto)", () => {
    expect(invRendicionVsLibro([{ ...base, recaudadoRendicion: null, pagosSuma: 0 }])).toEqual([]);
  });
});

// ── INV9: gastos de la rendición respaldados por APROBADOS (D+1) ────────────
describe("invGastosRendicion — el gasto declarado tenía respaldo real", () => {
  const base = { cobradorId: "cob-1", fecha: "2026-08-01" };

  it("gastos == aprobados → sin hallazgos", () => {
    expect(invGastosRendicion([{ ...base, gastosRendicion: 4000, gastosAprobados: 4000, gastosPendientes: 0 }])).toEqual([]);
  });

  it("gasto RECHAZADO tras el cierre → alto (descontó plata que no existió)", () => {
    const r = invGastosRendicion([{ ...base, gastosRendicion: 4000, gastosAprobados: 0, gastosPendientes: 0 }]);
    expect(r).toHaveLength(1);
    expect(r[0].severidad).toBe("alto");
    expect(r[0].detalle).toMatch(/sin respaldo/);
  });

  it("todavía PENDIENTE de aprobar → medio (perseguir al aprobador, no al cobrador)", () => {
    const r = invGastosRendicion([{ ...base, gastosRendicion: 4000, gastosAprobados: 0, gastosPendientes: 4000 }]);
    expect(r).toHaveLength(1);
    expect(r[0].severidad).toBe("medio");
    expect(r[0].detalle).toMatch(/PENDIENTES/);
  });

  it("declaró MENOS de lo aprobado → sin hallazgos (nunca acusa por gastar de menos)", () => {
    expect(invGastosRendicion([{ ...base, gastosRendicion: 1000, gastosAprobados: 4000, gastosPendientes: 0 }])).toEqual([]);
  });
});
