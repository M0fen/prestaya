import { describe, it, expect } from "vitest";
import { csvCampo, filasACsv, conBom } from "./csv";

describe("csvCampo", () => {
  it("deja texto simple sin comillas", () => {
    expect(csvCampo("Mauricio")).toBe("Mauricio");
    expect(csvCampo(1500)).toBe("1500");
    expect(csvCampo(null)).toBe("");
    expect(csvCampo(undefined)).toBe("");
  });

  it("envuelve y escapa cuando hay separador, comillas o saltos", () => {
    // El nombre con ";" no debe partir la columna.
    expect(csvCampo("Pérez; hijo")).toBe('"Pérez; hijo"');
    // Las comillas internas se duplican.
    expect(csvCampo('Casa "azul"')).toBe('"Casa ""azul"""');
    expect(csvCampo("línea1\nlínea2")).toBe('"línea1\nlínea2"');
  });
});

describe("filasACsv", () => {
  it("arma encabezado + filas con ; y CRLF", () => {
    const csv = filasACsv(
      ["Cliente", "Saldo"],
      [
        ["Ana", 1000],
        ["Beto; el grande", 2000],
      ],
    );
    expect(csv).toBe('Cliente;Saldo\r\nAna;1000\r\n"Beto; el grande";2000');
  });
});

describe("conBom", () => {
  it("antepone el BOM UTF-8", () => {
    expect(conBom("a;b")).toBe("﻿a;b");
  });
});
