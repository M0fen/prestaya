// Test de la COLA OFFLINE del cobrador. Simula localStorage (entorno node) y
// fija: encolado con id único + hora de dispositivo, persistencia, quitar,
// contador de intentos y aviso a suscriptores. Junto al test de idempotencia
// (pagos.idempotencia.test.ts) cubre el camino offline de punta a punta.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { encolar, quitar, marcarIntento, pendientes, hidratar, suscribir } from "./colaOffline";

class FakeStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const opBase = {
  tipo: "pago" as const,
  clienteId: "c1",
  clienteNombre: "Ana",
  monto: 500,
  motivo: null,
  gpsLat: null,
  gpsLng: null,
};

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: new FakeStorage() });
  hidratar(); // sincroniza el cache con el storage (vacío)
});
afterEach(() => vi.unstubAllGlobals());

describe("colaOffline", () => {
  it("encola con id único, intentos 0 y hora del dispositivo", () => {
    const antes = Date.now();
    const a = encolar({ ...opBase });
    const b = encolar({ ...opBase, tipo: "no_pago", clienteId: "c2", clienteNombre: "Beto", monto: null, motivo: "no_estaba" });
    expect(pendientes()).toHaveLength(2);
    expect(a.id).not.toBe(b.id);
    expect(a.intentos).toBe(0);
    expect(a.deviceTs).toBeGreaterThanOrEqual(antes);
  });

  it("persiste la cola en localStorage (sobrevive a recargar)", () => {
    encolar({ ...opBase });
    const raw = window.localStorage.getItem("py_cola_cobros");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toHaveLength(1);
  });

  it("quitar saca una op; marcarIntento incrementa el contador", () => {
    const a = encolar({ ...opBase });
    encolar({ ...opBase, clienteId: "c2" });
    quitar(a.id);
    expect(pendientes()).toHaveLength(1);
    const resto = pendientes()[0];
    marcarIntento(resto.id);
    expect(pendientes()[0].intentos).toBe(1);
  });

  it("avisa a los suscriptores al cambiar la cola", () => {
    let n = 0;
    const unsub = suscribir(() => n++);
    encolar({ ...opBase });
    expect(n).toBeGreaterThan(0);
    unsub();
  });
});
