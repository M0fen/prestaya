// Test del orden de ruta por cercanía (vecino más cercano). Fija: recorrido
// correcto desde el origen, sin-GPS al final, y degradación sin origen.
import { describe, expect, it } from "vitest";
import { ordenarPorCercania, type NodoRuta } from "./ruta";

// Puntos sobre una línea (misma longitud): la distancia crece con la latitud.
// Montevideo ~ -34.90; usamos pasos chicos para simular cuadras.
const A: NodoRuta = { id: "A", lat: -34.900, lng: -56.16 }; // más al norte
const B: NodoRuta = { id: "B", lat: -34.902, lng: -56.16 };
const C: NodoRuta = { id: "C", lat: -34.904, lng: -56.16 };
const D: NodoRuta = { id: "D", lat: -34.906, lng: -56.16 }; // más al sur

const ids = (ns: NodoRuta[]) => ns.map((n) => n.id);

describe("ordenarPorCercania", () => {
  it("recorre del más cercano al más lejano desde el origen", () => {
    // Origen pegado a A (norte). Orden esperado: A, B, C, D.
    const origen = { lat: -34.8999, lng: -56.16 };
    const r = ordenarPorCercania([C, A, D, B], origen);
    expect(ids(r)).toEqual(["A", "B", "C", "D"]);
  });

  it("desde el otro extremo invierte el recorrido", () => {
    const origen = { lat: -34.9061, lng: -56.16 }; // pegado a D (sur)
    const r = ordenarPorCercania([A, B, C, D], origen);
    expect(ids(r)).toEqual(["D", "C", "B", "A"]);
  });

  it("las paradas sin GPS van al final, en su orden original", () => {
    const sin1: NodoRuta = { id: "S1", lat: null, lng: null };
    const sin2: NodoRuta = { id: "S2", lat: -34.9, lng: null };
    const origen = { lat: -34.8999, lng: -56.16 };
    const r = ordenarPorCercania([sin1, C, sin2, A], origen);
    expect(ids(r)).toEqual(["A", "C", "S1", "S2"]);
  });

  it("sin origen: no reordena (devuelve copia en el orden dado)", () => {
    const entrada = [C, A, D, B];
    const r = ordenarPorCercania(entrada, null);
    expect(ids(r)).toEqual(["C", "A", "D", "B"]);
    expect(r).not.toBe(entrada); // es copia
  });

  it("ningún nodo con GPS: devuelve la lista tal cual", () => {
    const sinGps = [
      { id: "X", lat: null, lng: null },
      { id: "Y", lat: null, lng: null },
    ];
    expect(ids(ordenarPorCercania(sinGps, { lat: -34.9, lng: -56.16 }))).toEqual(["X", "Y"]);
  });
});
