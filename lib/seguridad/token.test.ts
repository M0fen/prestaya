import { describe, it, expect } from "vitest";
import { nuevoToken } from "./token";
import { tokenValido } from "@/lib/validacion/esquemas";

describe("nuevoToken", () => {
  it("genera 48 caracteres hex", () => {
    expect(nuevoToken()).toMatch(/^[a-f0-9]{48}$/);
  });

  it("tiene la forma que acepta la validación del token del cliente", () => {
    expect(tokenValido(nuevoToken())).toBe(true);
  });

  it("cada token es distinto (imprevisible)", () => {
    const muestras = new Set(Array.from({ length: 50 }, () => nuevoToken()));
    expect(muestras.size).toBe(50);
  });
});
