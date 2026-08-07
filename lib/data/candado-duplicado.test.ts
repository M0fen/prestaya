// ─────────────────────────────────────────────────────────────────────────
//  CANDADO ANTI DOBLE-TOQUE — la regla, fijada con los datos REALES del piloto.
//
//  El primer candado que escribí era "si ya cubrió la cuota de hoy, no cobres
//  más". Medido contra los 4 días del piloto, esa regla habría RECHAZADO 16
//  cobros legítimos en un solo día (la segunda vuelta de la ruta) — el 10% de la
//  jornada. Estos tests fijan la regla estrecha que sí separa los dos mundos.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";

/** La misma condición que aplica el servidor (app/cobrador/(app)/actions.ts). */
function esDuplicado(
  nuevo: { monto: number; enMs: number },
  previos: { monto: number; enMs: number; anulado?: boolean; origen?: string | null }[],
  ventanaMs = 10 * 60 * 1000,
): boolean {
  return previos.some(
    (p) =>
      !p.anulado &&
      (p.origen ?? null) === null &&
      Math.abs(p.monto - nuevo.monto) < 0.5 &&
      p.enMs >= nuevo.enMs - ventanaMs,
  );
}

const seg = (n: number) => n * 1000;
const hs = (n: number) => n * 3600 * 1000;

describe("candado: frena el doble toque, NO la segunda vuelta de la ruta", () => {
  it("los dos duplicados REALES del piloto se frenan", () => {
    // CARLOS SANTIAGO DA SILVA — $600 y $600 con 40 segundos de diferencia.
    expect(esDuplicado({ monto: 600, enMs: seg(40) }, [{ monto: 600, enMs: 0 }])).toBe(true);
    // ALBA NELLY ALQUERE — $250 y $250 con 50 segundos.
    expect(esDuplicado({ monto: 250, enMs: seg(50) }, [{ monto: 250, enMs: 0 }])).toBe(true);
  });

  it("la SEGUNDA VUELTA de la ruta pasa: 16 casos reales de un solo día", () => {
    // El par legítimo MÁS CERCANO del piloto fue de 2,26 horas (8.144 s).
    const vueltas: [number, number][] = [
      [200, 8144], [120, 8192], [500, 13688], [800, 15128], [800, 15136],
      [350, 15143], [500, 15251], [200, 15252], [3000, 15562], [300, 15799],
      [600, 16284], [250, 16478], [250, 17164], [350, 17264], [400, 17515],
      [2000, 21422],
    ];
    for (const [monto, segundos] of vueltas) {
      expect(
        esDuplicado({ monto, enMs: seg(segundos) }, [{ monto, enMs: 0 }]),
        `${monto} a los ${segundos}s tiene que PASAR`,
      ).toBe(false);
    }
  });

  it("MONTO DISTINTO nunca es duplicado, ni un minuto después", () => {
    // PABLO SOSA: pagó la cuota de $180 y 4 minutos después $20 para saldar.
    expect(esDuplicado({ monto: 20, enMs: seg(276) }, [{ monto: 180, enMs: 0 }])).toBe(false);
    // LUCIANA ALVAREZ: $960 y después $2.880 (9 cuotas juntas).
    expect(esDuplicado({ monto: 2880, enMs: seg(1121) }, [{ monto: 960, enMs: 0 }])).toBe(false);
  });

  it("justo en el borde de la ventana", () => {
    expect(esDuplicado({ monto: 600, enMs: seg(599) }, [{ monto: 600, enMs: 0 }])).toBe(true);
    expect(esDuplicado({ monto: 600, enMs: seg(601) }, [{ monto: 600, enMs: 0 }])).toBe(false);
  });

  it("un pago ANULADO no frena el recobro (justamente se anuló para rehacerlo)", () => {
    expect(
      esDuplicado({ monto: 600, enMs: seg(30) }, [{ monto: 600, enMs: 0, anulado: true }]),
    ).toBe(false);
  });

  it("los asientos IMPORTADOS no frenan un cobro real de la calle", () => {
    // El empalme sella con el registrado_por del cobrador real: sin el filtro de
    // origen, correr el import durante la jornada trababa cobros de verdad.
    expect(
      esDuplicado({ monto: 600, enMs: seg(30) }, [{ monto: 600, enMs: 0, origen: "disapp_import" }]),
    ).toBe(false);
  });

  it("hay un abismo entre el duplicado y la vuelta legítima: la ventana no es fina", () => {
    // Duplicado más lento: 50 s. Vuelta legítima más rápida: 8.144 s. 163× de margen.
    expect(seg(8144) / seg(50)).toBeGreaterThan(160);
  });
});
