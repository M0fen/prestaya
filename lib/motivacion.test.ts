// ─────────────────────────────────────────────────────────────────────────
//  EL MENSAJE DE ARRIBA DE LA RUTA — lo que se le dice a una persona todos los
//  días, treinta veces por día.
//
//  Dos cosas se prueban acá y ninguna es cosmética:
//   1. Que lo que dice sea VERDAD (sale de sus números, no de una frase pegada).
//      Un elogio que no coincide con lo que la persona sabe que hizo se lee como
//      burla, y el que lo lee todos los días lo detecta al segundo.
//   2. Que NUNCA reproche. Es una app de cobranza: la regla del proyecto es
//      framing positivo y cero culpa. Ir atrás a las 4 de la tarde es normal.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import { mensajeMotivacion, chispaDelDia, type EstadoDelCobrador } from "./motivacion";

const base: EstadoDelCobrador = {
  nombre: "Yuli",
  clientes: 40,
  resueltos: 0,
  esperado: 20_000,
  recaudadoRuta: 0,
  atrasoVivo: 0,
  comisionHoy: 0,
  yaRendida: false,
  horaUY: 9,
};
const con = (p: Partial<EstadoDelCobrador>) => mensajeMotivacion({ ...base, ...p });

describe("dice la verdad: sale de SUS números", () => {
  it("a la mañana sin arrancar, le dice cuántas paradas y cuánta plata", () => {
    const m = con({})!;
    expect(m.clave).toBe("arranque");
    expect(m.cuerpo).toContain("40 paradas");
    expect(m.cuerpo).toContain("$20.000");
    expect(m.cta?.href).toContain("/cobrador");
  });

  it("con la ruta completa lo celebra y nombra las cuotas que cobró", () => {
    const m = con({ resueltos: 40, recaudadoRuta: 20_000, horaUY: 14 })!;
    expect(m.clave).toBe("completa");
    expect(m.titulo).toContain("Yuli");
    expect(m.cuerpo).toContain("40 cuotas");
  });

  it("después de las 16, la ruta completa ofrece cerrar la jornada", () => {
    // Cerrar es lo que menos se hace en el piloto (3 rendiciones en total) y lo
    // que más ordena la caja: es EL momento de ofrecerlo.
    const m = con({ resueltos: 40, recaudadoRuta: 20_000, horaUY: 18 })!;
    expect(m.cta?.texto).toContain("Cerrar");
    expect(m.cuerpo).toContain("Cerrá la jornada");
  });

  it("si ya rindió, se lo reconoce y no le ofrece nada más", () => {
    const m = con({ yaRendida: true, resueltos: 40, recaudadoRuta: 20_000, horaUY: 20 })!;
    expect(m.clave).toBe("cerro");
    expect(m.cta).toBeNull();
  });

  it("la comisión ganada aparece SOLO si de verdad ganó algo", () => {
    expect(con({ resueltos: 20, recaudadoRuta: 10_000, comisionHoy: 0 })!.cuerpo).not.toContain("ganados");
    expect(con({ resueltos: 20, recaudadoRuta: 10_000, comisionHoy: 300 })!.cuerpo).toContain("$300 ganados");
  });

  it("sin ruta no inventa ánimo: no muestra nada", () => {
    expect(con({ clientes: 0 })).toBeNull();
  });
});

describe("el día que no vence nada (semanales, domingo)", () => {
  it("lo dice en vez de dejar la pantalla muda", () => {
    const m = con({ esperado: 0 })!;
    expect(m.clave).toBe("sin-vencimientos");
    expect(m.cuerpo).toContain("al día");
  });

  it("si hay atraso viejo, lo ofrece como oportunidad — no como deuda", () => {
    const m = con({ esperado: 0, atrasoVivo: 35_000 })!;
    expect(m.cuerpo).toContain("$35.000");
    expect(m.cuerpo).toContain("ganancia");
  });
});

describe("la cuota de hoy y el atraso viejo NO se mezclan", () => {
  it("cobrar todo lo de hoy es un logro aunque quede atraso", () => {
    // Es el mismo error que hacía que la ruta cantara "Completo ✓" con la calle
    // llena: son dos cosas distintas y hay que decir las dos.
    const m = con({ resueltos: 40, recaudadoRuta: 20_000, atrasoVivo: 131_940, horaUY: 15 })!;
    expect(m.clave).toBe("completa-con-atraso");
    expect(m.tono).toBe("logro");
    expect(m.cuerpo).toContain("$131.940");
    expect(m.cuerpo).toContain("aparte");
  });
});

describe("NUNCA reprocha (regla del proyecto: framing positivo, cero culpa)", () => {
  const PROHIBIDAS = [
    "vas mal", "atrasado", "te falta mucho", "deberías", "no cumpl", "mal día",
    "peor", "fracas", "flojo", "última", "último lugar",
  ];

  it("ninguna variante usa lenguaje de reproche", () => {
    const escenarios: Partial<EstadoDelCobrador>[] = [
      {},
      { horaUY: 17 },
      { resueltos: 2, recaudadoRuta: 500, horaUY: 18 },
      { resueltos: 5, recaudadoRuta: 1_000, horaUY: 20 },
      { resueltos: 20, recaudadoRuta: 10_000, horaUY: 13 },
      { resueltos: 35, recaudadoRuta: 18_000, horaUY: 16 },
      { resueltos: 40, recaudadoRuta: 20_000 },
      { yaRendida: true },
      { esperado: 0 },
      { esperado: 0, atrasoVivo: 5_000 },
    ];
    for (const e of escenarios) {
      const m = con(e);
      if (!m) continue;
      const texto = `${m.titulo} ${m.cuerpo}`.toLowerCase();
      for (const mala of PROHIBIDAS) {
        expect(texto, `"${mala}" en la variante ${m.clave}: ${texto}`).not.toContain(mala);
      }
    }
  });

  it("yendo muy atrás y tarde, empuja en vez de culpar", () => {
    const m = con({ resueltos: 3, recaudadoRuta: 900, horaUY: 18 })!;
    expect(m.clave).toBe("empuje-tarde");
    expect(m.titulo).toContain("tiempo");
    expect(m.cuerpo).toContain("se recupera mañana");
  });

  it("solo cuenta lo que FALTA cuando falta poco", () => {
    // Contar "te faltan 37" a las 9 de la mañana desanima; contar "te faltan 5"
    // cuando está cerca, empuja.
    expect(con({ resueltos: 35, recaudadoRuta: 18_000, horaUY: 15 })!.titulo).toContain("faltan 5");
    expect(con({ resueltos: 3, recaudadoRuta: 900, horaUY: 10 })!.titulo).not.toContain("faltan");
  });
});

describe("es reproducible (mismo estado ⇒ mismo mensaje)", () => {
  it("la chispa del día es determinista, no aleatoria", () => {
    // Si fuera aleatoria, el servidor y el navegador pintarían distinto y la
    // hidratación de React rompería la pantalla del cobrador en la calle.
    expect(chispaDelDia(3)).toBe(chispaDelDia(3));
    expect(chispaDelDia(3)).not.toBe(chispaDelDia(4));
    expect(chispaDelDia(-1)).toBeTypeOf("string");
    expect(chispaDelDia(9999)).toBeTypeOf("string");
  });

  it("cada variante tiene una clave estable para poder medir la respuesta", () => {
    const claves = new Set(
      [
        con({}),
        con({ resueltos: 40, recaudadoRuta: 20_000 }),
        con({ yaRendida: true }),
        con({ esperado: 0 }),
        con({ resueltos: 35, recaudadoRuta: 18_000, horaUY: 15 }),
        con({ resueltos: 20, recaudadoRuta: 10_000, horaUY: 13 }),
        con({ resueltos: 3, recaudadoRuta: 900, horaUY: 18 }),
        con({ resueltos: 3, recaudadoRuta: 900, horaUY: 13 }),
      ]
        .filter((m): m is NonNullable<typeof m> => !!m)
        .map((m) => m.clave),
    );
    expect(claves.size).toBe(8);
  });
});
