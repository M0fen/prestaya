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
