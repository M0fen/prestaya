// Test de la geo-cerca. Fija distancias conocidas y, sobre todo, el caso borde
// de la coordenada 0 (que antes se descartaba por `!0 === true`).
import { describe, expect, it } from "vitest";
import { distanciaMetros, evaluarZona, RADIO_ZONA_M } from "./geo";

describe("distanciaMetros", () => {
  it("mismo punto = 0 m", () => {
    expect(distanciaMetros({ lat: -34.9, lng: -56.16 }, { lat: -34.9, lng: -56.16 })).toBe(0);
  });

  it("0.001° de longitud en el ecuador ≈ 111 m", () => {
    const d = distanciaMetros({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
});

describe("evaluarZona", () => {
  it("devuelve null si falta alguna coordenada (null)", () => {
    expect(evaluarZona({ lat: null, lng: -56 }, { lat: -34.9, lng: -56.1 })).toBeNull();
    expect(evaluarZona({ lat: -34.9, lng: -56.1 }, null)).toBeNull();
    expect(evaluarZona(null, null)).toBeNull();
  });

  it("Uruguay: mismo domicilio → en zona; lejos → fuera", () => {
    const casa = { lat: -34.9, lng: -56.16 };
    expect(evaluarZona({ lat: -34.9, lng: -56.16 }, casa)).toEqual({ enZona: true, metros: 0 });
    const lejos = evaluarZona({ lat: -34.95, lng: -56.16 }, casa);
    expect(lejos).not.toBeNull();
    expect(lejos!.enZona).toBe(false); // ~5,5 km > 120 m
  });

  it("BUG FIX: la coordenada 0 es válida, NO se descarta como 'sin dato'", () => {
    // Antes: `!0 === true` devolvía null aunque hubiera GPS real en (0,0).
    const r = evaluarZona({ lat: 0, lng: 0 }, { lat: 0, lng: 0.0005 });
    expect(r).not.toBeNull();
    expect(r!.metros).toBeGreaterThan(0);
    expect(r!.enZona).toBe(true); // ~55 m < 120 m
    expect(RADIO_ZONA_M).toBe(120);
  });
});

describe("evaluarZona · gate de precisión (accuracy)", () => {
  const casa = { lat: -34.9, lng: -56.16 };

  it("señal MALA cerca del borde → indeterminado (enZona null), NO acusa 'fuera'", () => {
    // ~133 m (apenas fuera del radio 120 m); con ±50 m el punto real podría estar
    // dentro → no se afirma nada.
    const r = evaluarZona({ lat: -34.9012, lng: -56.16, precision: 50 }, casa);
    expect(r).not.toBeNull();
    expect(r!.enZona).toBeNull();
  });

  it("señal BUENA cerca del borde → clasifica igual (fuera)", () => {
    const r = evaluarZona({ lat: -34.9012, lng: -56.16, precision: 5 }, casa);
    expect(r!.enZona).toBe(false);
  });

  it("lejos con señal moderada → sigue 'fuera' (no se pierde la fuga real)", () => {
    const r = evaluarZona({ lat: -34.95, lng: -56.16, precision: 100 }, casa);
    expect(r!.enZona).toBe(false);
  });

  it("dentro con señal mala → indeterminado (no da falso 'en zona')", () => {
    // ~33 m del domicilio, pero con ±100 m podría caer fuera → null.
    const r = evaluarZona({ lat: -34.9003, lng: -56.16, precision: 100 }, casa);
    expect(r!.enZona).toBeNull();
  });

  it("dentro con señal buena → 'en zona'", () => {
    const r = evaluarZona({ lat: -34.9003, lng: -56.16, precision: 20 }, casa);
    expect(r!.enZona).toBe(true);
  });

  it("sin precisión (fix viejo sin el dato) → evalúa como antes", () => {
    const r = evaluarZona({ lat: -34.9012, lng: -56.16 }, casa);
    expect(r!.enZona).toBe(false); // ~133 m > 120 m, clasificación clásica
  });
});
