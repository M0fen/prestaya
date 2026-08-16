// fotoTienda — la transformación que bajó las fotos de 800 KB a ~20 KB (40×,
// medido). Fija el contrato: SOLO nuestro storage se transforma; el resto pasa.
import { describe, expect, it } from "vitest";
import { fotoTienda, FOTO } from "./fotoTienda";

const ORIGINAL =
  "https://kvmqlkqfgjimfpzlwsdt.supabase.co/storage/v1/object/public/tienda/demo/03-smart-tv.png";

describe("fotoTienda", () => {
  it("reescribe a render/image con ancho, ALTO y resize=contain (la geometría completa)", () => {
    // El caso Carlos (16-08): con `width` solo, el endpoint devolvía
    // 480×2048 — productos achatados en toda la vitrina. width+height+contain
    // preserva el aspecto REAL de la foto. Este test fija la URL entera.
    expect(fotoTienda(ORIGINAL, FOTO.tarjeta)).toBe(
      "https://kvmqlkqfgjimfpzlwsdt.supabase.co/storage/v1/render/image/public/tienda/demo/03-smart-tv.png?width=480&height=480&resize=contain&quality=75",
    );
  });

  it("cada superficie pide SU caja (el CDN cachea pocas variantes)", () => {
    expect(fotoTienda(ORIGINAL, FOTO.mini)).toContain("width=128&height=128&resize=contain");
    expect(fotoTienda(ORIGINAL, FOTO.zoom, 85)).toContain("width=1600&height=1600&resize=contain&quality=85");
  });

  it("una URL externa pasa TAL CUAL (no romper fotos de otros hosts)", () => {
    const externa = "https://curbe.uy/fotos/perfume.jpg";
    expect(fotoTienda(externa, 480)).toBe(externa);
  });

  it("null/undefined → null (el llamador muestra su placeholder)", () => {
    expect(fotoTienda(null, 480)).toBeNull();
    expect(fotoTienda(undefined, 480)).toBeNull();
  });

  it("una URL de storage CON query no se toca (no anidar transformaciones)", () => {
    const rara = ORIGINAL + "?token=abc";
    expect(fotoTienda(rara, 480)).toBe(rara);
  });
});
