// ─────────────────────────────────────────────────────────────────────────
//  GUARDIÁN DE TEXTOS — que la pantalla no le dé al cobrador una instrucción de
//  dinero que la regla ya no respalda.
//
//  Regla de Carlos (06-09): por encima del +20% el crédito NACE y sólo se avisa.
//  Antes, tres pantallas decían "lo aprueba tu supervisor", "la plata se entrega
//  después del OK", "Todavía NO le entregues la plata". Si una sola de esas
//  frases sobrevive, el cobrador NO entrega la plata de un crédito que ya está
//  corriendo — y el cliente empieza a pagar mañana algo que no recibió (el
//  inverso exacto del duplicado de JORGE, 06→09-08).
//
//  Misma técnica que credito.puertas.test.ts: se lee el CÓDIGO FUENTE. Los
//  comentarios se descartan, porque cuentan la historia y la nombran a propósito.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..");

/** Lo que el cobrador ve cuando coloca. `cobradorCredito.ts` NO está a
 *  propósito: su "NO le entregues la plata hasta verlo" es de OTRO caso (el
 *  crédito ya lo renovó un compañero) y ahí sigue siendo el consejo correcto. */
const PANTALLAS = [
  "components/cobrador/ColocarLista.tsx",
  "app/cobrador/(app)/cliente/[id]/page.tsx",
  // El pie de esta página decía "no entregues la plata hasta que lo aprueben"
  // DEBAJO de la tarjeta que decía "Entregale la plata". Lo cazó la revisión.
  "app/cobrador/(app)/colocar/page.tsx",
  // La guía enseñaba el circuito viejo paso por paso.
  "lib/tutorial/contenido.ts",
  // Las novedades se muestran a TODOS al subir la versión: una que prometa
  // "queda en firme apenas lo apruebe" es la instrucción vieja en primer plano.
  "lib/novedades.ts",
  "lib/domain/credito.ts",
];

/** Frases que prometen una aprobación previa que ya no existe. */
const PROHIBIDAS = [
  /lo (puede )?aprueba tu supervisor/i,
  /puede aprobar hasta/i,
  /la plata se entrega después del OK/i,
  /NO le entregues la plata/,
  /no entregues\s+la plata hasta/i,
  /Pedir .* a mi supervisor/,
  /pedirle más a tu supervisor/i,
  /queda en firme (apenas|cuando) lo apruebe/i,
  /le manda el pedido a tu supervisor/i,
  /via: "solicitud"/,
];

function codigoSinComentarios(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
}

describe("guardián de textos — ninguna pantalla promete una aprobación que no existe", () => {
  for (const rel of PANTALLAS) {
    it(`${rel} no le dice al cobrador que espere un OK ni que retenga la plata`, () => {
      const codigo = codigoSinComentarios(rel);
      const culpables = PROHIBIDAS.filter((re) => re.test(codigo)).map(String);
      expect(
        culpables,
        `${rel} todavía dice ${culpables.join(", ")}. Desde el 06-09 el crédito nace igual: ` +
          `esa frase hace que el cobrador NO entregue plata de un crédito que ya corre.`,
      ).toEqual([]);
    });
  }

  it("la pantalla de colocar dice, con esas palabras, que se avisa y que entregue la plata", () => {
    const codigo = codigoSinComentarios("components/cobrador/ColocarLista.tsx");
    expect(codigo).toMatch(/le avisamos a tu supervisor|aviso a tu supervisor/);
    expect(codigo).toMatch(/Entregale la plata/);
  });
});
