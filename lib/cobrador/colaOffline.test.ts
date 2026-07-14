// Test de la COLA OFFLINE del cobrador. Simula localStorage (entorno node) y
// fija: encolado con id único + hora de dispositivo, persistencia, quitar,
// contador de intentos y aviso a suscriptores. Junto al test de idempotencia
// (pagos.idempotencia.test.ts) cubre el camino offline de punta a punta.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  encolar,
  quitar,
  marcarIntento,
  pendientes,
  hidratar,
  suscribir,
  parchearGps,
  confirmar,
  suscribirConfirmado,
  _resetParaTests,
} from "./colaOffline";

class FakeStorage {
  m = new Map<string, string>(); // público: los tests inspeccionan las claves
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
  _resetParaTests(); // aísla el estado del módulo (cache + marcas) entre tests
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

  it("holdMs retiene la op: holdHasta = deviceTs + holdMs (sin holdMs, undefined)", () => {
    const conHold = encolar({ ...opBase }, { holdMs: 6000 });
    expect(conHold.holdHasta).toBe(conHold.deviceTs + 6000);
    const sinHold = encolar({ ...opBase, clienteId: "c2" });
    expect(sinHold.holdHasta).toBeUndefined();
  });

  it("parchearGps adjunta el GPS a una op ya encolada; con ambos null no toca nada", () => {
    const a = encolar({ ...opBase });
    parchearGps(a.id, -34.9, -56.2);
    expect(pendientes()[0].gpsLat).toBe(-34.9);
    expect(pendientes()[0].gpsLng).toBe(-56.2);
    parchearGps(a.id, null, null); // lectura fallida: conserva lo anterior
    expect(pendientes()[0].gpsLat).toBe(-34.9);
  });

  it("storage que RECHAZA el guardado (cuota/Safari privado): encolar avisa persistido=false, no simula éxito ni pierde en memoria", () => {
    // getItem funciona pero setItem siempre tira (Safari privado tiene quota 0).
    const rota = {
      lecturas: new Map<string, string>(),
      getItem(k: string) {
        return this.lecturas.has(k) ? this.lecturas.get(k)! : null;
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem() {},
    };
    vi.stubGlobal("window", { localStorage: rota });
    hidratar();
    const op = encolar({ ...opBase });
    expect(op.persistido).toBe(false); // ⇒ la UI muestra la advertencia al cobrador
    expect(pendientes()).toHaveLength(1); // sigue en memoria para reintentar en la sesión
  });

  it("cobro NO persistido SOBREVIVE al parchearGps automático (no se pierde de memoria)", () => {
    // El caso que rompía la 1ª versión del fix: tras un cobro que no persistió, el
    // GPS asíncrono dispara un leer()+guardar() interno; sin rescate, borraba la op.
    const rota = {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem() {},
    };
    vi.stubGlobal("window", { localStorage: rota });
    hidratar();
    const op = encolar({ ...opBase });
    expect(op.persistido).toBe(false);
    parchearGps(op.id, -34.9, -56.2); // re-lee y re-guarda por dentro
    expect(pendientes()).toHaveLength(1); // NO se perdió
    expect(pendientes()[0].gpsLat).toBe(-34.9); // y el GPS se adjuntó igual
  });

  it("JSON corrupto: NO se descarta en silencio — cuarentena del crudo + clave viva reseteada + cola usable", () => {
    const store = new FakeStorage();
    store.setItem("py_cola_cobros", "{corrupto no-es-json");
    vi.stubGlobal("window", { localStorage: store });

    const cola = hidratar();
    expect(cola).toHaveLength(0); // la vista viva se resetea (no se puede parsear)
    // pero el crudo quedó PRESERVADO en una clave de cuarentena (recuperable):
    const claves = [...store.m.keys()];
    expect(claves.some((k) => k.startsWith("py_cola_cobros_corrupta_"))).toBe(true);
    // y la clave viva quedó en "[]" para no volver a fallar en la próxima lectura:
    expect(store.getItem("py_cola_cobros")).toBe("[]");
    // se puede seguir cobrando sin romper:
    const op = encolar({ ...opBase });
    expect(op.persistido).toBe(true);
    expect(pendientes()).toHaveLength(1);
  });

  it("confirmar saca la op y avisa la gracia con la op; quitar (Deshacer) no avisa", () => {
    const confirmadas: string[] = [];
    const unsub = suscribirConfirmado((op) => confirmadas.push(op.id));

    const a = encolar({ ...opBase });
    confirmar(a.id); // éxito de sync
    expect(pendientes()).toHaveLength(0);
    expect(confirmadas).toEqual([a.id]);

    const b = encolar({ ...opBase, clienteId: "c2" });
    quitar(b.id); // Deshacer: nunca llegó al libro → sin gracia
    expect(pendientes()).toHaveLength(0);
    expect(confirmadas).toEqual([a.id]); // no se agregó b

    unsub();
  });
});
