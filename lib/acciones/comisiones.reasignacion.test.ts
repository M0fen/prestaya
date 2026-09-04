// ─────────────────────────────────────────────────────────────────────────
//  EL DOBLE PAGO DE COMISIÓN QUE CRUZA COBRADORES.
//
//  El escenario, tal cual puede pasar en la oficina:
//    1. Se le liquida la quincena a Alejandro. Sale un egreso REAL de caja.
//    2. Se reasigna uno de sus clientes a Pedro (motivo cualquiera: ausencia,
//       redistribución).
//    3. Se liquida la MISMA quincena a Pedro.
//
//  Antes de 0152 el paso 3 pagaba de nuevo los cobros que Alejandro ya había
//  cobrado y ya se le habían pagado: la comisión se calcula sobre
//  `prestamos.cobrador_id` —el dueño de HOY— así que al reasignar, esos pagos
//  pasaban a contar para Pedro con efecto retroactivo. Y nada lo frenaba: la fila
//  de Pedro es otra `cobrador_id`, así que ni el unique(cobrador, período) ni el
//  EXCLUDE de rango se disparan, y la guardia anti-solapamiento consultaba
//  `.eq("cobrador_id", …)` — solo miraba al mismo cobrador.
//
//  Hay DOS defensas y este archivo prueba las dos:
//   · La de fondo (0152): cada pago nace con su comisión atribuida y reasignar
//     NO la cambia. Para los pagos nuevos el problema es imposible.
//   · La de transición: los pagos ANTERIORES a 0152 no tienen foto y siguen
//     cayendo al dueño actual. Mientras exista uno solo en el período, no se
//     puede liquidar si otro cobrador ya liquidó un período que lo solapa.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUsuarioActual = vi.fn();
const bloqueoSoloLectura = vi.fn();
const getComisionesPeriodo = vi.fn();
const registrarMovimientoCaja = vi.fn();
const existeMovimientoPorOpId = vi.fn();
const descontarComprasEmpleadoDb = vi.fn();
const revertirDescuentoComprasEmpleadoDb = vi.fn();
const registrarAuditoria = vi.fn();
const crearReciboDb = vi.fn();

/** Cuántos pagos del período NO tienen comisión congelada (0 = ya hay foto). */
const pagosSinFoto = vi.fn(() => 0);
/** Liquidaciones de OTROS cobradores que la guardia va a mirar. */
const liquidacionesDeOtros = vi.fn<() => { cobrador_id: string; periodo_key: string; periodo_rango: string | null }[]>(
  () => [],
);
const liquidadasInsert = vi.fn(() => Promise.resolve({ error: null }));

const encadenable = (fin: () => unknown) => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "is", "eq", "gte", "lte"]) b[m] = () => b;
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve(fin()).then(ok);
  return b;
};

const db = {
  from: (t: string) => {
    if (t === "comisiones_liquidadas") {
      return {
        insert: liquidadasInsert,
        select: () => ({
          // Las del MISMO cobrador (guardia vieja): ninguna.
          eq: () => Promise.resolve({ data: [], error: null }),
          // Las de OTROS (guardia nueva).
          neq: () => Promise.resolve({ data: liquidacionesDeOtros(), error: null }),
        }),
        delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      };
    }
    if (t === "pagos") return encadenable(() => ({ count: pagosSinFoto(), error: null }));
    return {};
  },
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServer: vi.fn(async () => db) }));
vi.mock("@/lib/observabilidad", () => ({ reportarError: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getUsuarioActual: (...a: unknown[]) => getUsuarioActual(...a),
  esAdmin: (rol: string) => rol === "admin",
}));
vi.mock("@/lib/data/featureFlags", () => ({ bloqueoSoloLectura: (...a: unknown[]) => bloqueoSoloLectura(...a) }));
vi.mock("@/lib/data/comisiones", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getComisionesPeriodo: (...a: unknown[]) => getComisionesPeriodo(...a),
}));
vi.mock("@/lib/data/caja", () => ({
  registrarMovimientoCaja: (...a: unknown[]) => registrarMovimientoCaja(...a),
  existeMovimientoPorOpId: (...a: unknown[]) => existeMovimientoPorOpId(...a),
}));
vi.mock("@/lib/data/auditoria", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a) }));
vi.mock("@/lib/data/recibos", () => ({ crearReciboDb: (...a: unknown[]) => crearReciboDb(...a) }));
vi.mock("@/lib/data/comprasEmpleado", () => ({
  descontarComprasEmpleadoDb: (...a: unknown[]) => descontarComprasEmpleadoDb(...a),
  revertirDescuentoComprasEmpleadoDb: (...a: unknown[]) => revertirDescuentoComprasEmpleadoDb(...a),
}));

import { liquidarComision } from "./comisiones";

const ADMIN = { id: "u-admin", nombre: "Admin", rol: "admin", activo: true };
const QUINCENA = "mes:2026-07";
const PEDRO = "cob-pedro";
const ALEJANDRO = "cob-ale";

beforeEach(() => {
  vi.clearAllMocks();
  bloqueoSoloLectura.mockResolvedValue(null);
  getUsuarioActual.mockResolvedValue(ADMIN);
  getComisionesPeriodo.mockResolvedValue({
    periodo: "mes",
    periodoKey: QUINCENA,
    etiqueta: "julio 2026",
    desde: "2026-07-01",
    hasta: "2026-07-16",
    atribuidoPorRuta: true,
    filas: [{ cobradorId: PEDRO, nombre: "Pedro", comision: 5000 }],
  });
  descontarComprasEmpleadoDb.mockResolvedValue(0);
  revertirDescuentoComprasEmpleadoDb.mockResolvedValue(undefined);
  registrarAuditoria.mockResolvedValue(undefined);
  crearReciboDb.mockResolvedValue({ numero: 1 });
  existeMovimientoPorOpId.mockResolvedValue(false);
  registrarMovimientoCaja.mockResolvedValue(undefined);
  pagosSinFoto.mockReturnValue(0);
  liquidacionesDeOtros.mockReturnValue([]);
});

describe("liquidarComision — el doble pago que cruza cobradores (reasignación)", () => {
  it("⚠️ EL ESCENARIO: se liquidó a Alejandro, se reasignó a Pedro, Pedro NO puede cobrar lo mismo", async () => {
    // En el período hay cobros SIN comisión congelada (anteriores a 0152): son los
    // que la reasignación re-imputa hacia atrás.
    pagosSinFoto.mockReturnValue(12);
    // Y Alejandro ya liquidó una quincena que los incluye — con egreso real de caja.
    liquidacionesDeOtros.mockReturnValue([
      { cobrador_id: ALEJANDRO, periodo_key: QUINCENA, periodo_rango: "[2026-07-01,2026-07-17)" },
    ]);

    const r = await liquidarComision({ cobradorId: PEDRO, periodoKey: QUINCENA });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ya se pagaron una vez|ya liquidó/i);
    // Y lo que importa de verdad: NO salió plata de la caja por segunda vez.
    expect(registrarMovimientoCaja).not.toHaveBeenCalled();
    expect(liquidadasInsert).not.toHaveBeenCalled();
  });

  it("con la comisión YA congelada en todos los pagos, Pedro sí puede liquidar lo suyo", async () => {
    // Después del backfill: cada pago sabe de quién es. Reasignar ya no re-imputa,
    // así que dos cobradores liquidando la misma quincena es legítimo y no se frena.
    pagosSinFoto.mockReturnValue(0);
    liquidacionesDeOtros.mockReturnValue([
      { cobrador_id: ALEJANDRO, periodo_key: QUINCENA, periodo_rango: "[2026-07-01,2026-07-17)" },
    ]);

    const r = await liquidarComision({ cobradorId: PEDRO, periodoKey: QUINCENA });

    expect(r.ok).toBe(true);
    expect(liquidadasInsert).toHaveBeenCalled();
  });

  it("con pagos sin foto pero SIN liquidación ajena que los solape, se liquida normal", async () => {
    pagosSinFoto.mockReturnValue(12);
    liquidacionesDeOtros.mockReturnValue([
      // Otro cobrador, pero de un período que no toca este.
      { cobrador_id: ALEJANDRO, periodo_key: "mes:2026-05", periodo_rango: "[2026-05-01,2026-05-17)" },
    ]);

    const r = await liquidarComision({ cobradorId: PEDRO, periodoKey: QUINCENA });

    expect(r.ok).toBe(true);
  });

  it("si no se puede saber si hay pagos re-imputables, se asume que SÍ (sesgo a no pagar dos veces)", async () => {
    // La consulta de pagos falla (columna faltante, blip). Ante la duda, la guardia
    // se comporta como si hubiera pagos viejos: es plata que sale de caja.
    const dbRoto = {
      from: (t: string) => {
        if (t === "pagos") return encadenable(() => ({ count: null, error: { message: "boom" } }));
        if (t === "comisiones_liquidadas") {
          return {
            insert: liquidadasInsert,
            select: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
              neq: () =>
                Promise.resolve({
                  data: [{ cobrador_id: ALEJANDRO, periodo_key: QUINCENA, periodo_rango: "[2026-07-01,2026-07-17)" }],
                  error: null,
                }),
            }),
            delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
          };
        }
        return {};
      },
    };
    const { createSupabaseServer } = await import("@/lib/supabase/server");
    (createSupabaseServer as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(dbRoto);

    const r = await liquidarComision({ cobradorId: PEDRO, periodoKey: QUINCENA });
    expect(r.ok).toBe(false);
    expect(registrarMovimientoCaja).not.toHaveBeenCalled();
  });
});
