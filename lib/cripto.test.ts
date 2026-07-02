// Test del cifrado del chat (AES-256-GCM). Fija ida y vuelta, que el texto
// cifrado NO contiene el plano, la compatibilidad con mensajes viejos en claro
// y la detección de manipulación (tag GCM).
import { randomBytes } from "node:crypto";
// Clave de prueba ANTES de usar el módulo (clave() la resuelve perezosamente).
process.env.CHAT_SECRET_KEY = randomBytes(32).toString("base64");

import { describe, it, expect } from "vitest";
import { cifrar, descifrar, cifradoActivo } from "./cripto";

describe("cripto (chat)", () => {
  it("con clave configurada, el cifrado está activo", () => {
    expect(cifradoActivo()).toBe(true);
  });

  it("cifra y descifra ida y vuelta (con acentos y emojis)", () => {
    const texto = "Hola equipo 👋 pasá por lo de María a las 3.";
    const blob = cifrar(texto);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain("María");
    expect(descifrar(blob)).toBe(texto);
  });

  it("dos cifrados del mismo texto dan distinto (IV aleatorio)", () => {
    const a = cifrar("mismo mensaje");
    const b = cifrar("mismo mensaje");
    expect(a).not.toBe(b);
    expect(descifrar(a)).toBe("mismo mensaje");
    expect(descifrar(b)).toBe("mismo mensaje");
  });

  it("mensaje viejo en texto plano se devuelve tal cual", () => {
    expect(descifrar("mensaje viejo sin cifrar")).toBe("mensaje viejo sin cifrar");
  });

  it("un texto cifrado manipulado no se descifra (marcador, no crash)", () => {
    const blob = cifrar("secreto");
    // Corrompemos el ciphertext (último bloque).
    const roto = blob.slice(0, -3) + "AAA";
    expect(descifrar(roto)).toBe("[mensaje ilegible]");
  });
});
