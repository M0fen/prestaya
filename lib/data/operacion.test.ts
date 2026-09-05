// ─────────────────────────────────────────────────────────────────────────
//  Lo invisible, a la vista — las reglas que no pueden cambiar sin que alguien
//  se entere.
//
//  Lo que fija este archivo:
//   · el panel se ordena por PLATA EN RIESGO, no por días. Si mañana alguien lo
//     ordena por antigüedad, el que tiene $3M sin mirar se va al fondo.
//   · el que NUNCA usó la app va SEPARADO y al final: es adopción, no abandono,
//     y mezclarlos convierte la lista en ruido (27 de 47 cobradores están así).
//   · un cliente sin ruta con crédito ACTIVO es lo urgente y se separa del
//     padrón heredado (10.597 fichas que nadie va a mirar).
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdmin: () => adminDb }));
vi.mock("@/lib/observabilidad", () => ({ reportarError: vi.fn() }));

type Fila = Record<string, unknown>;
const TABLAS: Record<string, Fila[]> = {};

/** Doble mínimo de PostgREST: encadena filtros y devuelve lo que matchea. */
function query(tabla: string) {
  let filas = [...(TABLAS[tabla] ?? [])];
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => {
      filas = filas.filter((f) => f[c] === v);
      return b;
    },
    is: (c: string, v: unknown) => {
      filas = filas.filter((f) => (v === null ? f[c] == null : f[c] === v));
      return b;
    },
    in: (c: string, vs: unknown[]) => {
      filas = filas.filter((f) => vs.includes(f[c]));
      return b;
    },
    order: () => b,
    limit: () => b,
    range: (d: number, h: number) => {
      const trozo = filas.slice(d, h + 1);
      return Promise.resolve({ data: trozo, error: null });
    },
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: filas, error: null }).then(ok),
  };
  return b;
}
const adminDb = { from: (t: string) => query(t) } as unknown as SupabaseClient;
const db = adminDb;

import { getClientesSinRuta, getCobradoresEnSilencio } from "./operacion";

function sembrar(datos: Record<string, Fila[]>) {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  Object.assign(TABLAS, datos);
}

const HOY = new Date();
const haceDias = (n: number) => new Date(HOY.getTime() - n * 86_400_000).toISOString();

describe("getCobradoresEnSilencio — ordena por plata, no por días", () => {
  it("⚠️ el que tiene MÁS plata sin mirar va primero, aunque haga menos que no cobra", () => {
    // Es la regla central: el supervisor tiene tiempo para llamar a dos personas,
    // no a cuarenta. La lista tiene que decirle a cuáles.
    sembrar({
      usuarios: [
        { id: "c1", nombre: "Poca plata", rol: "cobrador", activo: true, zona_id: "z1", zonas: null },
        { id: "c2", nombre: "Mucha plata", rol: "cobrador", activo: true, zona_id: "z1", zonas: null },
      ],
      prestamos: [
        { cobrador_id: "c1", estado: "activo", cuota_diaria: 100, total_dias: 10, pagado_acum: 0 },
        { cobrador_id: "c2", estado: "activo", cuota_diaria: 5000, total_dias: 10, pagado_acum: 0 },
      ],
      asignaciones: [
        { cobrador_id: "c1", cliente_id: "x1", activo: true },
        { cobrador_id: "c2", cliente_id: "x2", activo: true },
      ],
      // c1 hace MÁS que no cobra (30 días) que c2 (5 días).
      pagos: [
        { registrado_por: "c1", registrado_en: haceDias(30), anulado: false, origen: null },
        { registrado_por: "c2", registrado_en: haceDias(5), anulado: false, origen: null },
      ],
    });
    return getCobradoresEnSilencio(db, { global: true }).then((r) => {
      expect(r.map((x) => x.nombre)).toEqual(["Mucha plata", "Poca plata"]);
      expect(r[0].capitalVivo).toBe(50_000);
      expect(r[0].diasSinCobrar).toBe(5);
    });
  });

  it("el que NUNCA cobró va al final: es adopción, no abandono", async () => {
    sembrar({
      usuarios: [
        { id: "c1", nombre: "Nunca usó", rol: "cobrador", activo: true, zona_id: "z1", zonas: null },
        { id: "c2", nombre: "Sí usó", rol: "cobrador", activo: true, zona_id: "z1", zonas: null },
      ],
      // El que nunca usó tiene MUCHA más plata: aun así va al final, porque
      // mezclarlos hace que la lista deje de servir para decidir a quién llamar.
      prestamos: [
        { cobrador_id: "c1", estado: "activo", cuota_diaria: 9000, total_dias: 10, pagado_acum: 0 },
        { cobrador_id: "c2", estado: "activo", cuota_diaria: 100, total_dias: 10, pagado_acum: 0 },
      ],
      asignaciones: [
        { cobrador_id: "c1", cliente_id: "x1", activo: true },
        { cobrador_id: "c2", cliente_id: "x2", activo: true },
      ],
      pagos: [{ registrado_por: "c2", registrado_en: haceDias(9), anulado: false, origen: null }],
    });
    const r = await getCobradoresEnSilencio(db, { global: true });
    expect(r.map((x) => x.nombre)).toEqual(["Sí usó", "Nunca usó"]);
    expect(r[1].diasSinCobrar).toBeNull();
    expect(r[1].ultimoCobro).toBeNull();
  });

  it("los pagos IMPORTADOS no cuentan como actividad (no los hizo en la calle)", async () => {
    sembrar({
      usuarios: [{ id: "c1", nombre: "Solo import", rol: "cobrador", activo: true, zona_id: "z1", zonas: null }],
      prestamos: [{ cobrador_id: "c1", estado: "activo", cuota_diaria: 100, total_dias: 10, pagado_acum: 0 }],
      asignaciones: [{ cobrador_id: "c1", cliente_id: "x1", activo: true }],
      pagos: [{ registrado_por: "c1", registrado_en: haceDias(1), anulado: false, origen: "disapp_import" }],
    });
    const r = await getCobradoresEnSilencio(db, { global: true });
    expect(r[0].diasSinCobrar).toBeNull(); // el import no es trabajo suyo de hoy
  });

  it("un supervisor solo ve a los cobradores de su alcance", async () => {
    sembrar({
      usuarios: [
        { id: "c1", nombre: "Mío", rol: "cobrador", activo: true, zona_id: "z1", zonas: null },
        { id: "c2", nombre: "De otra zona", rol: "cobrador", activo: true, zona_id: "z2", zonas: null },
      ],
      prestamos: [],
      asignaciones: [
        { cobrador_id: "c1", cliente_id: "x1", activo: true },
        { cobrador_id: "c2", cliente_id: "x2", activo: true },
      ],
      pagos: [],
    });
    const r = await getCobradoresEnSilencio(db, {
      global: false,
      zonas: ["z1"],
      cobradorIds: ["c1"],
      clienteIds: ["x1"],
    });
    expect(r.map((x) => x.nombre)).toEqual(["Mío"]);
  });

  it("un supervisor sin cobradores no ve nada (y no revienta)", async () => {
    sembrar({ usuarios: [], prestamos: [], asignaciones: [], pagos: [] });
    const r = await getCobradoresEnSilencio(db, {
      global: false,
      zonas: [],
      cobradorIds: [],
      clienteIds: [],
    });
    expect(r).toEqual([]);
  });
});

describe("getClientesSinRuta — lo urgente separado del padrón", () => {
  it("⚠️ un cliente sin ruta CON crédito activo es plata que nadie ve: va aparte", async () => {
    sembrar({
      asignaciones: [{ cliente_id: "cli-ok", cobrador_id: "c1", activo: true }],
      clientes: [
        { id: "cli-ok", nombre: "En ruta", documento: "1", activo: true },
        { id: "cli-plata", nombre: "Sin ruta con plata", documento: "2", activo: true },
        { id: "cli-ex", nombre: "Ex cliente", documento: "3", activo: true },
        { id: "cli-padron", nombre: "Solo padrón", documento: "4", activo: true },
      ],
      prestamos: [
        { cliente_id: "cli-ok", estado: "activo", cuota_diaria: 100, total_dias: 10, pagado_acum: 0 },
        { cliente_id: "cli-plata", estado: "activo", cuota_diaria: 500, total_dias: 10, pagado_acum: 1000 },
        { cliente_id: "cli-ex", estado: "finalizado", cuota_diaria: 100, total_dias: 10, pagado_acum: 1000 },
      ],
    });
    const r = await getClientesSinRuta();

    expect(r.conPlataViva.map((c) => c.nombre)).toEqual(["Sin ruta con plata"]);
    expect(r.conPlataViva[0].capitalVivo).toBe(4000); // 500×10 − 1000
    expect(r.exClientes.map((c) => c.nombre)).toEqual(["Ex cliente"]);
    expect(r.total).toBe(3); // los tres que no están en ninguna ruta
    expect(r.soloPadron).toBe(1); // el que nunca tuvo crédito
  });

  it("si todos están en ruta, no hay nada que mostrar", async () => {
    sembrar({
      asignaciones: [{ cliente_id: "cli-1", cobrador_id: "c1", activo: true }],
      clientes: [{ id: "cli-1", nombre: "En ruta", documento: "1", activo: true }],
      prestamos: [],
    });
    const r = await getClientesSinRuta();
    expect(r).toEqual({ conPlataViva: [], exClientes: [], total: 0, soloPadron: 0 });
  });

  it("una asignación INACTIVA no cuenta como estar en ruta", async () => {
    sembrar({
      asignaciones: [{ cliente_id: "cli-1", cobrador_id: "c1", activo: false }],
      clientes: [{ id: "cli-1", nombre: "Se le dio de baja la ruta", documento: "1", activo: true }],
      prestamos: [{ cliente_id: "cli-1", estado: "activo", cuota_diaria: 100, total_dias: 10, pagado_acum: 0 }],
    });
    const r = await getClientesSinRuta();
    expect(r.conPlataViva).toHaveLength(1);
    expect(r.conPlataViva[0].capitalVivo).toBe(1000);
  });
});
