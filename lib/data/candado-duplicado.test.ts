// ─────────────────────────────────────────────────────────────────────────
//  CANDADO ANTI DOBLE-TOQUE — la regla, fijada con los datos REALES del piloto.
//
//  El primer candado que escribí era "si ya cubrió la cuota de hoy, no cobres
//  más". Medido contra los 4 días del piloto, esa regla habría RECHAZADO 16
//  cobros legítimos en un solo día (la segunda vuelta de la ruta) — el 10% de la
//  jornada. Estos tests fijan la regla estrecha que sí separa los dos mundos.
//
//  ⚠️ Se testea el predicado REAL (lib/candadoCobro, el que ejecuta la Server
//  Action), no una copia: la copia anterior drifteó a la ventana de UN solo
//  lado — la regla vieja que confirmaba como "duplicado" plata cobrada de
//  verdad que subía tarde de la cola — y los tests seguían verdes.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import { gemeloReciente, VENTANA_DUPLICADO_MS } from "@/lib/candadoCobro";

// Los casos se expresan en "ms relativos": BASE ancla el reloj y cada pago se
// vuelve una fila real {monto, registrado_en} como las que ve el servidor.
const BASE = Date.parse("2026-08-15T12:00:00Z");
function esDuplicado(
  nuevo: { monto: number; enMs: number },
  previos: { monto: number; enMs: number; anulado?: boolean; origen?: string | null }[],
  ventanaMs = VENTANA_DUPLICADO_MS,
): boolean {
  const pagos = previos.map((p) => ({
    monto: p.monto,
    registrado_en: new Date(BASE + p.enMs).toISOString(),
    anulado: p.anulado ?? false,
    origen: p.origen ?? null,
  }));
  return gemeloReciente(pagos, nuevo.monto, BASE + nuevo.enMs, ventanaMs) !== undefined;
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

describe("candado A DOS LADOS: la ventana es |Δ|, no 'todo lo posterior'", () => {
  // La cola offline drena tarde: un cobro sellado a las 10:00 puede ENTRAR al
  // servidor cuando el libro ya tiene pagos de la tarde. Con la regla vieja de
  // un solo lado, cualquier pago POSTERIOR del mismo monto era "gemelo" a
  // cualquier distancia → el cobro real se confirmaba como duplicado y esa
  // plata desaparecía del libro en silencio (21 cobros con +10 min de atraso
  // en una sola semana).
  it("un pago igual registrado HORAS DESPUÉS del cobro NO es su gemelo", () => {
    // Con la copia drifteada (un solo lado) este caso daba `true`.
    expect(esDuplicado({ monto: 600, enMs: 0 }, [{ monto: 600, enMs: hs(3) }])).toBe(false);
  });

  it("el gemelo POSTERIOR dentro de la ventana SÍ frena (el orden de llegada no importa)", () => {
    expect(esDuplicado({ monto: 600, enMs: 0 }, [{ monto: 600, enMs: seg(300) }])).toBe(true);
  });

  it("sin registrado_en no hay contra qué medir: no frena", () => {
    expect(
      gemeloReciente([{ monto: 600, registrado_en: null }], 600, BASE),
    ).toBeUndefined();
  });
});
