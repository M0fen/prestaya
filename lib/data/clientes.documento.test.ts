// ─────────────────────────────────────────────────────────────────────────
//  El censo compara CÉDULAS, no strings. La base convive con dos estilos por
//  el import de Disapp (8.535 fichas en dígitos puros y 1.609 con puntos y
//  guión), y hoy hay 243 personas con ficha DUPLICADA porque la comparación
//  era literal: el cobrador tipea "1.234.567-8", la ficha dice "12345678",
//  no matchean, y entra la misma persona dos veces.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { variantesDocumento } from "./clientes";

/** ¿Estas dos formas de escribir la cédula se reconocen entre sí? */
function seEncuentran(tipeado: string, guardado: string): boolean {
  return variantesDocumento(tipeado).includes(guardado);
}

describe("variantesDocumento — la misma cédula escrita de cualquier forma", () => {
  it("reconoce el formato uruguayo contra los dígitos puros (y al revés)", () => {
    expect(seEncuentran("1.234.567-8", "12345678")).toBe(true);
    expect(seEncuentran("12345678", "1.234.567-8")).toBe(true);
  });

  it("tolera el guión sin puntos y el separador de miles a secas", () => {
    expect(seEncuentran("12345678", "1234567-8")).toBe(true);
    expect(seEncuentran("12345678", "12.345.678")).toBe(true);
    expect(seEncuentran("1234567-8", "12345678")).toBe(true);
    expect(seEncuentran("12.345.678", "1.234.567-8")).toBe(true);
  });

  it("ignora espacios sobrantes al tipear", () => {
    expect(seEncuentran(" 12345678 ", "12345678")).toBe(true);
  });

  it("NO confunde cédulas distintas (no se puede adoptar la ficha de otro)", () => {
    expect(seEncuentran("12345678", "12345679")).toBe(false);
    expect(seEncuentran("1.234.567-8", "8.765.432-1")).toBe(false);
  });

  it("un documento que no es cédula uruguaya se compara tal cual y normalizado", () => {
    const v = variantesDocumento("AB-99.123");
    expect(v).toContain("AB-99.123");
    expect(v).toContain("AB99123");
  });
});
