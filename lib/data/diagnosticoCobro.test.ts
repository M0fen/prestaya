// ─────────────────────────────────────────────────────────────────────────
//  LA REGLA PURA del diagnóstico: por qué no entró ese cobro.
//
//  El valor de este archivo no es cubrir ramas: es fijar el ORDEN de las
//  preguntas y las distinciones que el mensaje viejo borraba. En particular:
//    · «reasignado» gana sobre cualquier cosa que le haya pasado al crédito;
//    · «renovado» y «saldado» son estados IDÉNTICOS en la base ('finalizado') y
//      solo los separa el linaje `renovado_de` — y son consejos OPUESTOS para el
//      cobrador que tiene el efectivo en la mano.
//
//  La consulta (`diagnosticarNoEntra`) se prueba a través de la Server Action en
//  lib/data/pagos.workflow.test.ts, con dobles de Supabase.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { clasificarNoEntra, mensajeDe, type MotivoNoEntra } from "./diagnosticoCobro";

const KARENT = "u-karent";
const VICTOR = "u-victor";
const VIEJO = "c-viejo";
const NUEVO = "c-nuevo";

type Fila = Parameters<typeof clasificarNoEntra>[0]["prestamosCliente"][number];

function prestamo(over: Partial<Fila> & { id: string }): Fila {
  return {
    estado: "activo",
    cobrador_id: KARENT,
    renovado_de: null,
    creado_en: "2026-08-01T12:00:00Z",
    ...over,
  };
}

/** Caso base: cliente existe, sigue en la ruta, y su crédito está vivo. */
function clasificar(over: Partial<Parameters<typeof clasificarNoEntra>[0]> = {}): MotivoNoEntra {
  return clasificarNoEntra({
    clienteExiste: true,
    sigueEnMiRuta: true,
    laTieneOtro: false,
    cobradorId: KARENT,
    prestamo: null,
    prestamosCliente: [],
    ...over,
  });
}

describe("por qué no entró el cobro", () => {
  it("cliente que no existe → no se inventa una explicación", () => {
    expect(clasificar({ clienteExiste: false })).toBe("desconocido");
  });

  it("le sacaron el cliente y HOY LO TIENE otro cobrador → reasignado", () => {
    expect(clasificar({ sigueEnMiRuta: false, laTieneOtro: true })).toBe("reasignado");
  });

  // Medido sobre la base: de 1.323 casos que caerían acá, 1.013 no los tiene
  // NINGÚN cobrador. Mandarlos a buscar al compañero que se lo llevó sería
  // cambiar una mentira por otra.
  it("le sacaron el cliente y no lo tiene NADIE → fuera de ruta, no reasignado", () => {
    const motivo = clasificar({ sigueEnMiRuta: false, laTieneOtro: false });
    expect(motivo).toBe("fuera_de_ruta");
    expect(mensajeDe(motivo)).not.toMatch(/se lo pasaron a otro/i);
  });

  // La razón por la que el orden importa: si al cobrador le sacaron el cliente Y
  // además le renovaron el crédito, decirle "cobralo sobre el crédito nuevo" lo
  // manda a cobrar algo que ya no puede cobrar. La reasignación manda.
  it("reasignado GANA sobre renovado: el consejo del crédito nuevo sería imposible de seguir", () => {
    const motivo = clasificar({
      sigueEnMiRuta: false,
      laTieneOtro: true,
      prestamo: prestamo({ id: VIEJO, estado: "finalizado" }),
      prestamosCliente: [
        prestamo({ id: VIEJO, estado: "finalizado" }),
        prestamo({ id: NUEVO, renovado_de: VIEJO }),
      ],
    });
    expect(motivo).toBe("reasignado");
  });

  // El panel cobra sin cobrador de por medio: ahí "te lo sacaron de la ruta" no
  // significa nada y sería un mensaje absurdo.
  it("cobrando desde el panel (sin cobrador) nunca se dice que le sacaron el cliente", () => {
    const motivo = clasificarNoEntra({
      clienteExiste: true,
      sigueEnMiRuta: true, // el llamador lo resuelve así cuando no hay cobrador
      laTieneOtro: false,
      cobradorId: null,
      prestamo: prestamo({ id: VIEJO, estado: "finalizado" }),
      prestamosCliente: [prestamo({ id: VIEJO, estado: "finalizado" })],
    });
    expect(motivo).toBe("saldado");
  });

  it("crédito finalizado CON un hijo que lo renovó → renovado", () => {
    const motivo = clasificar({
      prestamo: prestamo({ id: VIEJO, estado: "finalizado" }),
      prestamosCliente: [
        prestamo({ id: VIEJO, estado: "finalizado" }),
        prestamo({ id: NUEVO, renovado_de: VIEJO }),
      ],
    });
    expect(motivo).toBe("renovado");
  });

  // El mismo estado 'finalizado', sin hijo: terminó de pagarse. Antes las dos
  // situaciones caían en la misma frase ("lo renovaron o se saldó").
  it("crédito finalizado SIN hijo → saldado, que es el consejo opuesto", () => {
    const motivo = clasificar({
      prestamo: prestamo({ id: VIEJO, estado: "finalizado" }),
      prestamosCliente: [prestamo({ id: VIEJO, estado: "finalizado" })],
    });
    expect(motivo).toBe("saldado");
  });

  // 11.148 de los 11.466 finalizados de la base (herencia de Disapp) no tienen
  // hijo registrado: ahí "se renovó" y "se saldó" son indistinguibles. Elegir
  // uno de los dos da el consejo contrario la mitad de las veces.
  it("finalizado SIN linaje pero con otro crédito abierto → no se afirma cuál de las dos cosas pasó", () => {
    const motivo = clasificar({
      prestamo: prestamo({ id: VIEJO, estado: "finalizado" }),
      prestamosCliente: [
        prestamo({ id: VIEJO, estado: "finalizado" }),
        prestamo({ id: NUEVO, renovado_de: null }), // activo, sin linaje
      ],
    });
    expect(motivo).toBe("cerrado_hay_otro");
    const texto = mensajeDe(motivo, "cobro");
    expect(texto).not.toMatch(/terminó de pagarse|se renovó/i); // no afirma ninguna
    expect(texto).toMatch(/mirá su ficha/i); // pero sí dice qué hacer
  });

  it("un hijo de OTRO crédito no cuenta como renovación de éste", () => {
    const motivo = clasificar({
      prestamo: prestamo({ id: VIEJO, estado: "finalizado" }),
      prestamosCliente: [
        prestamo({ id: VIEJO, estado: "finalizado" }),
        prestamo({ id: NUEVO, estado: "finalizado", renovado_de: "c-otro-distinto" }),
      ],
    });
    expect(motivo).toBe("saldado");
  });

  it("estado 'refinanciado' se nombra renovado sin depender del linaje", () => {
    const motivo = clasificar({
      prestamo: prestamo({ id: VIEJO, estado: "refinanciado" }),
      prestamosCliente: [prestamo({ id: VIEJO, estado: "refinanciado" })],
    });
    expect(motivo).toBe("renovado");
  });

  it.each(["cancelado", "incobrable"])("estado '%s' → dado de baja desde la oficina", (estado) => {
    const motivo = clasificar({
      prestamo: prestamo({ id: VIEJO, estado }),
      prestamosCliente: [prestamo({ id: VIEJO, estado })],
    });
    expect(motivo).toBe("cancelado");
  });

  // Cliente compartido entre dos rutas (59 clientes reales). El crédito está
  // vivo: decirle "ya no está activo" es directamente falso.
  it("crédito VIVO de un compañero → de_otro, no 'inactivo'", () => {
    const motivo = clasificar({
      prestamo: null,
      prestamosCliente: [prestamo({ id: VIEJO, cobrador_id: VICTOR })],
    });
    expect(motivo).toBe("de_otro");
  });

  it("crédito vivo SIN dueño (cobrador_id NULL) no se le atribuye a nadie", () => {
    const motivo = clasificar({
      prestamo: null,
      prestamosCliente: [prestamo({ id: VIEJO, cobrador_id: null })],
    });
    expect(motivo).toBe("desconocido");
  });

  it("sin crédito elegido, con varios: manda el ACTIVO por encima de los cerrados", () => {
    const motivo = clasificar({
      prestamo: null,
      prestamosCliente: [
        prestamo({ id: "c-1", estado: "finalizado", creado_en: "2026-01-01T00:00:00Z" }),
        prestamo({ id: VIEJO, cobrador_id: VICTOR }),
      ],
    });
    expect(motivo).toBe("de_otro");
  });

  it("sin crédito elegido y sin ninguno activo: se mira el cerrado MÁS RECIENTE", () => {
    const motivo = clasificar({
      prestamo: null,
      prestamosCliente: [
        prestamo({ id: "c-viejisimo", estado: "cancelado", creado_en: "2026-01-01T00:00:00Z" }),
        prestamo({ id: VIEJO, estado: "finalizado", creado_en: "2026-08-01T00:00:00Z" }),
      ],
    });
    expect(motivo).toBe("saldado"); // el de agosto, no el de enero
  });

  it("cliente sin ningún crédito → no se inventa nada", () => {
    expect(clasificar({ prestamo: null, prestamosCliente: [] })).toBe("desconocido");
  });
});

describe("la frase que lee el cobrador", () => {
  const TODOS: MotivoNoEntra[] = [
    "reasignado",
    "fuera_de_ruta",
    "renovado",
    "saldado",
    "cerrado_hay_otro",
    "cancelado",
    "de_otro",
    "desconocido",
  ];

  it.each(TODOS)("'%s' dice qué pasó Y qué hacer, en las dos versiones", (motivo) => {
    for (const acto of ["cobro", "visita"] as const) {
      const texto = mensajeDe(motivo, acto);
      expect(texto.length).toBeGreaterThan(40);
      expect(texto).toMatch(/[.!]$/); // frase terminada, no un fragmento
      // Nunca un código de error ni jerga de la base en la pantalla del cobrador.
      expect(texto).not.toMatch(/null|undefined|P04\d\d|RLS|prestamo_id/i);
    }
  });

  it("en una VISITA no se habla de plata: no hay efectivo de por medio", () => {
    for (const motivo of TODOS) {
      expect(mensajeDe(motivo, "visita")).not.toMatch(/plata|efectivo/i);
    }
  });

  it("en un COBRO siempre se le dice qué hacer con el efectivo que tiene encima", () => {
    for (const motivo of TODOS) {
      expect(mensajeDe(motivo, "cobro")).toMatch(/supervisor|crédito nuevo/i);
    }
  });

  // Un mensaje que afirma de más es la mentira que este módulo vino a sacar.
  it("ningún motivo afirma a la vez que se saldó y que se renovó", () => {
    for (const motivo of TODOS) {
      const texto = mensajeDe(motivo, "cobro");
      const dice = (re: RegExp) => re.test(texto);
      expect(dice(/terminó de pagarse/i) && dice(/se renovó/i)).toBe(false);
    }
  });

  it("cada motivo tiene su propia frase: ninguno se repite ni se solapa", () => {
    const frases = TODOS.map((m) => mensajeDe(m, "cobro"));
    expect(new Set(frases).size).toBe(TODOS.length);
  });

  it("por defecto se asume COBRO: el caso con plata en la mano es el que no puede salir mal", () => {
    expect(mensajeDe("reasignado")).toBe(mensajeDe("reasignado", "cobro"));
  });
});
