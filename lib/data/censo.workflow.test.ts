// ─────────────────────────────────────────────────────────────────────────
//  WORKFLOW del CENSO en calle (`relevarCliente`) — sesión de caos 15-08.
//
//  La adopción flexible de cédulas es TODO el anti-duplicados real: el unique
//  de la base solo frena el duplicado LITERAL, y en la base viva conviven
//  1.665 documentos con puntos/guiones junto a sus variantes limpias (así
//  nacieron las 243 fichas dobles del import). Esta acción corría sin ningún
//  test: dos muros distintos ya vivieron acá y los dos terminaron mal
//  ("documento ya registrado" → día 1 con 0 clientes; "está en la ruta de un
//  compañero" → contradecía la regla del negocio).
//
//  Regla fijada: censar una ficha existente SUMA al cobrador, no le saca nada
//  a nadie; el único freno es el cliente dado de BAJA (decisión de oficina).
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const getUsuarioActual = vi.fn();
const bloqueoSoloLectura = vi.fn();
const getClientePorDocumentoFlexible = vi.fn();
const getClienteRecientePorNombre = vi.fn();
const crearClienteCenso = vi.fn();
const registrarBitacora = vi.fn();
const subirFotoCliente = vi.fn();

/** Asignaciones ACTIVAS del cliente existente (lo que responde el select). */
let asignacionesActivas: { cobrador_id: string }[] = [];
/** Escrituras hechas por la acción, por tabla. */
let upserts: { tabla: string; fila: Record<string, unknown> }[] = [];
let inserts: { tabla: string; fila: Record<string, unknown> }[] = [];

function dbFalsa(): SupabaseClient {
  return {
    from(tabla: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        // La cadena select().eq().eq() se AWAITea directo: thenable.
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: asignacionesActivas, error: null }).then(res),
        upsert: (fila: Record<string, unknown>) => {
          upserts.push({ tabla, fila });
          return Promise.resolve({ error: null });
        },
        insert: (fila: Record<string, unknown>) => {
          inserts.push({ tabla, fila });
          return Promise.resolve({ error: null });
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServer: vi.fn(async () => dbFalsa()) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdmin: vi.fn(() => dbFalsa()) }));
vi.mock("@/lib/auth", () => ({ getUsuarioActual: (...a: unknown[]) => getUsuarioActual(...a) }));
vi.mock("@/lib/data/featureFlags", () => ({
  bloqueoSoloLectura: (...a: unknown[]) => bloqueoSoloLectura(...a),
}));
vi.mock("@/lib/data/clientes", () => ({
  getClientePorId: vi.fn(),
  getClientePorDocumentoFlexible: (...a: unknown[]) => getClientePorDocumentoFlexible(...a),
  getClienteRecientePorNombre: (...a: unknown[]) => getClienteRecientePorNombre(...a),
  crearClienteCenso: (...a: unknown[]) => crearClienteCenso(...a),
}));
vi.mock("@/lib/data/prestamos", () => ({
  getPrestamosActivosPorCliente: vi.fn(),
  getPrestamoActivoPorCliente: vi.fn(),
}));
vi.mock("@/lib/data/pagos", () => ({
  getPagosDePrestamo: vi.fn(),
  registrarPago: vi.fn(),
  esSobrePago: vi.fn(),
}));
vi.mock("@/lib/data/visitas", () => ({ crearVisita: vi.fn() }));
vi.mock("@/lib/data/bitacora", () => ({ registrarBitacora: (...a: unknown[]) => registrarBitacora(...a) }));
vi.mock("@/lib/data/fotos", () => ({ subirFotoCliente: (...a: unknown[]) => subirFotoCliente(...a) }));
vi.mock("@/lib/data/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/lib/observabilidad", () => ({ reportarError: vi.fn() }));

import { relevarCliente } from "@/app/cobrador/(app)/actions";

const COBRADOR = { id: "u-yo", nombre: "Karent", rol: "cobrador", activo: true };

beforeEach(() => {
  vi.clearAllMocks();
  asignacionesActivas = [];
  upserts = [];
  inserts = [];
  getUsuarioActual.mockResolvedValue(COBRADOR);
  bloqueoSoloLectura.mockResolvedValue(null);
  getClientePorDocumentoFlexible.mockResolvedValue(null);
  getClienteRecientePorNombre.mockResolvedValue(null);
  crearClienteCenso.mockResolvedValue({ id: "cli-nuevo" });
  registrarBitacora.mockResolvedValue(undefined);
});

describe("censo · la cédula que YA existe (en cualquier formato) ADOPTA, no duplica", () => {
  it("ficha libre encontrada por comparación flexible → se suma a la ruta sin crear cliente", async () => {
    getClientePorDocumentoFlexible.mockResolvedValue({ id: "cli-viejo", activo: true });
    const r = await relevarCliente({ nombre: "Sonia Telis", documento: "1.234.567-8" });
    expect(r).toEqual({ ok: true, id: "cli-viejo", adoptado: true });
    expect(crearClienteCenso).not.toHaveBeenCalled(); // la 244ª ficha doble no nace
    expect(upserts).toHaveLength(1);
    expect(upserts[0].fila).toMatchObject({ cobrador_id: COBRADOR.id, cliente_id: "cli-viejo", activo: true });
  });

  it("ficha del COMPAÑERO → adopta COMPARTIDA sin tocarle la asignación al otro", async () => {
    getClientePorDocumentoFlexible.mockResolvedValue({ id: "cli-viejo", activo: true });
    asignacionesActivas = [{ cobrador_id: "u-companero" }];
    const r = await relevarCliente({ nombre: "Sonia Telis", documento: "12345678" });
    expect(r).toEqual({ ok: true, id: "cli-viejo", adoptado: true });
    // Solo se escribe LA PROPIA fila: al compañero no se le saca nada.
    expect(upserts).toHaveLength(1);
    expect(upserts[0].fila).toMatchObject({ cobrador_id: COBRADOR.id });
    // Y el rastro dice COMPARTIDA (lo que el supervisor necesita entender).
    expect(registrarBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ detalle: expect.stringContaining("COMPARTIDA") }),
    );
  });

  it("si el cliente YA es mío, es idempotente: ni upsert ni cliente nuevo", async () => {
    getClientePorDocumentoFlexible.mockResolvedValue({ id: "cli-viejo", activo: true });
    asignacionesActivas = [{ cobrador_id: COBRADOR.id }];
    const r = await relevarCliente({ nombre: "Sonia Telis", documento: "12345678" });
    expect(r).toEqual({ ok: true, id: "cli-viejo", adoptado: true });
    expect(upserts).toHaveLength(0);
    expect(crearClienteCenso).not.toHaveBeenCalled();
  });

  it("el ÚNICO freno: cliente dado de BAJA (decisión de oficina, no empate de rutas)", async () => {
    getClientePorDocumentoFlexible.mockResolvedValue({ id: "cli-viejo", activo: false });
    const r = await relevarCliente({ nombre: "Sonia Telis", documento: "12345678" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/dada de baja/i);
    expect(upserts).toHaveLength(0);
    expect(crearClienteCenso).not.toHaveBeenCalled();
  });
});

describe("censo · alta nueva y sus bordes", () => {
  it("cédula que NO existe → crea el cliente y lo asigna a quien lo censó", async () => {
    const r = await relevarCliente({ nombre: "Cliente Nuevo", documento: "9999999" });
    expect(r).toEqual({ ok: true, id: "cli-nuevo" });
    expect(crearClienteCenso).toHaveBeenCalledTimes(1);
    expect(inserts.find((i) => i.tabla === "asignaciones")?.fila).toMatchObject({
      cobrador_id: COBRADOR.id,
      cliente_id: "cli-nuevo",
    });
  });

  it("SIN cédula, el reintento tras ACK perdido no duplica: mismo nombre reciente → devuelve el existente", async () => {
    getClienteRecientePorNombre.mockResolvedValue("cli-reciente");
    const r = await relevarCliente({ nombre: "Juan Sin Cedula" });
    expect(r).toEqual({ ok: true, id: "cli-reciente" });
    expect(crearClienteCenso).not.toHaveBeenCalled();
  });

  it("nombre vacío o de un carácter → error claro, nada se escribe", async () => {
    for (const nombre of ["", "   ", "J"]) {
      const r = await relevarCliente({ nombre });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/nombre/i);
    }
    expect(crearClienteCenso).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });

  it("el censo en calle es del COBRADOR: un gestor recibe la salida correcta (el panel)", async () => {
    getUsuarioActual.mockResolvedValue({ ...COBRADOR, rol: "supervisor" });
    const r = await relevarCliente({ nombre: "Cliente Nuevo", documento: "9999999" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/panel/i);
    expect(crearClienteCenso).not.toHaveBeenCalled();
  });
});
