import { describe, it, expect } from "vitest";
import qrcode from "qrcode-generator";
import { matrizQR, MARGEN_QR } from "./qr";

/** Reconstruye el conjunto de módulos oscuros desde el path, en coordenadas de
 *  la MATRIZ (sin el margen) → permite verificar la estructura del QR. */
function oscuros(path: string): Set<string> {
  const s = new Set<string>();
  for (const m of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    s.add(`${Number(m[2]) - MARGEN_QR},${Number(m[1]) - MARGEN_QR}`); // fila,col
  }
  return s;
}

const URL_DEMO = "https://app.prestaya.uy/c/9f2c1a7b4e6d8a0c3b5f7e9d1a2c4b6d";

describe("matrizQR — estructura del código (lo que mira el lector)", () => {
  const qr = matrizQR(URL_DEMO);
  const dark = oscuros(qr.path);
  const esOscuro = (f: number, c: number) => dark.has(`${f},${c}`);

  it("el lado es una versión válida de QR (17 + 4v) y entra el margen de 4", () => {
    expect((qr.lado - 17) % 4).toBe(0);
    expect(qr.lado).toBeGreaterThanOrEqual(21);
    expect(qr.margen).toBe(4);
    expect(qr.vista).toBe(qr.lado + 8);
  });

  it("dibuja los 3 patrones de BÚSQUEDA (finder) — sin ellos no engancha", () => {
    // Anillo 7×7 oscuro, anillo 5×5 claro, centro 3×3 oscuro.
    const finder = (f0: number, c0: number) => {
      for (let f = 0; f < 7; f++) {
        for (let c = 0; c < 7; c++) {
          const borde = f === 0 || f === 6 || c === 0 || c === 6;
          const centro = f >= 2 && f <= 4 && c >= 2 && c <= 4;
          expect(esOscuro(f0 + f, c0 + c)).toBe(borde || centro);
        }
      }
    };
    finder(0, 0); // arriba-izquierda
    finder(0, qr.lado - 7); // arriba-derecha
    finder(qr.lado - 7, 0); // abajo-izquierda
  });

  it("dibuja el patrón de TIEMPO (fila y columna 6, alternado)", () => {
    for (let c = 8; c < qr.lado - 8; c++) expect(esOscuro(6, c)).toBe(c % 2 === 0);
    for (let f = 8; f < qr.lado - 8; f++) expect(esOscuro(f, 6)).toBe(f % 2 === 0);
  });

  it("deja el SEPARADOR blanco alrededor del finder (fila/columna 7)", () => {
    for (let c = 0; c <= 7; c++) expect(esOscuro(7, c)).toBe(false);
    for (let f = 0; f <= 7; f++) expect(esOscuro(f, 7)).toBe(false);
  });

  it("aplica el margen: ningún módulo se dibuja pegado al borde del viewBox", () => {
    for (const m of qr.path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
      const [x, y] = [Number(m[1]), Number(m[2])];
      expect(x).toBeGreaterThanOrEqual(MARGEN_QR);
      expect(y).toBeGreaterThanOrEqual(MARGEN_QR);
      expect(x).toBeLessThan(qr.vista - MARGEN_QR);
      expect(y).toBeLessThan(qr.vista - MARGEN_QR);
    }
  });
});

describe("matrizQR — el path dibuja la matriz COMPLETA", () => {
  it("coincide módulo a módulo con el encoder (incluida la zona de datos)", () => {
    // Contra-verificación independiente: el path que dibujamos tiene que ser
    // exactamente el mismo conjunto de módulos oscuros que calcula el encoder.
    // Los patrones fijos (finder/timing) los cubren los tests de arriba; esto
    // cubre los ~500 módulos de DATOS, donde vive el link del cliente.
    const ref = qrcode(0, "M");
    ref.addData(URL_DEMO);
    ref.make();
    const n = ref.getModuleCount();

    const dark = oscuros(matrizQR(URL_DEMO).path);
    let esperados = 0;
    for (let f = 0; f < n; f++) {
      for (let c = 0; c < n; c++) {
        if (ref.isDark(f, c)) esperados++;
        expect(dark.has(`${f},${c}`)).toBe(ref.isDark(f, c));
      }
    }
    expect(dark.size).toBe(esperados); // ni uno de más
  });
});

describe("matrizQR — contrato", () => {
  it("es DETERMINISTA: el mismo link da siempre el mismo código", () => {
    expect(matrizQR(URL_DEMO).path).toBe(matrizQR(URL_DEMO).path);
  });

  it("links distintos dan códigos distintos (cada cliente, el suyo)", () => {
    const a = matrizQR("https://app.prestaya.uy/c/aaaa1111");
    const b = matrizQR("https://app.prestaya.uy/c/bbbb2222");
    expect(a.path).not.toBe(b.path);
  });

  it("un link más largo necesita una versión más grande (más módulos)", () => {
    const corto = matrizQR("https://a.uy/c/1");
    const largo = matrizQR("https://app.prestaya.uy/c/" + "a".repeat(180));
    expect(largo.lado).toBeGreaterThan(corto.lado);
  });

  it("un nivel de corrección más alto no achica el código", () => {
    expect(matrizQR(URL_DEMO, "H").lado).toBeGreaterThanOrEqual(matrizQR(URL_DEMO, "L").lado);
  });

  it("RECHAZA vacío y no-ASCII en vez de emitir un QR corrupto", () => {
    expect(() => matrizQR("")).toThrow();
    expect(() => matrizQR("https://app.prestaya.uy/c/café")).toThrow(/ASCII/);
  });
});
