// ─────────────────────────────────────────────────────────────────────────
//  LOS TRES VIGILANTES NUEVOS (INV13/14/15) — auditoría del 10-08.
//
//  La diferencia entre AUDITAR y MONITOREAR: los tres casos de acá se encontraron
//  a mano, revisando la base con SQL. Si se quedan como hallazgo, se vuelven a
//  perder. Como invariante, el cron los canta a la mañana siguiente.
//
//  Cada `it` reproduce el CASO REAL que lo motivó, con sus números medidos.
//  ⚠️ DINERO REAL: toda cifra esperada es entera.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import {
  invBaseSinRendir,
  invGastoSinEgreso,
  invBitacoraVsLibro,
  type AperturaHuerfana,
  type GastoAprobadoRecon,
  type JornadaBitacora,
} from "./reconciliacion";

const apertura = (p: Partial<AperturaHuerfana> = {}): AperturaHuerfana => ({
  cobradorId: "u-victor",
  cobradorNombre: "Víctor Moralez",
  fecha: "2026-08-06",
  monto: 178_265,
  rindioDespues: false,
  diasSinRendir: 4,
  ...p,
});

describe("INV13 — la base que se entregó y nadie volvió a pedir", () => {
  it("canta el caso real del 06-08: base entregada, ninguna rendición", () => {
    // Mauricio le dio base a 9 cobradores el 06-08 ($533.923) y a María Artunduaga
    // el 08-08 ($49.131). Ninguno rindió ese día: $583.054 que salieron de la caja
    // y desaparecieron de todas las pantallas al día siguiente.
    const [h] = invBaseSinRendir([apertura()]);
    expect(h.invariante).toBe("base_sin_rendir");
    expect(h.severidad).toBe("alto"); // 4 días
    expect(h.detalle).toContain("Víctor Moralez");
    expect(h.detalle).toContain("$178265");
    expect(h.detalle).toContain("2026-08-06");
  });

  it("si rindió después, no hay nada que cantar", () => {
    expect(invBaseSinRendir([apertura({ rindioDespues: true })])).toEqual([]);
  });

  it("el MISMO día no se marca: el cobrador todavía está en la calle", () => {
    // Cantar a las 07:00 la base que se entregó a las 07:00 es ruido garantizado,
    // y una invariante que grita todos los días se deja de mirar.
    expect(invBaseSinRendir([apertura({ diasSinRendir: 0 })])).toEqual([]);
  });

  it("un día es olvido; tres días es plata sin dueño declarado", () => {
    expect(invBaseSinRendir([apertura({ diasSinRendir: 1 })])[0].severidad).toBe("medio");
    expect(invBaseSinRendir([apertura({ diasSinRendir: 2 })])[0].severidad).toBe("medio");
    expect(invBaseSinRendir([apertura({ diasSinRendir: 3 })])[0].severidad).toBe("alto");
  });

  it("una base de $0 no es plata en la calle", () => {
    // John Albert tuvo una apertura en $0 el 08-08: es una declaración, no un float.
    expect(invBaseSinRendir([apertura({ monto: 0 })])).toEqual([]);
  });
});

describe("INV14 — el gasto aprobado que no salió de la caja", () => {
  const gasto = (p: Partial<GastoAprobadoRecon> = {}): GastoAprobadoRecon => ({
    solicitudId: "s-1",
    cobradorNombre: "Valentina Ramírez",
    monto: 1_000,
    fecha: "2026-08-04",
    tieneEgreso: true,
    tieneAuditoria: true,
    ...p,
  });

  it("el gasto sano no dice nada", () => {
    expect(invGastoSinEgreso([gasto()])).toEqual([]);
  });

  it("el caso real: aprobado y auditado, pero su egreso desapareció", () => {
    // El único gasto aprobado del piloto ($1.000 de combustible). La solicitud está
    // aprobada, la fila de auditoría existe... y `movimientos_caja` tiene 0 filas
    // con 3 borrados registrados. /admin/caja subdeclara exactamente $1.000.
    const [h] = invGastoSinEgreso([gasto({ tieneEgreso: false })]);
    expect(h.invariante).toBe("gasto_sin_egreso");
    expect(h.severidad).toBe("alto");
    expect(h.detalle).toContain("$1000");
    expect(h.detalle).toContain("subdeclara");
  });

  it("aprobado sin egreso NI auditoría = una firma que nadie puso", () => {
    // Es la huella exacta del gasto forjado que la 0137 ahora impide crear: se
    // insertaba ya "aprobado", bajaba el esperado del cierre, y no aparecía en
    // ninguna bandeja porque las bandejas listan los pendientes.
    const [h] = invGastoSinEgreso([gasto({ tieneEgreso: false, tieneAuditoria: false })]);
    expect(h.invariante).toBe("gasto_aprobado_sin_firma");
    expect(h.severidad).toBe("critico");
    expect(h.detalle).toContain("sin que nadie lo haya autorizado");
  });

  it("cada gasto se evalúa solo: uno roto no tapa a los sanos", () => {
    const out = invGastoSinEgreso([
      gasto({ solicitudId: "a" }),
      gasto({ solicitudId: "b", tieneEgreso: false }),
      gasto({ solicitudId: "c" }),
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("INV15 — la bitácora contra el libro de pagos", () => {
  const jornada = (p: Partial<JornadaBitacora> = {}): JornadaBitacora => ({
    cobradorId: "u-valentina",
    cobradorNombre: "Valentina Ramírez",
    fecha: "2026-08-03",
    cobrosBitacora: 50,
    pagosLibro: 45,
    pagosAnulados: 5,
    montoFaltante: 0,
    ...p,
  });

  it("una jornada sana cuadra: bitácora = vigentes + anulados", () => {
    expect(invBitacoraVsLibro([jornada()])).toEqual([]);
  });

  it("deshacer un cobro es legítimo y NO es un hallazgo", () => {
    // Valentina deshizo 4 esa noche. Anular deja su propio rastro (quién y por qué):
    // lo que se busca es el pago que no está ni vigente ni anulado.
    expect(invBitacoraVsLibro([jornada({ cobrosBitacora: 49, pagosLibro: 45, pagosAnulados: 4 })])).toEqual([]);
  });

  it("EL CASO REAL: 45 pagos borrados por un script, $220.960 sin rastro", () => {
    // El acta del 03-08 dice recaudado $220.960 en 45 cobros y hoy no hay un solo
    // pago que la respalde: un script de limpieza abrió `permitir_borrado_pagos` el
    // 04-08 creyendo que eran pruebas. La bitácora —otra tabla, que nadie tocó—
    // conserva los 50 cobros menos los 4 deshechos = exactamente 45 y $220.960.
    const [h] = invBitacoraVsLibro([
      jornada({ cobrosBitacora: 49, pagosLibro: 0, pagosAnulados: 4, montoFaltante: 220_960 }),
    ]);
    expect(h.invariante).toBe("bitacora_sin_libro");
    expect(h.severidad).toBe("critico");
    expect(h.detalle).toContain("Faltan 45 pagos");
    expect(h.detalle).toContain("$220960");
    expect(h.detalle).toContain("BORRADOS");
  });

  it("si el libro tiene MÁS que la bitácora no se queja", () => {
    // Un cobro de la oficina o un ajuste del empalme no pasa por la bitácora de
    // campo. Esta invariante busca plata que FALTA, no de más.
    expect(invBitacoraVsLibro([jornada({ cobrosBitacora: 10, pagosLibro: 40, pagosAnulados: 0 })])).toEqual([]);
  });
});
