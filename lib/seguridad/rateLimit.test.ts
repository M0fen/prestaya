import { describe, it, expect } from "vitest";
import { LimitadorMemoria, ipDesdeHeaders, permitir, BUCKETS } from "./rateLimit";

describe("LimitadorMemoria — dispara y bloquea", () => {
  it("permite hasta el límite y bloquea el siguiente", () => {
    const l = new LimitadorMemoria();
    const t0 = 1_000_000;
    // límite 3 en 60s
    expect(l.permitir("k", 3, 60, t0)).toBe(true);
    expect(l.permitir("k", 3, 60, t0 + 1000)).toBe(true);
    expect(l.permitir("k", 3, 60, t0 + 2000)).toBe(true);
    expect(l.permitir("k", 3, 60, t0 + 3000)).toBe(false); // 4º → bloqueado
  });

  it("reinicia al pasar la ventana", () => {
    const l = new LimitadorMemoria();
    const t0 = 1_000_000;
    expect(l.permitir("k", 1, 60, t0)).toBe(true);
    expect(l.permitir("k", 1, 60, t0 + 30_000)).toBe(false); // dentro de la ventana
    expect(l.permitir("k", 1, 60, t0 + 61_000)).toBe(true); // ventana nueva
  });

  it("las claves son independientes", () => {
    const l = new LimitadorMemoria();
    const t0 = 1_000_000;
    expect(l.permitir("a", 1, 60, t0)).toBe(true);
    expect(l.permitir("b", 1, 60, t0)).toBe(true); // otra clave, su propio cupo
    expect(l.permitir("a", 1, 60, t0)).toBe(false);
  });
});

describe("permitir (fallback en memoria, sin Upstash)", () => {
  it("bloquea al superar el bucket de login (5/min)", async () => {
    const id = "ip-test-unica-1";
    const resultados: boolean[] = [];
    for (let i = 0; i < BUCKETS.login.limite + 1; i++) {
      resultados.push(await permitir("login", id));
    }
    expect(resultados.slice(0, BUCKETS.login.limite).every(Boolean)).toBe(true);
    expect(resultados[BUCKETS.login.limite]).toBe(false); // el 6º cae
  });
});

describe("ipDesdeHeaders", () => {
  it("PREFIERE x-real-ip (lo setea Vercel, el cliente no lo falsifica)", () => {
    // Aunque el cliente ANTEPONGA una IP falsa en XFF, gana x-real-ip.
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1", "x-real-ip": "9.9.9.9" });
    expect(ipDesdeHeaders(h)).toBe("9.9.9.9");
  });
  it("fallback a XFF: toma el ÚLTIMO (proxy de confianza), no el leftmost falsificable", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1" });
    expect(ipDesdeHeaders(h)).toBe("10.0.0.1");
  });
  it("sin nada → 'desconocida'", () => {
    expect(ipDesdeHeaders(new Headers())).toBe("desconocida");
  });
});
