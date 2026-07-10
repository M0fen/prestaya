import { describe, it, expect } from "vitest";
import { enteroALetras, montoALetras } from "./numeroALetras";

describe("enteroALetras", () => {
  it("casos base", () => {
    expect(enteroALetras(0)).toBe("cero");
    expect(enteroALetras(15)).toBe("quince");
    expect(enteroALetras(21)).toBe("veintiuno");
    expect(enteroALetras(31)).toBe("treinta y uno");
    expect(enteroALetras(100)).toBe("cien");
    expect(enteroALetras(101)).toBe("ciento uno");
    expect(enteroALetras(500)).toBe("quinientos");
    expect(enteroALetras(2500)).toBe("dos mil quinientos");
    expect(enteroALetras(1000)).toBe("mil");
    expect(enteroALetras(1_000_000)).toBe("un millón");
    expect(enteroALetras(2_345_678)).toBe(
      "dos millones trescientos cuarenta y cinco mil seiscientos setenta y ocho",
    );
  });
});

describe("montoALetras (comprobante)", () => {
  it("concordancia y apócope ante 'pesos'", () => {
    expect(montoALetras(0)).toBe("Cero pesos uruguayos");
    expect(montoALetras(1)).toBe("Un peso uruguayo");
    expect(montoALetras(21)).toBe("Veintiún pesos uruguayos");
    expect(montoALetras(31)).toBe("Treinta y un pesos uruguayos");
    expect(montoALetras(101)).toBe("Ciento un pesos uruguayos");
    expect(montoALetras(100)).toBe("Cien pesos uruguayos");
    expect(montoALetras(2500)).toBe("Dos mil quinientos pesos uruguayos");
  });
  it("centavos → con NN/100", () => {
    expect(montoALetras(1234.5)).toBe("Mil doscientos treinta y cuatro pesos uruguayos con 50/100");
    expect(montoALetras(0.05)).toBe("Cero pesos uruguayos con 05/100");
  });
});
