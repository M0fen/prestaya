// ─────────────────────────────────────────────────────────────────────────
//  CASO DE CAMPO 15-08 (captura del teléfono de Edward Muñoz): MARIA MERCEDES
//  MOREIRA DENIZ, crédito $500 × 24 desde el 12-08 con TRES pagos de $500 (días
//  1, 2 y 3). La pantalla mostraba "Días cubiertos 0/24", 13% pagado y las
//  casillas 1-2-3 GRISES con "500" debajo — y NINGUNA casilla con el anillo de
//  HOY.
//
//  Se midió el caso con datos VIVOS a través del motor real: el servidor da
//  3/24 pagados, 13%, cuota 4 = HOY. Los datos y el motor estaban BIEN; lo que
//  vio Edward fue una COPIA VIEJA de la ficha servida por el service worker (LTE
//  con señal pero sin respuesta → `navigator.onLine` true → fetch falla → el SW
//  sirve la última copia sin marcarla). El arreglo vive en public/sw.js +
//  OfflineBanner (aviso "Sin respuesta de la red · copia guardada · Actualizar").
//
//  Estos tests SELLAN la parte del motor para que, si algún día un cartón vuelve
//  a mostrar "0/24" con pagos, la primera sospecha sea la pantalla y no el
//  cálculo. Reloj FIJO, incluidos los bordes del día UY (corte 03:00 UTC).
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import { calcularEstadosCarton } from "./cartones";
import { hoyUY } from "./fecha";

const MOREIRA = { cuota_diaria: 500, total_dias: 24, fecha_inicio: "2026-08-12", frecuencia: "diario" as const };
const PAGOS = [
  { dia_credito: 1, monto: 500 },
  { dia_credito: 2, monto: 500 },
  { dia_credito: 3, monto: 500 },
];

describe("caso MOREIRA DENIZ: 3 pagos de $500 sobre 500×24 desde el 12-08", () => {
  for (const hoy of ["2026-08-14", "2026-08-15", "2026-08-16"]) {
    it(`con hoy=${hoy} pinta 3 casillas PAGADAS y 3/24 cubiertos`, () => {
      const r = calcularEstadosCarton(MOREIRA, PAGOS, new Date(`${hoy}T12:00:00`));
      const cubiertos = r.dias.filter((d) => d.estado === "pagado").length;
      expect(r.dias.slice(0, 3).map((d) => d.estado)).toEqual(["pagado", "pagado", "pagado"]);
      expect(cubiertos).toBe(3);
      expect(r.progresoPct).toBe(13); // 1.500 / 12.000
      expect(r.falta).toBe(10_500);
    });
  }

  it("el sábado 15 (día de cobro) la cuota 4 es HOY — la captura no tenía ningún HOY: era vieja", () => {
    const r = calcularEstadosCarton(MOREIRA, PAGOS, new Date("2026-08-15T12:00:00"));
    expect(r.dias[3].esHoy).toBe(true);
    expect(r.dias[3].estado).toBe("pendiente"); // hoy nunca es atrasado
  });

  it("el domingo NO cambia nada: los 3 pagados siguen pagados y no hay HOY", () => {
    const r = calcularEstadosCarton(MOREIRA, PAGOS, new Date("2026-08-16T12:00:00")); // domingo
    expect(r.dias.filter((d) => d.estado === "pagado").length).toBe(3);
    expect(r.dias.some((d) => d.esHoy)).toBe(false);
  });

  // Como lo calcula el SERVIDOR (hoyUY sobre el reloj real), en los bordes del
  // día uruguayo: madrugada, justo después del corte 03:00Z, y justo antes.
  it("hoyUY a las 03:45 UY del 15-08 (06:45Z) → 3 pagados", () => {
    const r = calcularEstadosCarton(MOREIRA, PAGOS, hoyUY(new Date("2026-08-15T06:45:00Z")));
    expect(r.dias.slice(0, 3).map((d) => d.estado)).toEqual(["pagado", "pagado", "pagado"]);
  });
  it("hoyUY a las 00:30 UY del 15-08 (03:30Z) → 3 pagados", () => {
    const r = calcularEstadosCarton(MOREIRA, PAGOS, hoyUY(new Date("2026-08-15T03:30:00Z")));
    expect(r.dias.filter((d) => d.estado === "pagado").length).toBe(3);
  });
  it("hoyUY a las 23:30 UY del 14-08 (02:30Z del 15) → 3 pagados (la 3 vence el 14)", () => {
    const r = calcularEstadosCarton(MOREIRA, PAGOS, hoyUY(new Date("2026-08-15T02:30:00Z")));
    expect(r.dias.filter((d) => d.estado === "pagado").length).toBe(3);
  });

  // PROPIEDAD general de la clase de bug: si Σpagos ≥ k·cuota y esas k cuotas
  // ya VENCIERON, el cartón marca al menos k pagadas. Un "0/24 con plata" jamás
  // puede salir del motor con fechas vencidas.
  it("propiedad: plata que cubre k cuotas vencidas → al menos k casillas pagadas", () => {
    for (const k of [1, 2, 3, 5, 10]) {
      const pagos = Array.from({ length: k }, (_, i) => ({ dia_credito: i + 1, monto: 500 }));
      // hoy = un día en que las k cuotas ya vencieron (k días hábiles después del inicio)
      const hoy = new Date("2026-08-12T12:00:00");
      hoy.setDate(hoy.getDate() + k + 2);
      const r = calcularEstadosCarton(MOREIRA, pagos, hoy);
      expect(r.dias.filter((d) => d.estado === "pagado").length).toBeGreaterThanOrEqual(k);
    }
  });
});
