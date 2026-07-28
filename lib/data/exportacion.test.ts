// ─────────────────────────────────────────────────────────────────────────
//  Tests del export del LIBRO DE PAGOS por streaming. Blindan dos cosas:
//   · el generador pagina y JUNTA bien (orden registrado_en desc + join a
//     cliente/documento/cobrador), cruzando el límite de página de 1000;
//   · el CSV ensamblado por streaming (BOM + encabezado, luego cada página) es
//     BYTE-IDÉNTICO a conBom(filasACsv(...)) del camino en memoria previo → el
//     archivo que baja el contador no cambia ni un carácter.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPagosExport, streamPagosExport, type FilaPagoExport } from "./exportacion";
import { filasACsv, conBom, csvLinea, BOM } from "@/lib/reportes/csv";

type Row = Record<string, unknown>;

/** Doble de Supabase que pagina en memoria respetando .order().range() como
 *  PostgREST: ordena por la(s) columna(s) pedidas y devuelve el rango [from,to]. */
function fakeDb(tablas: Record<string, Row[]>) {
  function makeQuery(tabla: string) {
    const ordenes: { col: string; asc: boolean }[] = [];
    const api: Record<string, unknown> = {
      select() { return api; },
      order(col: string, opts?: { ascending?: boolean }) {
        ordenes.push({ col, asc: opts?.ascending ?? true });
        return api;
      },
      range(from: number, to: number) {
        const filas = [...(tablas[tabla] ?? [])];
        filas.sort((a, b) => {
          for (const { col, asc } of ordenes) {
            const av = a[col], bv = b[col];
            if (av === bv) continue;
            const cmp = (av as number | string) < (bv as number | string) ? -1 : 1;
            return asc ? cmp : -cmp;
          }
          return 0;
        });
        return Promise.resolve({ data: filas.slice(from, to + 1), error: null });
      },
    };
    return api;
  }
  return { from: (t: string) => makeQuery(t) } as unknown as SupabaseClient;
}

// Dataset que CRUZA el límite de página (1000): 2.300 pagos con id secuencial y
// registrado_en decreciente para probar el orden estable entre páginas.
function datasetGrande() {
  const N = 2300;
  const pagos: Row[] = [];
  for (let i = 0; i < N; i++) {
    pagos.push({
      id: `pago-${String(i).padStart(5, "0")}`,
      prestamo_id: i % 2 === 0 ? "pre-A" : "pre-B",
      dia_credito: (i % 30) + 1,
      monto: 100 + i,
      anulado: i % 50 === 0,
      registrado_por: i % 3 === 0 ? "u-1" : null,
      // Fecha decreciente: el pago i es más nuevo que el i+1.
      registrado_en: new Date(Date.UTC(2026, 0, 1) + (N - i) * 60000).toISOString(),
    });
  }
  return {
    pagos,
    prestamos: [
      { id: "pre-A", cliente_id: "cli-1" },
      { id: "pre-B", cliente_id: "cli-2" },
    ],
    clientes: [
      { id: "cli-1", nombre: "Ana Pérez", documento: "111" },
      { id: "cli-2", nombre: 'Beto "Grande"; hijo', documento: "222" },
    ],
    usuarios: [{ id: "u-1", nombre: "Mauricio" }],
  };
}

// Reproduce el armado del endpoint (streaming) para comparar con el de memoria.
function csvPorStreamingDesde(paginas: FilaPagoExport[][]): string {
  const encabezados = ["Fecha y hora", "Cliente", "Documento", "Día", "Monto", "Anulado", "Cobrador"];
  const fila = (f: FilaPagoExport) =>
    csvLinea([f.fechaIso, f.cliente, f.documento, f.dia, f.monto, f.anulado ? "sí" : "no", f.cobrador]);
  let out = BOM + csvLinea(encabezados);
  for (const pag of paginas) for (const f of pag) out += "\r\n" + fila(f);
  return out;
}

describe("streamPagosExport — paginación y join", () => {
  it("junta TODAS las páginas (cruza el corte de 1000) en orden fecha desc", async () => {
    const d = datasetGrande();
    const filas = await getPagosExport(fakeDb(d));
    expect(filas).toHaveLength(2300); // no se pierde ni duplica ninguna al paginar
    // Orden: del más reciente al más antiguo (registrado_en desc).
    for (let i = 1; i < filas.length; i++) {
      expect(filas[i - 1].fechaIso >= filas[i].fechaIso).toBe(true);
    }
    // El más nuevo (i=0) es pre-A → Ana; su día y monto salen del pago.
    expect(filas[0].cliente).toBe("Ana Pérez");
    expect(filas[0].documento).toBe("111");
    // Un pago con registrado_por null → cobrador vacío.
    const sinCobrador = filas.find((f) => f.cobrador === "");
    expect(sinCobrador).toBeTruthy();
  });

  it("el cobrador se resuelve por id y el monto se redondea (entero)", async () => {
    const d = {
      pagos: [
        { id: "p1", prestamo_id: "pre-A", dia_credito: 3, monto: 250.7, anulado: false, registrado_por: "u-1", registrado_en: "2026-01-05T10:00:00Z" },
      ],
      prestamos: [{ id: "pre-A", cliente_id: "cli-1" }],
      clientes: [{ id: "cli-1", nombre: "Ana", documento: "111" }],
      usuarios: [{ id: "u-1", nombre: "Mauricio" }],
    };
    const filas = await getPagosExport(fakeDb(d));
    expect(filas[0].cobrador).toBe("Mauricio");
    expect(filas[0].monto).toBe(251); // 250.7 → 251 (entero, como el libro)
  });
});

describe("streamPagosExport — CSV byte-idéntico al armado en memoria", () => {
  it("el streaming produce exactamente conBom(filasACsv(...))", async () => {
    const d = datasetGrande();

    // Camino en memoria (previo): junta todo y arma el CSV de una.
    const filas = await getPagosExport(fakeDb(d));
    const encabezados = ["Fecha y hora", "Cliente", "Documento", "Día", "Monto", "Anulado", "Cobrador"];
    const enMemoria = conBom(
      filasACsv(
        encabezados,
        filas.map((f) => [f.fechaIso, f.cliente, f.documento, f.dia, f.monto, f.anulado ? "sí" : "no", f.cobrador]),
      ),
    );

    // Camino streaming: junta las páginas tal como las emite el generador.
    const paginas: FilaPagoExport[][] = [];
    for await (const pag of streamPagosExport(fakeDb(d))) paginas.push(pag);
    const porStreaming = csvPorStreamingDesde(paginas);

    expect(porStreaming).toBe(enMemoria); // ni un carácter de diferencia
    // Sanidad: el nombre con comillas y ";" quedó bien escapado en la salida.
    expect(porStreaming).toContain('"Beto ""Grande""; hijo"');
    // Y el generador emitió más de una página (probó el corte real).
    expect(paginas.length).toBeGreaterThan(1);
  });
});
