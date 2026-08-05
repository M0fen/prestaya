import { describe, it, expect } from "vitest";
import { soloDigitos, telWhatsApp, linkWhatsApp } from "./telefono";

describe("telWhatsApp — el número tiene que llegar a WhatsApp", () => {
  it("antepone 598 y saca el 0 del celular local", () => {
    expect(telWhatsApp("099 123 456")).toBe("59899123456");
    expect(telWhatsApp("099123456")).toBe("59899123456");
  });

  it("respeta el número que ya viene con país", () => {
    expect(telWhatsApp("598 99 123 456")).toBe("59899123456");
    expect(telWhatsApp("+598 99 123 456")).toBe("59899123456");
  });

  it("con '+' respeta un país que NO es Uruguay (soporte puede ser +57)", () => {
    expect(telWhatsApp("+57 312 214 3556")).toBe("573122143556");
    // sin '+' se mantiene la regla uruguaya de siempre
    expect(telWhatsApp("57 312")).toBe("59857312");
  });

  it("limpia guiones, paréntesis y espacios", () => {
    expect(telWhatsApp("(099) 123-456")).toBe("59899123456");
  });

  it("sin teléfono devuelve vacío (no arma un número inventado)", () => {
    expect(telWhatsApp(null)).toBe("");
    expect(telWhatsApp("")).toBe("");
    expect(telWhatsApp("sin datos")).toBe("");
  });

  it("soloDigitos deja el número crudo para `tel:`", () => {
    expect(soloDigitos("+598 99-123.456")).toBe("59899123456");
    expect(soloDigitos(undefined)).toBe("");
  });
});

describe("linkWhatsApp", () => {
  it("arma el link con el mensaje codificado", () => {
    const url = linkWhatsApp("099123456", "Hola Ana: tu link es https://x.uy/c/1");
    expect(url.startsWith("https://wa.me/59899123456?text=")).toBe(true);
    expect(url).toContain(encodeURIComponent("https://x.uy/c/1"));
  });

  it("sin teléfono deja elegir el contacto (link sin destinatario)", () => {
    expect(linkWhatsApp(null, "hola")).toBe(`https://wa.me/?text=${encodeURIComponent("hola")}`);
  });
});
