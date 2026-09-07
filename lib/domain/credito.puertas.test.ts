// ─────────────────────────────────────────────────────────────────────────
//  GUARDIÁN DE LA FUENTE ÚNICA — que la duplicación no vuelva.
//
//  `credito.test.ts` prueba que el módulo decide bien. Este archivo prueba algo
//  distinto y más frágil: que las puertas SIGAN USÁNDOLO. Un refactor puede
//  dejar el módulo perfecto y, sin romper un solo test, devolverle a una puerta
//  su propia cuenta del techo — que es exactamente cómo empezó este problema:
//  cuatro copias que nacieron iguales y se fueron separando hasta que "Nueva
//  venta" creaba créditos 'diario' en silencio.
//
//  Son dos guardias:
//   1. ESTRUCTURAL — ninguna puerta importa las funciones de plata directo. Si
//      alguien vuelve a escribir `techoVentaNueva(...)` en una Server Action,
//      este test lo dice con el nombre del archivo.
//   2. DE ESPEJO — la pantalla y el servidor sacan el techo de la MISMA función.
//      Se IMPORTA el predicado, nunca se copia (regla de la casa): si `techosDe`
//      cambia, el test cambia con él y sigue probando la igualdad, que es lo
//      único que importa.
// ─────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { referenciaDe, resolverCredito, techosDe } from "./credito";
import { calcularCuotaRenovacion, RENOVACION_CAP_TOTAL } from "@/lib/renovacion";

const RAIZ = join(__dirname, "..", "..");
const leer = (p: string) => readFileSync(join(RAIZ, p), "utf8");

/** Los seis caminos de servidor que CREAN un crédito. */
const PUERTAS = [
  "lib/acciones/cobradorCredito.ts", // renovarDesdeCalle + nuevaVentaDesdeCalle
  "lib/acciones/creditoNuevo.ts", // alta del panel
  "app/admin/(panel)/renovaciones/actions.ts", // renovarCredito + las dos de aprobarSolicitud
];

/**
 * Las funciones que deciden PLATA. Solo `lib/domain/credito.ts` puede llamarlas:
 * son las piezas con las que se arma la tabla de techos y la cuota, y usarlas
 * sueltas es volver a tener cuatro combinaciones distintas.
 */
const SOLO_DEL_DOMINIO = [
  "techoVentaNueva",
  "techoVentaGestor",
  "techoRenovacion",
  "montoRenovacionAutoAprobable",
  "calcularCuotaCreditoNuevo",
  "calcularCuotaRenovacion",
];

describe("guardián estructural — las puertas no vuelven a hacer su propia cuenta", () => {
  for (const puerta of PUERTAS) {
    it(`${puerta} no llama a las funciones de plata por su cuenta`, () => {
      const src = leer(puerta);
      // Se mira el CÓDIGO, no los comentarios: el archivo explica su historia y
      // nombra esas funciones a propósito para que se entienda de dónde viene.
      const codigo = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("//"))
        .join("\n");
      const culpables = SOLO_DEL_DOMINIO.filter((fn) =>
        new RegExp(`\\b${fn}\\s*\\(`).test(codigo),
      );
      expect(
        culpables,
        `${puerta} volvió a decidir la plata por su cuenta con ${culpables.join(", ")}. ` +
          `Eso va en lib/domain/credito.ts, que es de donde lo toman las otras cinco puertas.`,
      ).toEqual([]);
    });

    it(`${puerta} resuelve los términos con el módulo de dominio`, () => {
      const src = leer(puerta);
      expect(src).toContain("@/lib/domain/credito");
      expect(src).toMatch(/\bresolverCredito\s*\(/);
    });
  }

  it("ninguna puerta arma un crédito con frecuencia 'diario' escrita a mano", () => {
    // El default silencioso. Ocho planes semanales nacieron así.
    for (const puerta of PUERTAS) {
      const codigo = leer(puerta)
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("//"))
        .join("\n");
      expect(
        codigo,
        `${puerta} tiene un fallback a 'diario'. El formato se pregunta, no se asume.`,
      ).not.toMatch(/frecuencia[^\n]*\?\?\s*["']diario["']/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  LA GUARDIA QUE MIRA HACIA ADELANTE.
//
//  Las de arriba vigilan las puertas que HOY conocemos. Esta busca sola, en todo
//  el repo, cualquier archivo que coloque capital, y exige que pase por el
//  módulo. Es la que va a hablar el día que alguien agregue una séptima puerta
//  —que es exactamente lo que pasó con las dos de aprobar pedido, que existían
//  hace meses y nadie las contaba entre "las cuatro pantallas".
// ─────────────────────────────────────────────────────────────────────────
describe("guardia hacia adelante — ningún camino NUEVO crea créditos por afuera", () => {
  /** Señales de que un archivo COLOCA capital. */
  const CREA_CREDITO = [
    /\bcrearCreditoNuevoDb\s*\(/,
    /\bcrearRenovacion\s*\(/,
    /\bcrearVentaSegura\s*\(/,
    /from\(["']prestamos["']\)[\s\S]{0,80}\.insert\s*\(/,
    /rpc\(["'](?:renovar_credito_seguro|crear_credito_venta_seguro)["']/,
  ];

  /**
   * Excepciones DECLARADAS, con su motivo. Una excepción sin motivo escrito es
   * una puerta olvidada esperando a que la descubran.
   */
  const EXENTOS: Record<string, string> = {
    "lib/data/creditoNuevo.ts":
      "capa de PERSISTENCIA: recibe los términos ya resueltos, no decide plata",
    "lib/data/renovaciones.ts":
      "capa de PERSISTENCIA: recibe los términos ya resueltos (cuota y fechaInicio llegan del módulo)",
    "lib/data/tienda.ts":
      "capa de PERSISTENCIA de la venta de tienda: la RPC solo inserta, los términos llegan calculados",
    "lib/acciones/tienda.ts":
      "VENTA DE TIENDA — puerta legítimamente distinta: la tasa sale del PRODUCTO (precio + interés + cuotas, con overrides por segmento), no del historial del cliente. Meterla en resolverCredito le aplicaría al televisor la tasa del último préstamo de efectivo. Comparte el CAP y la fecha de inicio; su unificación es una decisión de negocio pendiente, no un olvido.",
  };

  function fuentes(dir: string, acc: string[] = []): string[] {
    for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (["node_modules", ".next", ".git"].includes(e.name)) continue;
        fuentes(rel, acc);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        acc.push(rel);
      }
    }
    return acc;
  }

  it("todo archivo que coloca capital importa lib/domain/credito (o está exento con motivo)", () => {
    const archivos = [...fuentes("lib"), ...fuentes("app")];
    const infractores: string[] = [];

    for (const archivo of archivos) {
      const src = leer(archivo);
      const codigo = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("//"))
        .join("\n");
      if (!CREA_CREDITO.some((p) => p.test(codigo))) continue;

      const clave = archivo.split("/").join("/").replace(new RegExp(`\\${sep}`, "g"), "/");
      if (clave in EXENTOS) continue;
      if (codigo.includes("@/lib/domain/credito")) continue;
      infractores.push(archivo);
    }

    expect(
      infractores,
      `Estos archivos colocan capital sin pasar por lib/domain/credito.ts:\n` +
        infractores.map((f) => `  · ${f}`).join("\n") +
        `\n\nO lo llaman con resolverCredito, o se agregan a EXENTOS con el motivo escrito.`,
    ).toEqual([]);
  });

  it("las exenciones siguen existiendo (una exención a un archivo borrado es ruido)", () => {
    for (const archivo of Object.keys(EXENTOS)) {
      expect(() => leer(archivo), `${archivo} está exento pero ya no existe`).not.toThrow();
    }
  });
});

describe("espejo pantalla=servidor — el techo que se OFRECE es el que se ACEPTA", () => {
  // La lista de la calle dibuja "podés darle hasta $X". Si ese número no es el
  // mismo que el servidor acepta, el cobrador se come un rojo delante del
  // cliente por un monto que la propia app le acababa de ofrecer.
  const CASOS = [
    { nombre: "chico típico", monto: 5_000, cuota: 250, totalDias: 24 },
    { nombre: "el del redondeo (base×1,2 cae en ,6)", monto: 8_403, cuota: 420, totalDias: 24 },
    { nombre: "justo bajo el CAP", monto: 83_333, cuota: 4_167, totalDias: 24 },
    { nombre: "heredado sobre el CAP", monto: 120_000, cuota: 6_000, totalDias: 24 },
    { nombre: "heredado grande de Disapp", monto: 1_750_000, cuota: 3_500, totalDias: 600 },
  ];

  for (const c of CASOS) {
    it(`${c.nombre}: renovación y venta coinciden con la tabla`, () => {
      const ref = referenciaDe({
        id: "p1",
        monto_prestado: c.monto,
        cuota_diaria: c.cuota,
        total_dias: c.totalDias,
        frecuencia: "diario",
      });
      expect(ref).not.toBeNull();

      // Lo que la pantalla pone en la tarjeta sale de ESTA función; lo que el
      // servidor aplica al crear, también. La igualdad es la prueba.
      const ren = techosDe("renovacion", "cobrador", ref);
      const ven = techosDe("venta", "cobrador", ref);

      // Invariantes que valen para cualquier monto, hoy y después de un cambio:
      // con un anterior NO hay tope (regla de Carlos, 06-09) — el umbral es solo
      // la línea a partir de la cual se avisa.
      expect(ren.maximo).toBeNull();
      expect(ven.maximo).toBeNull();
      // Repetir tal cual SIEMPRE va sin aviso — es continuidad, no capital nuevo.
      expect(ren.propio).toBeGreaterThanOrEqual(c.monto);
      // El umbral de la venta nunca supera el CAP (capital nuevo).
      expect(ven.propio).toBeLessThanOrEqual(RENOVACION_CAP_TOTAL);
    });
  }

  it("el primer crédito tiene el CAP como techo y máximo, en las dos vías", () => {
    for (const via of ["venta", "renovacion"] as const) {
      for (const quien of ["cobrador", "gestor"] as const) {
        expect(techosDe(via, quien, null)).toEqual({
          propio: RENOVACION_CAP_TOTAL,
          maximo: RENOVACION_CAP_TOTAL,
        });
      }
    }
  });

  it("referenciaDe lee las dos formas de fila (la de la app y la cruda de la tabla)", () => {
    const deLaApp = referenciaDe({
      prestamoId: "p1",
      monto: 10_000,
      cuota: 500,
      totalDias: 24,
      frecuencia: "semanal",
    });
    const deLaTabla = referenciaDe({
      id: "p1",
      monto_prestado: 10_000,
      cuota_diaria: 500,
      total_dias: 24,
      frecuencia: "semanal",
    });
    expect(deLaApp).toEqual(deLaTabla);
    // Y el formato viaja: era justo el campo que una de las copias se olvidaba.
    expect(deLaApp?.frecuencia).toBe("semanal");
  });

  it("una fila sin crédito real no es referencia (no abre techo de la nada)", () => {
    expect(referenciaDe(null)).toBeNull();
    expect(referenciaDe({ id: "p1", monto_prestado: 0, cuota_diaria: 0, total_dias: 0 })).toBeNull();
  });

  // ⚠️ La cuota que el módulo resuelve es la que la capa de datos va a escribir.
  // Si el módulo redondea la referencia y la capa de datos no, las dos calculan
  // la tasa desde bases distintas y el crédito nace con $1 de diferencia. Pasa en
  // los 53 créditos activos con cuota fraccionaria heredada de Disapp.
  it("⚠️ con cuota heredada FRACCIONARIA, el módulo calcula lo mismo que la capa de datos", () => {
    const CASOS = [
      { nombre: "ANA BETANCOURT", monto: 370_500, cuota: 507.53, totalDias: 730 },
      { nombre: "ELIZABETH RAFFO", monto: 692_800, cuota: 2_000.21, totalDias: 381 },
      { nombre: "INO CURBELO", monto: 1_700_000, cuota: 48_571.43, totalDias: 35 },
      { nombre: "PATRICIA CALDERON", monto: 100_000, cuota: 3_333.33, totalDias: 36 },
    ];
    for (const c of CASOS) {
      const ref = referenciaDe({
        id: "p1",
        monto_prestado: c.monto,
        cuota_diaria: c.cuota,
        total_dias: c.totalDias,
        frecuencia: "diario",
      })!;
      // Lo que resuelve el módulo, repitiendo el crédito tal cual.
      const r = resolverCredito({
        via: "renovacion",
        autoridad: "gestor",
        clienteId: "cli",
        cobradorId: "cob",
        actorId: "act",
        monto: null,
        totalDias: null,
        frecuencia: null,
        referencia: ref,
        hoy: new Date("2026-09-08T12:00:00Z"),
      });
      expect(r.via, c.nombre).toBe("crear");
      if (r.via !== "crear") continue;

      // Lo que calcularía `crearRenovacion` con los valores CRUDOS de la base:
      // se importa la función real, nunca se copia la fórmula (regla de la casa).
      const deLaCapaDeDatos = calcularCuotaRenovacion(
        { monto: c.monto, cuota: c.cuota, totalDias: c.totalDias },
        r.terminos.monto,
        r.terminos.totalDias,
      );
      expect(r.terminos.cuota, `${c.nombre}: el módulo y la capa de datos difieren`).toBe(
        deLaCapaDeDatos,
      );
    }
  });
});
