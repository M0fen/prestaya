// ─────────────────────────────────────────────────────────────────────────
//  QUE UN RÓTULO NO VUELVA A DECIR UNA UNIDAD Y MOSTRAR OTRA.
//
//  El error más repetido de la app, y el más difícil de ver leyendo un diff:
//  `calcularEstadosCarton` devuelve UN ELEMENTO POR CUOTA, y cualquier
//  `.filter(...).length` sobre ese arreglo termina rotulado «días». En un
//  crédito semanal, 3 elementos son 3 SEMANAS.
//
//  No es un detalle de redacción: medido contra la base viva, 783 créditos
//  activos NO son diarios (709 semanales, 56 quincenales, 18 mensuales) y
//  cargan el 62,7% del capital en la calle. El rótulo mentía sobre la mayoría
//  del dinero. Y el CLIENTE veía lo correcto en su teléfono («Semana 4/17»)
//  mientras el cobrador que lo atendía leía «4 días».
//
//  Dos guardias: la tabla (que exista y diga cosas distintas por formato) y la
//  estructural (que las pantallas no vuelvan a escribir la unidad a mano).
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  enCuotas,
  enUnidades,
  FRECUENCIAS,
  ROTULO_CUOTA,
  ROTULO_FRECUENCIA,
  UNIDAD_FRECUENCIA,
} from "./credito";

const RAIZ = join(__dirname, "..", "..");
const leer = (p: string) => readFileSync(join(RAIZ, p), "utf8");

describe("la tabla de unidades — una sola, y distinta por formato", () => {
  it("los cuatro formatos tienen unidad propia (ninguno cae a 'día')", () => {
    expect(UNIDAD_FRECUENCIA.diario.plural).toBe("días");
    expect(UNIDAD_FRECUENCIA.semanal.plural).toBe("semanas");
    expect(UNIDAD_FRECUENCIA.quincenal.plural).toBe("quincenas");
    expect(UNIDAD_FRECUENCIA.mensual.plural).toBe("meses");
    // Y son cuatro valores DISTINTOS: si alguien copia una fila, esto lo dice.
    const plurales = FRECUENCIAS.map((f) => UNIDAD_FRECUENCIA[f].plural);
    expect(new Set(plurales).size).toBe(4);
  });

  it("cada formato tiene su rótulo de cuota (no todos 'Cuota diaria')", () => {
    const rotulos = FRECUENCIAS.map((f) => ROTULO_CUOTA[f]);
    expect(new Set(rotulos).size).toBe(4);
    expect(ROTULO_CUOTA.semanal).toBe("Cuota semanal");
  });

  it("cada formato tiene su nombre para mostrar", () => {
    expect(new Set(FRECUENCIAS.map((f) => ROTULO_FRECUENCIA[f])).size).toBe(4);
    expect(ROTULO_FRECUENCIA.semanal).toBe("Semanal");
  });

  it("enUnidades concuerda singular y plural", () => {
    expect(enUnidades(1, "semanal")).toBe("1 semana");
    expect(enUnidades(3, "semanal")).toBe("3 semanas");
    expect(enUnidades(1, "mensual")).toBe("1 mes");
    expect(enUnidades(2, "mensual")).toBe("2 meses");
    expect(enUnidades(1, "diario")).toBe("1 día");
  });

  it("enCuotas concuerda (para cuando lo que se cuenta son cuotas, no tiempo)", () => {
    expect(enCuotas(1)).toBe("1 cuota");
    expect(enCuotas(4)).toBe("4 cuotas");
  });

  it("⚠️ el caso que originó todo: 3 casillas de un semanal son 3 SEMANAS", () => {
    // Si algún día alguien "simplifica" la tabla haciendo que todo sea días,
    // esta afirmación es la que falla.
    expect(enUnidades(3, "semanal")).not.toContain("día");
    expect(enUnidades(3, "quincenal")).not.toContain("día");
    expect(enUnidades(3, "mensual")).not.toContain("día");
  });
});

describe("espejo — la vista del cliente y la del cobrador usan la MISMA tabla", () => {
  it("lib/vistaCliente.ts importa la tabla del dominio, no tiene la suya", () => {
    const src = leer("lib/vistaCliente.ts");
    expect(src).toContain("UNIDAD_FRECUENCIA");
    // La copia local decía exactamente esto. Si vuelve, vuelve la divergencia
    // que hacía que cliente y cobrador leyeran unidades distintas del MISMO dato.
    expect(src).not.toMatch(/diario:\s*\{\s*singular:\s*["']día["']/);
  });
});

describe("guardián estructural — la UI del cobrador no escribe la unidad a mano", () => {
  /** Rótulos que mostraban CUOTAS diciendo «días». Cada uno fue un bug real. */
  const PROHIBIDOS: { patron: RegExp; porQue: string }[] = [
    {
      patron: /label=["']Cuota diaria["']/,
      porQue: "rotulaba los cuatro formatos; usar ROTULO_CUOTA[frecuencia]",
    },
    {
      patron: /["']Días cubiertos["']|Días cubiertos:/,
      porQue: "el número son CUOTAS del cartón, no días",
    },
    {
      patron: /label=["']Días atrasados["']/,
      porQue: "son cuotas atrasadas; en un semanal cada una es una semana",
    },
  ];

  /** Las pantallas que el cobrador y el cliente leen de verdad. */
  const PANTALLAS = [
    "app/cobrador/(app)/cliente/[id]/page.tsx",
    "components/cobrador/OjitoCliente.tsx",
    "app/admin/(panel)/clientes/[id]/estado/page.tsx",
  ];

  for (const pantalla of PANTALLAS) {
    it(`${pantalla} no rotula cuotas como días`, () => {
      const codigo = leer(pantalla)
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
        .join("\n");
      const culpables = PROHIBIDOS.filter((p) => p.patron.test(codigo)).map((p) => p.porQue);
      expect(culpables, `${pantalla}: ${culpables.join(" · ")}`).toEqual([]);
    });
  }

  it("la ficha del cobrador dice el FORMATO del crédito y el próximo vencimiento", () => {
    // Los dos datos que el dueño pidió y que no existían en ninguna parte de la
    // pantalla, aunque la app ya los tenía calculados.
    const src = leer("app/cobrador/(app)/cliente/[id]/page.tsx");
    expect(src).toContain("ROTULO_FRECUENCIA[prestamo.frecuencia]");
    expect(src).toMatch(/Próxima cuota/);
    // Y la marca de corrección administrativa, que se lee con service_role
    // porque la policy de `auditoria` es solo-gestores (con la sesión del
    // cobrador la consulta devuelve cero filas SIN error).
    expect(src).toContain("getCorreccionesDeCreditos");
  });
});
