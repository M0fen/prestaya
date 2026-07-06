// Tests del núcleo PURO del score de sospecha (bitácora de campo). Cubren cada
// señal: fuera de zona, planchado, sin moverse, sin GPS, horario raro.
import { describe, it, expect } from "vitest";
import { analizarSospecha, distanciaM, type EventoBitacora } from "./sospecha";

// Helper: cobro con hora UY (le sumamos 3h para pasar a UTC ISO).
function cobro(horaUY: number, min: number, extra: Partial<EventoBitacora> = {}): EventoBitacora {
  const utc = String(horaUY + 3).padStart(2, "0"); // UY = UTC-3
  return {
    accion: "cobro",
    serverTs: `2026-07-02T${utc}:${String(min).padStart(2, "0")}:00.000Z`,
    gpsLat: -34.9, gpsLng: -56.16, gpsDenegado: false, enZona: true, clienteId: "c" + min,
    ...extra,
  };
}

describe("distanciaM (haversine)", () => {
  it("mismo punto = 0", () => {
    expect(distanciaM(-34.9, -56.16, -34.9, -56.16)).toBe(0);
  });
  it("~111 m por 0.001° de latitud", () => {
    const d = distanciaM(-34.9, -56.16, -34.901, -56.16);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});

describe("analizarSospecha", () => {
  it("jornada normal → ok, score bajo", () => {
    const evs = [
      cobro(9, 0, { clienteId: "a", gpsLat: -34.90, gpsLng: -56.16 }),
      cobro(9, 20, { clienteId: "b", gpsLat: -34.91, gpsLng: -56.17 }),
      cobro(10, 5, { clienteId: "c", gpsLat: -34.92, gpsLng: -56.18 }),
    ];
    const s = analizarSospecha(evs);
    expect(s.nivel).toBe("ok");
    expect(s.planchado).toBe(false);
    expect(s.fueraDeZona).toBe(0);
  });

  it("planchado: 6 cobros en 10 min → alerta", () => {
    const evs = [0, 1, 2, 3, 4, 5].map((m) => cobro(9, m, { clienteId: "c" + m, gpsLat: -34.9 - m * 0.01, gpsLng: -56.16 }));
    const s = analizarSospecha(evs);
    expect(s.planchado).toBe(true);
    expect(s.nivel).toBe("alerta");
    expect(s.motivos.some((m) => m.includes("Planchado"))).toBe(true);
  });

  it("cobros fuera de zona suman al score", () => {
    const evs = [
      cobro(9, 0, { enZona: false, clienteId: "a" }),
      cobro(9, 30, { enZona: false, clienteId: "b", gpsLat: -34.95, gpsLng: -56.2 }),
    ];
    const s = analizarSospecha(evs);
    expect(s.fueraDeZona).toBe(2);
    expect(s.score).toBeGreaterThanOrEqual(30);
  });

  it("sin moverse: clientes distintos casi en el mismo punto", () => {
    const evs = [
      cobro(9, 0, { clienteId: "a", gpsLat: -34.9000, gpsLng: -56.1600 }),
      cobro(9, 15, { clienteId: "b", gpsLat: -34.9001, gpsLng: -56.1600 }), // ~11 m
      cobro(9, 40, { clienteId: "c", gpsLat: -34.9001, gpsLng: -56.1600 }), // ~0 m
    ];
    const s = analizarSospecha(evs);
    expect(s.sinMovimiento).toBe(2);
  });

  it("GPS apagado: cuenta acciones de campo sin GPS", () => {
    const evs = [
      cobro(9, 0, { gpsDenegado: true, gpsLat: null, gpsLng: null }),
      cobro(9, 30, { clienteId: "b", gpsLat: -34.91, gpsLng: -56.17 }),
    ];
    const s = analizarSospecha(evs);
    expect(s.sinGps).toBe(1);
  });

  it("horario raro: cobro a las 3am", () => {
    const s = analizarSospecha([cobro(3, 0, { clienteId: "a" })]);
    expect(s.horarioRaro).toBe(1);
  });

  it("sin eventos → todo en cero, ok", () => {
    const s = analizarSospecha([]);
    expect(s.cobros).toBe(0);
    expect(s.nivel).toBe("ok");
    expect(s.motivos).toHaveLength(0);
  });
});
