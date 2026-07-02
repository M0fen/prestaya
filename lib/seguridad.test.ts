// Test del sanitizador de enlaces de anuncios (defensa contra XSS por href).
import { describe, expect, it } from "vitest";
import { hrefSeguro } from "./seguridad";

describe("hrefSeguro", () => {
  it("permite http(s), mailto y tel", () => {
    expect(hrefSeguro("https://prestaya.uy/promo")).toBe("https://prestaya.uy/promo");
    expect(hrefSeguro("http://x.com")).toBe("http://x.com");
    expect(hrefSeguro("mailto:hola@prestaya.uy")).toBe("mailto:hola@prestaya.uy");
    expect(hrefSeguro("tel:+59824021830")).toBe("tel:+59824021830");
  });

  it("permite rutas internas (ancla, absoluta y relativa)", () => {
    expect(hrefSeguro("#")).toBe("#");
    expect(hrefSeguro("/beneficios")).toBe("/beneficios");
    expect(hrefSeguro("./juego")).toBe("./juego");
  });

  it("bloquea esquemas peligrosos (XSS)", () => {
    expect(hrefSeguro("javascript:alert(1)")).toBeNull();
    expect(hrefSeguro("  JavaScript:alert(1)")).toBeNull(); // trim + case
    expect(hrefSeguro("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(hrefSeguro("vbscript:msgbox(1)")).toBeNull();
    expect(hrefSeguro("//evil.com")).toBeNull(); // protocolo-relativo
  });

  it("trata vacío / nulo como sin enlace", () => {
    expect(hrefSeguro(null)).toBeNull();
    expect(hrefSeguro(undefined)).toBeNull();
    expect(hrefSeguro("   ")).toBeNull();
  });
});
