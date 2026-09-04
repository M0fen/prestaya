// ─────────────────────────────────────────────────────────────────────────
//  LA PRUEBA QUE PIDIÓ CARLOS (04-09):
//    «crear un crédito equivalente por las cuatro puertas tiene que producir
//     exactamente el mismo resultado en la base».
//
//  Antes esto no se podía ni escribir: cada puerta tenía su copia de la
//  secuencia (normalizar → validar → medir techo → arrastrar tasa → calcular
//  cuota → fecha → op_id) y la única forma de compararlas era leerlas en
//  paralelo y confiar. Con `resolverCredito` la comparación es una línea.
//
//  Lo que este archivo fija:
//   1. Las cuatro puertas dan los MISMOS términos para el mismo pedido.
//   2. Ninguna puede crear un crédito SIN formato explícito.
//   3. El techo por (vía, autoridad) es el que era — puerta por puerta.
//   4. La cuota sale de UNA fórmula, incluso con la tasa rota del import.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import {
  resolverCredito,
  techosDe,
  esFrecuencia,
  FRECUENCIAS,
  ROTULO_CUOTA,
  type PedidoCredito,
  type ReferenciaCredito,
} from "./credito";
import { RENOVACION_CAP_TOTAL } from "@/lib/renovacion";

/** Martes 2026-09-08: el próximo día de cobro es el miércoles 09. */
const HOY = new Date("2026-09-08T12:00:00Z");

const REF: ReferenciaCredito = {
  prestamoId: "prest-anterior",
  monto: 10_000,
  cuota: 500, // 500 × 24 = 12.000 → 20%
  totalDias: 24,
  frecuencia: "diario",
};

function pedido(over: Partial<PedidoCredito> = {}): PedidoCredito {
  return {
    via: "venta",
    autoridad: "cobrador",
    clienteId: "cli-1",
    cobradorId: "u-maria",
    actorId: "u-maria",
    monto: 10_000,
    totalDias: 24,
    frecuencia: "diario",
    referencia: REF,
    hoy: HOY,
    ...over,
  };
}

describe("resolverCredito — las cuatro puertas dan lo MISMO", () => {
  it("mismo pedido por las 4 puertas → mismos términos de plata", () => {
    // Las cuatro pantallas que crean créditos, con el mismo pedido:
    //  1. Nueva venta desde la calle   (cobrador · venta)
    //  2. Renovar desde la calle       (cobrador · renovación)
    //  3. Alta desde el panel          (gestor  · venta)
    //  4. Renovar desde el panel       (gestor  · renovación)
    const puertas = [
      pedido({ via: "venta", autoridad: "cobrador" }),
      pedido({ via: "renovacion", autoridad: "cobrador" }),
      pedido({ via: "venta", autoridad: "gestor" }),
      pedido({ via: "renovacion", autoridad: "gestor" }),
    ].map((p) => resolverCredito(p));

    for (const r of puertas) expect(r.via).toBe("crear");

    const plata = puertas.map((r) => {
      if (r.via !== "crear") throw new Error("no creó");
      const { monto, cuota, totalDias, frecuencia, interesPct, fechaInicio, sobreCap } = r.terminos;
      return { monto, cuota, totalDias, frecuencia, interesPct, fechaInicio, sobreCap };
    });

    // Idénticos hasta el último peso: es lo que se guarda en `prestamos`.
    for (const p of plata) expect(p).toEqual(plata[0]);
    expect(plata[0]).toEqual({
      monto: 10_000,
      cuota: 500, // arrastra el 20% del anterior: 10.000 × 1,2 / 24
      totalDias: 24,
      frecuencia: "diario",
      interesPct: 20,
      fechaInicio: "2026-09-09",
      sobreCap: false,
    });
  });

  it("el op_id es determinista y NO depende de la puerta salvo por la vía", () => {
    // Dos toques de la misma venta → el mismo op_id (el índice único frena el
    // duplicado). Una renovación es otra operación: su clave es distinta.
    const a = resolverCredito(pedido({ via: "venta" }));
    const b = resolverCredito(pedido({ via: "venta" }));
    const r = resolverCredito(pedido({ via: "renovacion" }));
    if (a.via !== "crear" || b.via !== "crear" || r.via !== "crear") throw new Error("no creó");
    expect(a.terminos.opId).toBe(b.terminos.opId);
    expect(r.terminos.opId).not.toBe(a.terminos.opId);
  });

  it("el nonce del navegador manda sobre la clave derivada", () => {
    const nonce = "11111111-1111-4111-8111-111111111111";
    const r = resolverCredito(pedido({ nonce }));
    if (r.via !== "crear") throw new Error("no creó");
    expect(r.terminos.opId).toBe(nonce);
  });

  it("la fecha de inicio es el PRÓXIMO día de cobro, nunca hoy", () => {
    // Sábado 2026-09-05 → el domingo no vence cuota: arranca el lunes 07.
    const r = resolverCredito(pedido({ hoy: new Date("2026-09-05T12:00:00Z") }));
    if (r.via !== "crear") throw new Error("no creó");
    expect(r.terminos.fechaInicio).toBe("2026-09-07");
  });
});

describe("resolverCredito — el formato es OBLIGATORIO", () => {
  it("⚠️ EL BUG HISTÓRICO: sin formato y sin referencia NO se crea nada", () => {
    // Es el agujero por el que ocho planes semanales nacieron 'diario' y el
    // cartón los dio por vencidos en cinco días.
    const r = resolverCredito(pedido({ frecuencia: null, referencia: null }));
    expect(r.via).toBe("rechazo");
    if (r.via === "rechazo") expect(r.error).toMatch(/Elegí el formato/);
  });

  it("ninguna de las 4 puertas puede persistir sin formato explícito", () => {
    for (const via of ["venta", "renovacion"] as const) {
      for (const autoridad of ["cobrador", "gestor"] as const) {
        const r = resolverCredito(pedido({ via, autoridad, frecuencia: null, referencia: null }));
        expect(r.via, `${via}/${autoridad}`).toBe("rechazo");
      }
    }
  });

  it("con referencia, el formato se HEREDA y queda marcado como no-explícito", () => {
    // Renovar tal cual es legítimo: la pantalla muestra cuál es y se puede
    // cambiar. Lo que no se permite es que nadie lo haya visto nunca.
    const r = resolverCredito(pedido({ frecuencia: null, referencia: { ...REF, frecuencia: "semanal" } }));
    if (r.via !== "crear") throw new Error("no creó");
    expect(r.terminos.frecuencia).toBe("semanal");
    expect(r.terminos.formatoExplicito).toBe(false);
  });

  it("elegido a mano queda marcado como explícito", () => {
    const r = resolverCredito(pedido({ frecuencia: "semanal", totalDias: 4 }));
    if (r.via !== "crear") throw new Error("no creó");
    expect(r.terminos.formatoExplicito).toBe(true);
  });

  it("un formato inventado se rechaza (no cae a 'diario')", () => {
    const r = resolverCredito(pedido({ frecuencia: "quincenal2" as never }));
    expect(r.via).toBe("rechazo");
  });

  it("esFrecuencia acepta los cuatro y nada más", () => {
    for (const f of FRECUENCIAS) expect(esFrecuencia(f)).toBe(true);
    expect(esFrecuencia("anual")).toBe(false);
    expect(esFrecuencia(null)).toBe(false);
    expect(esFrecuencia("")).toBe(false);
  });

  it("cada formato tiene su rótulo de cuota (no todos 'Cuota diaria')", () => {
    expect(ROTULO_CUOTA.semanal).toBe("Cuota semanal");
    expect(ROTULO_CUOTA.mensual).toBe("Cuota mensual");
    expect(new Set(Object.values(ROTULO_CUOTA)).size).toBe(4);
  });
});

describe("techosDe — la tabla de autoridad, puerta por puerta", () => {
  it("VENTA · cobrador: coloca hasta +20%, el gestor le aprueba hasta el CAP", () => {
    const t = techosDe("venta", "cobrador", REF); // anterior $10.000
    expect(t.propio).toBe(12_000); // +20%
    expect(t.maximo).toBe(RENOVACION_CAP_TOTAL); // piso del CAP
  });

  it("VENTA · gestor: su techo propio ES el máximo (no tiene a quién pedirle)", () => {
    const t = techosDe("venta", "gestor", REF);
    expect(t.propio).toBe(t.maximo);
    expect(t.propio).toBe(RENOVACION_CAP_TOTAL);
  });

  it("RENOVACIÓN · cobrador: repetir un heredado sobre el CAP se aprueba SOLO", () => {
    // La continuidad no es capital nuevo: un heredado de $120.000 se repite tal
    // cual sin ir a la cola (si no, el cliente esperaba días por lo que ya tenía).
    const heredado: ReferenciaCredito = { ...REF, monto: 120_000, cuota: 6_000, totalDias: 24 };
    const t = techosDe("renovacion", "cobrador", heredado);
    expect(t.propio).toBe(120_000);
    expect(t.maximo).toBe(144_000); // +20%
  });

  it("VENTA · cobrador con heredado sobre el CAP: NO hereda la excepción", () => {
    // Capital NUEVO sobre un cliente de $120.000 sigue acotado por el CAP.
    const heredado: ReferenciaCredito = { ...REF, monto: 120_000, cuota: 6_000, totalDias: 24 };
    const t = techosDe("venta", "cobrador", heredado);
    expect(t.propio).toBe(RENOVACION_CAP_TOTAL);
  });

  it("PRIMER crédito: el CAP para todos, cobrador y gestor por igual", () => {
    for (const via of ["venta", "renovacion"] as const) {
      for (const autoridad of ["cobrador", "gestor"] as const) {
        const t = techosDe(via, autoridad, null);
        expect(t.propio).toBe(RENOVACION_CAP_TOTAL);
        expect(t.maximo).toBe(RENOVACION_CAP_TOTAL);
      }
    }
  });
});

describe("resolverCredito — qué pasa arriba del techo", () => {
  it("el cobrador que se pasa PIDE (nunca un callejón sin salida)", () => {
    const r = resolverCredito(pedido({ monto: 20_000 })); // techo propio 12.000
    expect(r.via).toBe("solicitud");
    if (r.via === "solicitud") {
      expect(r.monto).toBe(20_000);
      expect(r.techo).toBe(12_000);
      expect(r.referenciaId).toBe("prest-anterior");
    }
  });

  it("el gestor que se pasa del máximo se rechaza CON el número posible", () => {
    const r = resolverCredito(pedido({ autoridad: "gestor", monto: 200_000 }));
    expect(r.via).toBe("rechazo");
    if (r.via === "rechazo") expect(r.error).toContain("100.000");
  });

  it("lo que NI el gestor puede autorizar no se manda a la cola", () => {
    // El cobrador que pide $200.000 sobre un anterior de $10.000: mandarlo a una
    // cola que lo va a rechazar es hacerlo esperar por un no.
    const r = resolverCredito(pedido({ monto: 200_000 }));
    expect(r.via).toBe("rechazo");
  });

  it("el PRIMER crédito sobre el CAP dice su propio mensaje", () => {
    const r = resolverCredito(pedido({ referencia: null, monto: 150_000 }));
    expect(r.via).toBe("rechazo");
    if (r.via === "rechazo") expect(r.error).toMatch(/primer crédito/i);
  });

  it("renovar por el MISMO monto un heredado sobre el CAP sale directo", () => {
    const heredado: ReferenciaCredito = { ...REF, monto: 120_000, cuota: 6_000, totalDias: 24 };
    const r = resolverCredito(
      pedido({ via: "renovacion", monto: null, totalDias: null, frecuencia: null, referencia: heredado }),
    );
    expect(r.via).toBe("crear");
    if (r.via === "crear") {
      expect(r.terminos.monto).toBe(120_000);
      expect(r.terminos.sobreCap).toBe(true); // la capa de datos lo necesita
    }
  });
});

describe("resolverCredito — la cuota, una sola fórmula", () => {
  it("arrastra la tasa real del anterior (3,5% se respeta)", () => {
    const ref: ReferenciaCredito = { ...REF, monto: 100_000, cuota: 4_313, totalDias: 24 };
    // 4.313 × 24 / 100.000 = 1,03512 → 3,5%
    const r = resolverCredito(pedido({ referencia: ref, monto: 50_000, totalDias: 24 }));
    if (r.via !== "crear") throw new Error("no creó");
    expect(r.terminos.cuota).toBe(Math.round((50_000 * 1.03512) / 24));
    expect(r.terminos.interesPct).toBe(3.5);
  });

  it("⚠️ tasa ROTA del import (0%): cae al 20% del negocio, no presta a pérdida", () => {
    // 192 créditos activos al 0% ($72M) heredados de Disapp: sin el piso, el
    // crédito nuevo devolvía MENOS de lo que se entregaba.
    const rota: ReferenciaCredito = { ...REF, monto: 18_000, cuota: 600, totalDias: 30 };
    const r = resolverCredito(pedido({ referencia: rota, monto: 5_000, totalDias: 24 }));
    if (r.via !== "crear") throw new Error("no creó");
    expect(r.terminos.cuota).toBe(250); // 5.000 × 1,2 / 24
    expect(r.terminos.interesPct).toBe(20);
  });

  it("las 4 puertas coinciden TAMBIÉN con la tasa rota", () => {
    const rota: ReferenciaCredito = { ...REF, monto: 18_000, cuota: 600, totalDias: 30 };
    const cuotas = (["venta", "renovacion"] as const).flatMap((via) =>
      (["cobrador", "gestor"] as const).map((autoridad) => {
        const r = resolverCredito(pedido({ via, autoridad, referencia: rota, monto: 5_000, totalDias: 24 }));
        return r.via === "crear" ? r.terminos.cuota : -1;
      }),
    );
    expect(new Set(cuotas).size).toBe(1);
    expect(cuotas[0]).toBe(250);
  });

  it("sin historial, el interés del formulario manda (y se acota a 0–100)", () => {
    const r = resolverCredito(pedido({ referencia: null, monto: 10_000, totalDias: 20, interesPct: 30 }));
    if (r.via !== "crear") throw new Error("no creó");
    expect(r.terminos.cuota).toBe(650); // 10.000 × 1,3 / 20
    expect(r.terminos.interesPct).toBe(30);

    const absurdo = resolverCredito(
      pedido({ referencia: null, monto: 10_000, totalDias: 20, interesPct: 5_000 }),
    );
    if (absurdo.via !== "crear") throw new Error("no creó");
    expect(absurdo.terminos.interesPct).toBe(100);
  });

  it("CON historial, el interés del formulario se IGNORA (no se re-tarifa)", () => {
    const r = resolverCredito(pedido({ interesPct: 90 }));
    if (r.via !== "crear") throw new Error("no creó");
    expect(r.terminos.interesPct).toBe(20); // el del anterior, no el tecleado
  });
});

describe("resolverCredito — cuotas heredadas vs tecleadas", () => {
  it("el tope de 366 rige lo TECLEADO", () => {
    const r = resolverCredito(pedido({ totalDias: 400 }));
    expect(r.via).toBe("rechazo");
    if (r.via === "rechazo") expect(r.error).toMatch(/366/);
  });

  // ⚠️ REGRESIÓN REAL, cazada por la auditoría del 04-09. El tope se aplicaba
  // cuando "venía un número", y los formularios PRELLENAN el campo con las
  // cuotas del anterior: el panel mandaba 555 sin que nadie tocara nada y
  // renovar a PAOLA VANESSA CASTRO ($1.110.000, saldada) rebotaba en rojo.
  it("⚠️ EL FORM PRELLENA: mandar las MISMAS 555 cuotas del anterior es heredar, no teclear", () => {
    const ref = {
      prestamoId: "p-paola",
      monto: 1_110_000,
      cuota: 2_000,
      totalDias: 555,
      frecuencia: "diario" as const,
    };
    // Así llega desde FormRenovacion (campo prellenado) y desde aprobarSolicitud
    // (la solicitud guardó el plazo heredado): un número, igual al de siempre.
    for (const autoridad of ["cobrador", "gestor"] as const) {
      const r = resolverCredito(pedido({
        via: "renovacion",
        autoridad,
        monto: 1_110_000,
        totalDias: 555,
        frecuencia: null,
        referencia: ref,
      }));
      expect(r.via, `${autoridad} no pudo renovar un heredado de 555 cuotas`).toBe("crear");
      if (r.via === "crear") expect(r.terminos.totalDias).toBe(555);
    }
  });

  it("pero si ELIGE otro plazo largo, el tope sí rige (es una decisión, no continuidad)", () => {
    const ref = {
      prestamoId: "p-paola",
      monto: 1_110_000,
      cuota: 2_000,
      totalDias: 555,
      frecuencia: "diario" as const,
    };
    const r = resolverCredito(pedido({
      via: "renovacion",
      monto: 1_110_000,
      totalDias: 500, // distinto del anterior → lo eligió una persona
      frecuencia: null,
      referencia: ref,
    }));
    expect(r.via).toBe("rechazo");
    if (r.via === "rechazo") expect(r.error).toMatch(/366/);
  });

  it("⚠️ pero NO lo heredado: un Disapp de 555 cuotas se repite tal cual", () => {
    // PAOLA VANESSA CASTRO, $1.110.000 en 555 cuotas. Rebotarlo era un rojo sobre
    // algo que el cobrador no puede tocar en esa pantalla.
    const largo: ReferenciaCredito = { ...REF, monto: 90_000, cuota: 200, totalDias: 555 };
    const r = resolverCredito(
      pedido({ via: "renovacion", monto: null, totalDias: null, frecuencia: null, referencia: largo }),
    );
    expect(r.via).toBe("crear");
    if (r.via === "crear") expect(r.terminos.totalDias).toBe(555);
  });

  it("cuotas en 0 o negativas se rechazan en las 4 puertas", () => {
    for (const n of [0, -5]) {
      const r = resolverCredito(pedido({ totalDias: n }));
      expect(r.via, `cuotas=${n}`).toBe("rechazo");
    }
  });

  it("monto en 0 o negativo se rechaza", () => {
    for (const m of [0, -100]) {
      const r = resolverCredito(pedido({ monto: m }));
      expect(r.via, `monto=${m}`).toBe("rechazo");
    }
  });
});
