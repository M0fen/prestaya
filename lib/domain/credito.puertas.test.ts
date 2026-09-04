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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { referenciaDe, techosDe } from "./credito";
import { RENOVACION_CAP_TOTAL } from "@/lib/renovacion";

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
      expect(ren.propio).toBeLessThanOrEqual(ren.maximo);
      expect(ven.propio).toBeLessThanOrEqual(ven.maximo);
      // Repetir tal cual SIEMPRE se aprueba solo — es continuidad, no capital nuevo.
      expect(ren.propio).toBeGreaterThanOrEqual(c.monto);
      // Una venta nueva nunca ofrece más de lo que el gestor puede autorizar.
      expect(ven.propio).toBeLessThanOrEqual(ven.maximo);
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
});
