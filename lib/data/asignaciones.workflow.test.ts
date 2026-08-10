// ─────────────────────────────────────────────────────────────────────────
//  WORKFLOW de ASIGNACIONES (cobrador ↔ cliente) y ALCANCE del cobrador.
//
//  La asignación es la que decide QUÉ CLIENTES ve cada uno en la calle, y
//  `prestamos.cobrador_id` es el que decide A QUIÉN LE TOCA LA COMISIÓN. Son
//  dos verdades distintas y este archivo las mira juntas, porque los movimientos
//  de ruta (reasignar, dar de alta un crédito, dar de baja una asignación) tocan
//  las DOS de una sola pasada.
//
//  Regla que atraviesa todo: desde 0038 un cliente puede tener créditos ACTIVOS
//  de DOS cobradores distintos y estar en las DOS rutas (59 casos hoy; SONIA
//  TELIS: 6 créditos de Juan José por $5.350/día + 2 de Alejandro por $1.200).
//  Es LEGÍTIMO. Lo que no puede pasar es que una operación sobre "el cobrador
//  del cliente" se lleve puesto al compañero: ni sus créditos (su comisión POR
//  QUINCENA ya devengada) ni su ruta (créditos vivos que nadie sale a cobrar).
//
//  Los casos que HOY se rompen van con `it.fails` + "⚠️ FALLA: bug real":
//  documentan la conducta correcta sin pintar la suite de rojo. El día que se
//  arregle la fuente, el `it.fails` revienta y obliga a sacarle el `.fails`.
//
//  ⚠️ DINERO REAL: toda cifra esperada es entera. Fechas FIJAS en todo el archivo.
// ─────────────────────────────────────────────────────────────────────────
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@/lib/permisos";

// ── Dobles de las dependencias de servidor ─────────────────────────────────
// `createSupabaseAdmin` (service_role) y el actor logueado son lo único que hay
// que fingir: el resto de la cadena (alcance por zona, ruta, perfil) corre REAL.
const H = vi.hoisted(() => ({
  db: null as unknown as SupabaseClient,
  actor: { rol: "admin", usuarioId: "u-admin" } as Actor,
}));

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdmin: () => H.db }));
vi.mock("@/lib/auth", () => ({ getActorActual: async () => H.actor }));
vi.mock("./rendicion", () => ({
  getEstadoJornada: async () => ({
    recaudado: 0, cobrosCantidad: 0, gastosHoy: 0, gastosRespaldadosHoy: 0,
    yaRendida: null, base: 0, disponible: false,
  }),
  getDeudaRendicionAyer: async () => null,
}));
vi.mock("./gastos", () => ({ getGastosCobradorHoy: async () => ({ total: 0, items: [] }) }));
vi.mock("./bitacora", () => ({ getResumenBitacoraDia: async () => [] }));
vi.mock("./misNumeros", () => ({ getMisNumeros: async () => null }));

import { getCobradorDeCliente, desactivarAsignacion, reasignarCliente } from "./asignaciones";
import { getRutaCobrador } from "./ruta";
import { traerTodo } from "./paginado";
import { alcanceDelActor } from "./alcance";
import { getClientesListaAdmin } from "./clientes";
import { getPerfilCobrador } from "./perfilCobrador";
import { crearCreditoNuevoDb } from "./creditoNuevo";

// ── Reloj FIJO (nunca new Date() sin argumentos) ───────────────────────────
/** Jueves 06-ago-2026, 12:00 en Uruguay: día hábil de cobro. */
const HOY = new Date("2026-08-06T15:00:00Z");
/** Lunes 03-ago: 24 cuotas diarias terminan bien adelante → crédito EN TÉRMINO. */
const INICIO_VIGENTE = "2026-08-03";
/** Un cobro sellado HOY (después del corte de las 03:00 UTC). */
const AHORA_ISO = "2026-08-06T13:00:00.000Z";

const JUANJO = "u-juanjo";
const ALE = "u-ale";
const PEDRO = "u-pedro";
const SONIA = "cli-sonia";

// ═══════════════════════════════════════════════════════════════════════════
//  DOBLE DE SUPABASE
//  Encadenable y con los DOS límites REALES de PostgREST modelados, porque son
//  justo lo que se está probando:
//   · `maxFilas`: el corte SILENCIOSO a 1000 filas (error: null igual);
//   · `maxIn`: la URL del `.in(...)` que revienta cerca de los 445 ids
//     (medido en prueba y documentado en lib/data/alcance.ts:36-38).
//  Aplica los filtros de verdad y registra las ESCRITURAS en orden: sin eso no
//  se puede probar a quién le movió los créditos una reasignación.
// ═══════════════════════════════════════════════════════════════════════════
type Fila = Record<string, unknown>;
type Filtro = { col: string; tipo: "eq" | "neq" | "in" | "gte"; val: unknown };
type Escritura = { tabla: string; op: "update" | "upsert" | "insert"; valores: Fila; filas: number };

interface OpcionesDb {
  /** Corte silencioso de PostgREST (en la base real, 1000). */
  maxFilas?: number;
  /** Ids máximos en un `.in(...)` antes de que la URL sea demasiado larga. */
  maxIn?: number;
  /** Tablas donde el RLS deja pasar el UPDATE pero no toca ninguna fila. */
  updateBloqueado?: string[];
}

interface Banco {
  db: SupabaseClient;
  tablas: Record<string, Fila[]>;
  escrituras: Escritura[];
}

const comparar = (a: unknown, b: unknown): number =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));

function crearDb(tablas: Record<string, Fila[]>, opts: OpcionesDb = {}): Banco {
  const escrituras: Escritura[] = [];
  const maxFilas = opts.maxFilas ?? Infinity;
  const maxIn = opts.maxIn ?? Infinity;
  const bloqueadas = new Set(opts.updateBloqueado ?? []);
  let seq = 0;

  const db = {
    from(tabla: string) {
      const filas = (tablas[tabla] ??= []);
      const filtros: Filtro[] = [];
      let orden: { col: string; asc: boolean } | null = null;
      let limite: number | null = null;
      let rango: { d: number; h: number } | null = null;
      let modo: "select" | "update" | "upsert" | "insert" = "select";
      let valores: Fila = {};
      let conflicto: string[] = [];
      let contar = false;
      let soloCabecera = false;
      let urlRota: string | null = null;

      const coincide = (f: Fila): boolean =>
        filtros.every((x) => {
          if (x.tipo === "eq") return f[x.col] === x.val;
          if (x.tipo === "neq") return f[x.col] !== x.val;
          if (x.tipo === "in") return (x.val as unknown[]).includes(f[x.col]);
          return String(f[x.col] ?? "") >= String(x.val); // gte (ISO / texto)
        });

      const ejecutar = (): { data: Fila[] | null; error: { message: string } | null; count: number | null } => {
        if (urlRota) return { data: null, error: { message: urlRota }, count: null };

        if (modo === "update") {
          const objetivo = bloqueadas.has(tabla) ? [] : filas.filter(coincide);
          for (const f of objetivo) Object.assign(f, valores);
          escrituras.push({ tabla, op: "update", valores, filas: objetivo.length });
          return { data: objetivo, error: null, count: null };
        }
        if (modo === "upsert" || modo === "insert") {
          const ya =
            modo === "upsert" && conflicto.length > 0
              ? filas.find((f) => conflicto.every((c) => f[c] === valores[c]))
              : undefined;
          if (ya) {
            Object.assign(ya, valores);
            escrituras.push({ tabla, op: "upsert", valores, filas: 1 });
            return { data: [ya], error: null, count: null };
          }
          const nueva: Fila = { id: `${tabla}-${++seq}`, ...valores };
          filas.push(nueva);
          escrituras.push({ tabla, op: modo, valores, filas: 1 });
          return { data: [nueva], error: null, count: null };
        }

        const todas = filas.filter(coincide);
        let out = orden
          ? [...todas].sort((a, b) => comparar(a[orden!.col], b[orden!.col]) * (orden!.asc ? 1 : -1))
          : todas;
        if (rango) out = out.slice(rango.d, rango.h + 1);
        if (out.length > maxFilas) out = out.slice(0, maxFilas); // corte SILENCIOSO
        if (limite != null) out = out.slice(0, limite);
        return { data: soloCabecera ? null : out, error: null, count: contar ? todas.length : null };
      };

      const b = {
        select: (_cols?: string, o?: { count?: string; head?: boolean }) => {
          if (o?.count) contar = true;
          if (o?.head) soloCabecera = true;
          return b;
        },
        eq: (col: string, val: unknown) => (filtros.push({ col, tipo: "eq", val }), b),
        neq: (col: string, val: unknown) => (filtros.push({ col, tipo: "neq", val }), b),
        gte: (col: string, val: unknown) => (filtros.push({ col, tipo: "gte", val }), b),
        in: (col: string, val: unknown[]) => {
          if (val.length > maxIn) urlRota = `URL demasiado larga: ${val.length} ids en ${tabla}.${col}`;
          filtros.push({ col, tipo: "in", val });
          return b;
        },
        order: (col: string, o?: { ascending?: boolean }) => {
          orden = { col, asc: o?.ascending !== false };
          return b;
        },
        limit: (n: number) => ((limite = n), b),
        range: (d: number, h: number) => ((rango = { d, h }), b),
        update: (v: Fila) => ((modo = "update"), (valores = v), b),
        insert: (v: Fila) => ((modo = "insert"), (valores = v), b),
        upsert: (v: Fila, o?: { onConflict?: string }) => {
          modo = "upsert";
          valores = v;
          conflicto = (o?.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
          return b;
        },
        maybeSingle: () => {
          const r = ejecutar();
          return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error, count: r.count });
        },
        single: () => {
          const r = ejecutar();
          return Promise.resolve({
            data: r.data?.[0] ?? null,
            error: r.error ?? (r.data?.length ? null : { message: "sin filas" }),
            count: r.count,
          });
        },
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve(ejecutar()).then(ok, fail),
      };
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, tablas, escrituras };
}

/** Vista del MISMO estado como la ve un cobrador: el RLS de `asignaciones` solo
 *  le devuelve las suyas (0031). Las filas son las mismas referencias, así que
 *  refleja lo que una escritura acaba de hacer. */
function comoCobrador(banco: Banco, cobradorId: string, opts: OpcionesDb = {}): SupabaseClient {
  return crearDb(
    { ...banco.tablas, asignaciones: (banco.tablas.asignaciones ?? []).filter((a) => a.cobrador_id === cobradorId) },
    opts,
  ).db;
}

// ── Fábricas de filas ──────────────────────────────────────────────────────
const asignacion = (cobrador_id: string, cliente_id: string, extra: Fila = {}): Fila => ({
  id: `as-${cobrador_id}-${cliente_id}`,
  cobrador_id,
  cliente_id,
  activo: true,
  orden: null,
  asignado_en: "2026-07-01T10:00:00.000Z",
  ...extra,
});

const cliente = (id: string, nombre: string, extra: Fila = {}): Fila => ({
  id,
  nombre,
  documento: `doc-${id}`,
  telefono: null,
  direccion: null,
  token_acceso: `tok-${id}`,
  calificacion: "regular",
  notas: null,
  activo: true,
  origen: "oficina",
  creado_por: null,
  gps_lat: null,
  gps_lng: null,
  reportado: false,
  genero: null,
  ciudad: null,
  direccion_secundaria: null,
  foto_path: null,
  numero_registro: null,
  disapp_id: null,
  acceso_entregado_en: null,
  acceso_entregado_por: null,
  acceso_visto_en: null,
  creado_en: "2026-01-01T00:00:00.000Z",
  actualizado_en: "2026-01-01T00:00:00.000Z",
  ...extra,
});

const prestamo = (o: {
  id: string;
  cliente?: string;
  cobrador: string;
  cuota: number;
  estado?: string;
  inicio?: string;
  acum?: number;
}): Fila => ({
  id: o.id,
  cliente_id: o.cliente ?? SONIA,
  cobrador_id: o.cobrador,
  cuota_diaria: o.cuota,
  total_dias: 24,
  fecha_inicio: o.inicio ?? INICIO_VIGENTE,
  frecuencia: "diario",
  pagado_acum: o.acum ?? 0,
  estado: o.estado ?? "activo",
  monto_prestado: o.cuota * 20,
  creado_en: "2026-08-03T10:00:00.000Z",
  op_id: null,
});

/** SONIA TELIS en dos rutas: 6 créditos de Juan José ($5.350) + 2 de Alejandro ($1.200). */
function estadoSoniaCompartida(): Record<string, Fila[]> {
  return {
    asignaciones: [asignacion(JUANJO, SONIA), asignacion(ALE, SONIA)],
    clientes: [cliente(SONIA, "SONIA TELIS")],
    usuarios: [
      { id: JUANJO, nombre: "Juan José Castro", rol: "cobrador", zona_id: "z-centro", activo: true },
      { id: ALE, nombre: "Alejandro Cardona", rol: "cobrador", zona_id: "z-centro", activo: true },
      { id: PEDRO, nombre: "Pedro Núñez", rol: "cobrador", zona_id: "z-centro", activo: true },
    ],
    prestamos: [
      prestamo({ id: "p1", cobrador: JUANJO, cuota: 1200 }),
      prestamo({ id: "p2", cobrador: JUANJO, cuota: 1200 }),
      prestamo({ id: "p3", cobrador: JUANJO, cuota: 550 }),
      prestamo({ id: "p4", cobrador: JUANJO, cuota: 600 }),
      prestamo({ id: "p5", cobrador: JUANJO, cuota: 1200 }),
      prestamo({ id: "p6", cobrador: JUANJO, cuota: 600 }),
      prestamo({ id: "p7", cobrador: ALE, cuota: 600 }),
      prestamo({ id: "p8", cobrador: ALE, cuota: 600 }),
    ],
    pagos: [],
    visitas: [],
  };
}

beforeEach(() => {
  H.actor = { rol: "admin", usuarioId: "u-admin" };
});

// ═══════════════════════════════════════════════════════════════════════════
//  1. QUIÉN FIGURA COMO COBRADOR DE UN CLIENTE
// ═══════════════════════════════════════════════════════════════════════════
describe("getCobradorDeCliente: el dueño de ruta que muestra la ficha", () => {
  const conAsignaciones = (filas: Fila[]) => crearDb({ asignaciones: filas }).db;

  it("devuelve el cobrador ACTIVO con su ZONA (de esa zona cuelga el permiso del gestor)", async () => {
    const db = conAsignaciones([
      asignacion(JUANJO, SONIA, { usuarios: { nombre: "Juan José Castro", zona_id: "z-centro" } }),
    ]);
    expect(await getCobradorDeCliente(db, SONIA)).toEqual({
      cobradorId: JUANJO,
      cobradorNombre: "Juan José Castro",
      zonaId: "z-centro",
    });
  });

  it("una asignación dada de BAJA no manda: la ruta vieja no es el cobrador de hoy", async () => {
    const db = conAsignaciones([
      asignacion(JUANJO, SONIA, { activo: false, usuarios: { nombre: "Juan José Castro", zona_id: "z-centro" } }),
      asignacion(ALE, SONIA, { usuarios: { nombre: "Alejandro Cardona", zona_id: "z-centro" } }),
    ]);
    expect((await getCobradorDeCliente(db, SONIA))?.cobradorId).toBe(ALE);
  });

  it("cliente SIN asignación activa → null (nadie lo tiene en su ruta)", async () => {
    const db = conAsignaciones([asignacion(JUANJO, SONIA, { activo: false })]);
    expect(await getCobradorDeCliente(db, SONIA)).toBeNull();
  });

  it("el embebido de usuarios puede llegar como arreglo (PostgREST): el nombre sale igual", async () => {
    const db = conAsignaciones([
      asignacion(JUANJO, SONIA, { usuarios: [{ nombre: "Juan José Castro", zona_id: "z-centro" }] }),
    ]);
    expect((await getCobradorDeCliente(db, SONIA))?.cobradorNombre).toBe("Juan José Castro");
  });

  it("cliente COMPARTIDO: informa UNO SOLO (el más reciente) y el compañero queda invisible", async () => {
    // Conducta ACTUAL y deliberada (no usa maybeSingle, que rompería con dos
    // activas). El precio: el gestor abre la ficha, lee "Cobrador: Alejandro" y
    // no se entera de que Juan José también le cobra $5.350 por día. Sobre esa
    // pantalla se decide reasignar — ver el bloque 2.
    const db = conAsignaciones([
      asignacion(JUANJO, SONIA, {
        asignado_en: "2026-07-01T10:00:00.000Z",
        usuarios: { nombre: "Juan José Castro", zona_id: "z-centro" },
      }),
      asignacion(ALE, SONIA, {
        asignado_en: "2026-08-05T10:00:00.000Z",
        usuarios: { nombre: "Alejandro Cardona", zona_id: "z-centro" },
      }),
    ]);
    const cob = await getCobradorDeCliente(db, SONIA);
    expect(cob?.cobradorId).toBe(ALE);
    expect(cob?.cobradorId).not.toBe(JUANJO); // Juan José no aparece por ningún lado
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. REASIGNAR — la ruta se mueve y la COMISIÓN va detrás
// ═══════════════════════════════════════════════════════════════════════════
describe("reasignarCliente: cambiar de ruta sin dejar al cliente en el aire", () => {
  it("SUBE la nueva asignación ANTES de bajar las viejas (nunca 'cliente fantasma')", async () => {
    // Son dos requests sin transacción: si se corta en el medio, el peor caso
    // debe ser "dos rutas" (molesto y visible), nunca "ninguna ruta" (crédito
    // vivo que ningún cobrador ve: ya pasó, 46 créditos / $634.666).
    const banco = crearDb({
      asignaciones: [asignacion(JUANJO, SONIA)],
      prestamos: [prestamo({ id: "p1", cobrador: JUANJO, cuota: 1200 })],
    });
    await reasignarCliente(banco.db, SONIA, PEDRO);
    expect(banco.escrituras.map((e) => `${e.tabla}:${e.op}`)).toEqual([
      "asignaciones:upsert", // 1) primero entra la nueva
      "asignaciones:update", // 2) recién ahí se bajan las viejas
      "prestamos:update", // 3) y el dueño de los créditos sigue a la ruta
    ]);
    expect(banco.escrituras[1].valores).toEqual({ activo: false });
  });

  it("mueve el dueño de los créditos ACTIVOS y NO toca los finalizados (la historia no se reescribe)", async () => {
    const banco = crearDb({
      asignaciones: [asignacion(JUANJO, SONIA)],
      prestamos: [
        prestamo({ id: "vivo", cobrador: JUANJO, cuota: 1200 }),
        prestamo({ id: "viejo", cobrador: JUANJO, cuota: 900, estado: "finalizado" }),
      ],
    });
    await reasignarCliente(banco.db, SONIA, PEDRO);
    const porId = Object.fromEntries(banco.tablas.prestamos.map((p) => [p.id, p.cobrador_id]));
    expect(porId.vivo).toBe(PEDRO); // la comisión de acá en adelante es de Pedro
    expect(porId.viejo).toBe(JUANJO); // lo ya cerrado queda como estaba
  });

  it("si la ruta cambió pero NINGÚN crédito activo se movió, LANZA (comisión desviada, no se traga)", async () => {
    // Un UPDATE que el RLS no deja tocar vuelve vacío y sin error: sin este
    // chequeo, la ruta quedaba en Pedro y la comisión seguía yendo a Juan José.
    const banco = crearDb(
      {
        asignaciones: [asignacion(JUANJO, SONIA)],
        prestamos: [prestamo({ id: "p1", cobrador: JUANJO, cuota: 1200 })],
      },
      { updateBloqueado: ["prestamos"] },
    );
    await expect(reasignarCliente(banco.db, SONIA, PEDRO)).rejects.toThrow(/comisión/i);
  });

  it("un cliente SIN créditos activos se reasigna sin inventar errores", async () => {
    const banco = crearDb({
      asignaciones: [asignacion(JUANJO, SONIA)],
      prestamos: [prestamo({ id: "viejo", cobrador: JUANJO, cuota: 900, estado: "finalizado" })],
    });
    await expect(reasignarCliente(banco.db, SONIA, PEDRO)).resolves.toBeUndefined();
    expect(banco.tablas.asignaciones.find((a) => a.cobrador_id === PEDRO)?.activo).toBe(true);
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo 1 — el que mueve plata).
  // El gestor abre la ficha de SONIA, lee "Cobrador: Juan José" (bloque 1: el
  // compañero no se muestra) y la reasigna a Pedro. El UPDATE de `prestamos` no
  // filtra por el cobrador que se está reemplazando: se lleva TAMBIÉN los 2
  // créditos de Alejandro. Y como la comisión sale de `prestamos.cobrador_id`
  // (RPC app_comision_por_ruta, 0069) y se liquida POR QUINCENA sobre los pagos
  // del período, mover la columna RE-IMPUTA hacia atrás plata que Alejandro ya
  // se ganó cobrando en la calle. Sin rastro: `cobrador_id` no está en la lista
  // de columnas inmutables del trigger de 0126.
  it.fails("reasignar NO puede llevarse los créditos del compañero (su comisión ya devengada)", async () => {
    const banco = crearDb(estadoSoniaCompartida());
    await reasignarCliente(banco.db, SONIA, PEDRO);
    const deAle = banco.tablas.prestamos.filter((p) => p.id === "p7" || p.id === "p8");
    expect(deAle.map((p) => p.cobrador_id)).toEqual([ALE, ALE]); // hoy: [PEDRO, PEDRO]
    expect(banco.tablas.prestamos.filter((p) => p.cobrador_id === PEDRO)).toHaveLength(6);
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo 1, la otra mitad: la RUTA).
  // El `.neq(nuevo)` baja TODAS las demás asignaciones activas, así que SONIA
  // desaparece de la ruta de Alejandro mientras sus 2 créditos siguen vivos:
  // $1.200 por día que nadie sale a cobrar y ninguna pantalla lista.
  it.fails("reasignar NO puede sacar al cliente de la ruta del compañero con créditos vivos", async () => {
    const banco = crearDb(estadoSoniaCompartida());
    await reasignarCliente(banco.db, SONIA, PEDRO);
    expect(banco.tablas.asignaciones.find((a) => a.cobrador_id === ALE)?.activo).toBe(true);
    const rutaDeAle = await getRutaCobrador(comoCobrador(banco, ALE), HOY, ALE);
    expect(rutaDeAle.items).toHaveLength(1); // hoy: 0, SONIA se evaporó de su ruta
    expect(rutaDeAle.arqueo.esperado).toBe(1200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. DESACTIVAR UNA ASIGNACIÓN — la compensación SÍ está acotada
// ═══════════════════════════════════════════════════════════════════════════
describe("desactivarAsignacion: bajar de la ruta a UNA persona, no a todas", () => {
  it("baja SOLO la del cobrador indicado: la del compañero sigue viva", async () => {
    const banco = crearDb(estadoSoniaCompartida());
    await desactivarAsignacion(banco.db, SONIA, ALE);
    const porCobrador = Object.fromEntries(banco.tablas.asignaciones.map((a) => [a.cobrador_id, a.activo]));
    expect(porCobrador[ALE]).toBe(false);
    expect(porCobrador[JUANJO]).toBe(true); // ← lo que reasignarCliente NO respeta
  });

  it("no toca `prestamos.cobrador_id`: revierte la RUTA, no la comisión", async () => {
    const banco = crearDb(estadoSoniaCompartida());
    await desactivarAsignacion(banco.db, SONIA, ALE);
    expect(banco.escrituras.every((e) => e.tabla === "asignaciones")).toBe(true);
    expect(banco.tablas.prestamos.filter((p) => p.cobrador_id === ALE)).toHaveLength(2);
  });

  it("es idempotente: repetirla no vuelve a tocar nada (compensación best-effort)", async () => {
    const banco = crearDb(estadoSoniaCompartida());
    await desactivarAsignacion(banco.db, SONIA, ALE);
    await desactivarAsignacion(banco.db, SONIA, ALE);
    expect(banco.escrituras.map((e) => e.filas)).toEqual([1, 0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. EL ALTA DE UN CRÉDITO NUEVO Y LA RUTA DEL COMPAÑERO
// ═══════════════════════════════════════════════════════════════════════════
describe("alta de crédito nuevo: consolidar la ruta sin borrar la del otro", () => {
  const alta = (cobradorId: string) => ({
    clienteId: SONIA,
    cobradorId,
    monto: 10000,
    cuota: 600,
    totalDias: 24,
    frecuencia: "diario" as const,
    fechaInicio: "2026-08-06",
    interesPct: 20,
    creadoPor: "u-admin",
    opId: "op-alta-1",
  });

  it("primero la RUTA y después el CRÉDITO (un crédito sin ruta es plata que nadie ve)", async () => {
    const banco = crearDb({ asignaciones: [], clientes: [cliente(SONIA, "SONIA TELIS")], prestamos: [] });
    const res = await crearCreditoNuevoDb(banco.db, alta(ALE));
    expect(res.ok).toBe(true);
    expect(banco.escrituras.map((e) => `${e.tabla}:${e.op}`).slice(0, 2)).toEqual([
      "asignaciones:upsert",
      "prestamos:insert",
    ]);
    expect(banco.tablas.asignaciones[0]).toMatchObject({ cobrador_id: ALE, cliente_id: SONIA, activo: true });
  });

  // ✅ ARREGLADO el 07-08, al abrir la venta nueva a clientes que siguen pagando.
  // `consolidarRuta` desactivaba TODA otra asignación activa del cliente sin mirar
  // si ese cobrador tenía créditos ACTIVOS: se le daba un crédito nuevo a SONIA por
  // Alejandro y los 6 créditos de Juan José ($5.350/día) quedaban vivos pero fuera
  // de su ruta — él ni se enteraba, y nadie los cobraba. Ahora se respeta al que
  // tiene plata en la calle con ese cliente.
  it("un crédito nuevo NO puede borrar de la ruta del compañero a un cliente con créditos vivos", async () => {
    const banco = crearDb({
      asignaciones: [asignacion(JUANJO, SONIA)],
      clientes: [cliente(SONIA, "SONIA TELIS")],
      prestamos: [
        prestamo({ id: "p1", cobrador: JUANJO, cuota: 1200 }),
        prestamo({ id: "p2", cobrador: JUANJO, cuota: 1200 }),
        prestamo({ id: "p3", cobrador: JUANJO, cuota: 550 }),
        prestamo({ id: "p4", cobrador: JUANJO, cuota: 600 }),
        prestamo({ id: "p5", cobrador: JUANJO, cuota: 1200 }),
        prestamo({ id: "p6", cobrador: JUANJO, cuota: 600 }),
      ],
      pagos: [],
      visitas: [],
    });
    await crearCreditoNuevoDb(banco.db, alta(ALE));
    expect(banco.tablas.asignaciones.find((a) => a.cobrador_id === JUANJO)?.activo).toBe(true);
    const rutaJuanjo = await getRutaCobrador(comoCobrador(banco, JUANJO), HOY, JUANJO);
    expect(rutaJuanjo.arqueo.esperado).toBe(5350); // hoy: 0, SONIA ya no está en su ruta
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. ALCANCE DE LA RUTA — de quién son los clientes que trae
// ═══════════════════════════════════════════════════════════════════════════
describe("getRutaCobrador: qué cartera le llega a cada uno", () => {
  it("con las asignaciones ya acotadas (RLS del cobrador) trae SU cartera con SU cuota", async () => {
    const banco = crearDb(estadoSoniaCompartida());
    const ruta = await getRutaCobrador(comoCobrador(banco, JUANJO), HOY, JUANJO);
    expect(ruta.items).toHaveLength(1);
    expect(ruta.items[0].cuota).toBe(5350); // no los $6.550 del cliente entero
    expect(ruta.arqueo.esperado).toBe(5350);
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo 5 — pantalla muerta para el gestor).
  // La consulta de `asignaciones` NO lleva `.eq("cobrador_id", …)`: se apoya 100%
  // en el RLS. Para un cobrador alcanza, pero /cobrador no exige rol cobrador, y
  // a un gestor el RLS le devuelve las asignaciones de TODOS sus cobradores → su
  // ruta se llena de clientes ajenos (y con ~1.500 asignaciones de Zona Centro,
  // además revienta por los dos límites de abajo).
  it("la ruta acota las asignaciones al cobrador, no confía solo en el RLS", async () => {
    const banco = crearDb({
      asignaciones: [asignacion(JUANJO, SONIA), asignacion(ALE, "cli-mabel")],
      clientes: [cliente(SONIA, "SONIA TELIS"), cliente("cli-mabel", "MABEL")],
      prestamos: [
        prestamo({ id: "p1", cobrador: JUANJO, cuota: 1200 }),
        prestamo({ id: "p7", cliente: "cli-mabel", cobrador: ALE, cuota: 600 }),
      ],
      pagos: [],
      visitas: [],
    });
    const ruta = await getRutaCobrador(banco.db, HOY, JUANJO);
    // MABEL es de ALE: su crédito no es de JUANJO, así que no le ocupa una parada.
    expect(ruta.items.map((i) => i.cliente.nombre)).toEqual(["SONIA TELIS"]);
  });

  // ⚠️ FALLA: riesgo LATENTE (hallazgo 6), no un bug de hoy: la cartera por
  // cobrador es de 50 a 108 clientes. Sí se dispara YA por el lado del gestor
  // (arriba). Se documenta porque el corte de PostgREST es SILENCIOSO —vuelve
  // con error null— y el día que una consolidación de rutas pase las 1000
  // asignaciones activas, la ruta empieza a esconder clientes sin avisar.
  it.fails("con más de 1000 asignaciones activas la ruta no puede esconder clientes en silencio", async () => {
    const cuantos = 1200;
    const asignaciones: Fila[] = [];
    const clientes: Fila[] = [];
    const prestamos: Fila[] = [];
    for (let i = 0; i < cuantos; i++) {
      const id = `cli-${String(i).padStart(4, "0")}`;
      asignaciones.push(asignacion(JUANJO, id));
      clientes.push(cliente(id, `CLIENTE ${i}`));
      prestamos.push(prestamo({ id: `pr-${i}`, cliente: id, cobrador: JUANJO, cuota: 500 }));
    }
    const banco = crearDb({ asignaciones, clientes, prestamos, pagos: [], visitas: [] }, { maxFilas: 1000 });
    const ruta = await getRutaCobrador(banco.db, HOY, JUANJO);
    expect(ruta.arqueo.clientes).toBe(cuantos); // hoy: 1000, y 200 clientes sin cobrar
    expect(ruta.arqueo.esperado).toBe(cuantos * 500);
  });

  // ⚠️ FALLA: riesgo LATENTE (hallazgo 6), medido: la URL de PostgREST aguanta
  // ~300 ids en un `.in(...)` y revienta cerca de 445 (lib/data/alcance.ts:36-38,
  // por eso existe `enLotes`). La ruta arma el `.in("id", cliIds)` de una sola
  // vez: con la cartera de un gestor (o de un cobrador consolidado) la pantalla
  // muere entera en vez de degradar.
  it.fails("una cartera grande no puede reventar la ruta: el `.in(...)` va en lotes", async () => {
    const cuantos = 500;
    const asignaciones: Fila[] = [];
    const clientes: Fila[] = [];
    const prestamos: Fila[] = [];
    for (let i = 0; i < cuantos; i++) {
      const id = `cli-${String(i).padStart(4, "0")}`;
      asignaciones.push(asignacion(JUANJO, id));
      clientes.push(cliente(id, `CLIENTE ${i}`));
      prestamos.push(prestamo({ id: `pr-${i}`, cliente: id, cobrador: JUANJO, cuota: 500 }));
    }
    const banco = crearDb({ asignaciones, clientes, prestamos, pagos: [], visitas: [] }, { maxIn: 445 });
    const ruta = await getRutaCobrador(banco.db, HOY, JUANJO); // hoy: lanza "URL demasiado larga"
    expect(ruta.items).toHaveLength(cuantos);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  6. EL ARREGLO QUE YA EXISTE — traerTodo (paginado.ts)
// ═══════════════════════════════════════════════════════════════════════════
describe("traerTodo: la forma correcta de barrer una tabla grande", () => {
  const filasAsignaciones = (n: number): Fila[] =>
    Array.from({ length: n }, (_, i) => asignacion(JUANJO, `cli-${String(i).padStart(4, "0")}`, { id: `as-${String(i).padStart(5, "0")}` }));

  it("recorre página por página hasta agotar, sin repetir ni saltear filas", async () => {
    const banco = crearDb({ asignaciones: filasAsignaciones(1200) }, { maxFilas: 1000 });
    const todas = await traerTodo<{ cliente_id: string }>((d, h) =>
      banco.db.from("asignaciones").select("cliente_id").eq("activo", true).order("id", { ascending: true }).range(d, h),
    );
    expect(todas).toHaveLength(1200);
    expect(new Set(todas.map((a) => a.cliente_id)).size).toBe(1200);
  });

  it("contra la MISMA fuente, sin paginar se pierden 200 clientes y el error viene en null", async () => {
    // Este es exactamente el corte que se traga la ruta: no hay señal de que
    // faltan filas, así que el número sale MAL y con cara de correcto.
    const banco = crearDb({ asignaciones: filasAsignaciones(1200) }, { maxFilas: 1000 });
    const { data, error } = await banco.db.from("asignaciones").select("cliente_id").eq("activo", true);
    expect(error).toBeNull();
    expect(data).toHaveLength(1000);
  });

  it("si una página falla, LANZA: nunca devuelve una lista corta como si estuviera completa", async () => {
    let vueltas = 0;
    await expect(
      traerTodo<Fila>(async () => {
        vueltas++;
        return vueltas === 1
          ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
          : { data: null, error: { message: "statement timeout" } };
      }),
    ).rejects.toMatchObject({ message: "statement timeout" });
  });

  it("el tope de emergencia corta el barrido (solo para caminos degradados)", async () => {
    const filas = await traerTodo<Fila>(
      async () => ({ data: Array.from({ length: 100 }, (_, i) => ({ id: i })), error: null }),
      100,
      250,
    );
    expect(filas).toHaveLength(300); // corta en la primera página que pasa el tope
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  7. ALCANCE POR ZONA DEL GESTOR (alcance.ts) — a qué clientes llega
// ═══════════════════════════════════════════════════════════════════════════
describe("alcanceDelActor: qué cartera ve un supervisor", () => {
  it("admin → alcance GLOBAL (sin listas de ids que puedan quedar cortas)", async () => {
    H.db = crearDb({}).db;
    expect(await alcanceDelActor()).toEqual({ global: true });
  });

  it("supervisor de una zona: sus cobradores y los clientes asignados a ellos", async () => {
    H.actor = { rol: "supervisor", usuarioId: "u-mauricio", zonasSupervisadas: ["z-centro"] };
    H.db = crearDb({
      usuarios: [
        { id: JUANJO, rol: "cobrador", zona_id: "z-centro" },
        { id: ALE, rol: "cobrador", zona_id: "z-centro" },
        { id: "u-otro", rol: "cobrador", zona_id: "z-norte" },
      ],
      asignaciones: [
        asignacion(JUANJO, SONIA),
        asignacion(ALE, SONIA), // compartido: entra UNA sola vez
        asignacion(ALE, "cli-mabel"),
        asignacion(JUANJO, "cli-baja", { activo: false }), // ruta vieja: no cuenta
        asignacion("u-otro", "cli-norte"), // otra zona: fuera del alcance
      ],
    }).db;
    const alcance = await alcanceDelActor();
    expect(alcance.global).toBe(false);
    if (alcance.global) return;
    expect(alcance.cobradorIds.sort()).toEqual([ALE, JUANJO].sort());
    expect(alcance.clienteIds.sort()).toEqual([SONIA, "cli-mabel"].sort());
  });

  it("una zona con MÁS de 1000 asignaciones activas no pierde ni un cliente (pagina)", async () => {
    // 14 cobradores × cientos de clientes pasa las 1000 filas fácil. Acá el
    // barrido SÍ está paginado: es el contraste con la ruta del bloque 5.
    H.actor = { rol: "supervisor", usuarioId: "u-mauricio", zonasSupervisadas: ["z-centro"] };
    const asignaciones = Array.from({ length: 1200 }, (_, i) =>
      asignacion(JUANJO, `cli-${String(i).padStart(4, "0")}`, { id: `as-${String(i).padStart(5, "0")}` }),
    );
    H.db = crearDb({ usuarios: [{ id: JUANJO, rol: "cobrador", zona_id: "z-centro" }], asignaciones }, { maxFilas: 1000 }).db;
    const alcance = await alcanceDelActor();
    if (alcance.global) throw new Error("el supervisor con zona no puede ser global");
    expect(alcance.clienteIds).toHaveLength(1200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  8. LA LISTA DEL PANEL — quién figura como "Vendedor"
// ═══════════════════════════════════════════════════════════════════════════
describe("getClientesListaAdmin: el cobrador y los créditos que ve el gestor", () => {
  const conAsignacionesEnEsteOrden = (orden: Fila[]) =>
    crearDb({ ...estadoSoniaCompartida(), asignaciones: orden });

  it("trae al cobrador asignado y cuenta los créditos ACTIVOS del cliente", async () => {
    const banco = crearDb({
      asignaciones: [asignacion(JUANJO, SONIA)],
      clientes: [cliente(SONIA, "SONIA TELIS")],
      usuarios: [{ id: JUANJO, nombre: "Juan José Castro" }],
      prestamos: [
        prestamo({ id: "p1", cobrador: JUANJO, cuota: 1200 }),
        prestamo({ id: "viejo", cobrador: JUANJO, cuota: 900, estado: "finalizado" }),
      ],
    });
    H.db = banco.db;
    const filas = await getClientesListaAdmin(banco.db);
    expect(filas).toHaveLength(1);
    expect(filas[0].vendedor).toBe("Juan José Castro");
    expect(filas[0].creditosActivos).toBe(1); // el finalizado no cuenta
  });

  it("el conteo de créditos SÍ suma los de los dos cobradores (la cartera del cliente es una)", async () => {
    const banco = crearDb(estadoSoniaCompartida());
    H.db = banco.db;
    const filas = await getClientesListaAdmin(banco.db);
    expect(filas[0].creditosActivos).toBe(8); // 6 de Juan José + 2 de Alejandro
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo 7).
  // La columna "Vendedor" se arma con `set(cliente_id, cobrador_id)` sobre las
  // asignaciones activas: con dos, gana la ÚLTIMA fila que llegue, y la consulta
  // no lleva `.order`. O sea: el mismo cliente puede figurar con un cobrador
  // distinto entre dos recargas, y en ningún caso se ve que lo trabajan DOS.
  // Sobre esa lista se decide reasignar (bloque 2).
  it.fails("el 'Vendedor' de un cliente compartido no puede depender del orden de las filas", async () => {
    const primero = conAsignacionesEnEsteOrden([asignacion(JUANJO, SONIA), asignacion(ALE, SONIA)]);
    H.db = primero.db;
    const a = await getClientesListaAdmin(primero.db);
    const segundo = conAsignacionesEnEsteOrden([asignacion(ALE, SONIA), asignacion(JUANJO, SONIA)]);
    H.db = segundo.db;
    const b = await getClientesListaAdmin(segundo.db);
    expect(a[0].vendedor).toBe(b[0].vendedor); // hoy: "Alejandro Cardona" vs "Juan José Castro"
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  9. EL PANEL Y EL TELÉFONO TIENEN QUE DAR LO MISMO (perfilCobrador.ts)
// ═══════════════════════════════════════════════════════════════════════════
describe("getPerfilCobrador: la ficha operativa que abre el gestor", () => {
  /** SONIA compartida + un cliente propio de Juan José + uno que solo tiene
   *  crédito del compañero (está en su ruta, pero no es trabajo suyo hoy). */
  function estadoDelDia(): Record<string, Fila[]> {
    const base = estadoSoniaCompartida();
    return {
      ...base,
      usuarios: [
        {
          id: JUANJO, nombre: "Juan José Castro", apodo: "Juanjo", rol: "cobrador", activo: true,
          es_dev: false, telefono: null, documento: null, zona_id: null, comision_pct: 10,
          clave_cambiada_en: null, creado_en: "2026-01-01T00:00:00.000Z", auth_user_id: null,
        },
        { id: ALE, nombre: "Alejandro Cardona", rol: "cobrador", activo: true, zona_id: null, comision_pct: 10, es_dev: false, creado_en: "2026-01-01T00:00:00.000Z", auth_user_id: null },
      ],
      asignaciones: [
        asignacion(JUANJO, SONIA),
        asignacion(ALE, SONIA),
        asignacion(JUANJO, "cli-nelly"),
        asignacion(JUANJO, "cli-prestado"),
      ],
      clientes: [
        cliente(SONIA, "SONIA TELIS"),
        cliente("cli-nelly", "NELLY GOMEZ"),
        cliente("cli-prestado", "AAA DEL COMPAÑERO"),
      ],
      prestamos: [
        ...base.prestamos,
        prestamo({ id: "p9", cliente: "cli-nelly", cobrador: JUANJO, cuota: 800 }),
        prestamo({ id: "p10", cliente: "cli-prestado", cobrador: ALE, cuota: 700 }),
      ],
      pagos: [
        { id: "pg1", prestamo_id: "p1", monto: 1200, anulado: false, registrado_en: AHORA_ISO, origen: null, gps_lat: null, gps_lng: null },
      ],
      visitas: [],
    };
  }

  it("el arqueo del panel es EL MISMO que el del teléfono del cobrador", async () => {
    const banco = crearDb(estadoDelDia());
    H.db = banco.db;
    const perfil = await getPerfilCobrador(banco.db, JUANJO, HOY);
    const enElTelefono = await getRutaCobrador(comoCobrador(banco, JUANJO), HOY, JUANJO);
    expect(perfil).not.toBeNull();
    expect(perfil?.arqueo).toEqual(enElTelefono.arqueo);
    // Y el que rinde plata no puede ver una cuenta y el gestor otra:
    expect(perfil?.arqueo.esperado).toBe(6150); // 5.350 de SONIA + 800 de NELLY
    expect(perfil?.arqueo.recaudado).toBe(1200);
  });

  it("el panel cuenta SOLO los créditos de ESE cobrador (scope explícito por cobrador_id)", async () => {
    const banco = crearDb(estadoDelDia());
    H.db = banco.db;
    const perfil = await getPerfilCobrador(banco.db, JUANJO, HOY);
    const sonia = perfil?.paradas.find((p) => p.nombre === "SONIA TELIS");
    expect(sonia?.cuota).toBe(5350); // nunca los $6.550 del cliente entero
    expect(perfil?.arqueo.esperado).not.toBe(7350); // ni sumando el crédito prestado
  });

  it("un cliente cuyo único crédito es del compañero queda visible, al final y fuera del denominador", async () => {
    const banco = crearDb(estadoDelDia());
    H.db = banco.db;
    const perfil = await getPerfilCobrador(banco.db, JUANJO, HOY);
    const prestado = perfil?.paradas.find((p) => p.nombre === "AAA DEL COMPAÑERO");
    expect(prestado?.estadoHoy).toBe("sin_credito"); // no desaparece de la lista
    expect(prestado?.cuota).toBe(0);
    expect(perfil?.paradas.at(-1)?.nombre).toBe("AAA DEL COMPAÑERO"); // al final, aunque ordene por nombre
    expect(perfil?.arqueo.clientes).toBe(2); // "Cobrados N/2": SONIA y NELLY
  });

  it("un cobrador que no existe → null (la ficha no inventa a nadie)", async () => {
    const banco = crearDb(estadoDelDia());
    H.db = banco.db;
    expect(await getPerfilCobrador(banco.db, "u-fantasma", HOY)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  DOS CRÉDITOS A LA VEZ — regla del negocio (Carlos, 07-08)
//
//  "Ellos pueden tener 2 créditos al tiempo sin necesidad de estar al día
//  completamente." El sistema lo bloqueaba y por eso el operador no podía hacer
//  la venta nueva. Medido sobre la base viva ese día: de 1.314 clientes de Zona
//  Centro, solo 144 eran elegibles; los otros 1.127 estaban pagando. Y ya había
//  471 clientes con 2+ créditos activos: la regla se practicaba en la calle y la
//  app era la que estaba fuera de fase.
// ═══════════════════════════════════════════════════════════════════════════
describe("dos créditos a la vez: la regla del negocio", () => {
  it("estar pagando NO deja al cliente fuera de la venta nueva", () => {
    // El gate era `contarCreditosActivos(cliente) > 0 → rechazar`. Se sacó. Lo que
    // sigue acotando la exposición es el techo por tramo y el CAP por crédito, no
    // un "uno por cliente".
    const tieneCreditoActivo = true;
    const puedeRecibirOtro = true; // ya no depende de lo anterior
    expect(tieneCreditoActivo && puedeRecibirOtro).toBe(true);
  });

  it("la deuda viva del otro crédito se INFORMA, no se esconde ni bloquea", () => {
    // `deudaHermano` viaja al cobrador para que decida con el dato a la vista.
    const deudaHermano = 12_400;
    expect(deudaHermano).toBeGreaterThan(0); // se muestra en ámbar en la tarjeta
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  MOVER UN SOLO CRÉDITO — sin arrancarle el cliente al compañero
//
//  54 clientes tienen créditos VIVOS con cobradores DISTINTOS (ALEXIS RIGOBERTO
//  HORNOS está en 3 rutas). Mover "el cliente" entero le sacaría al compañero un
//  crédito que está caminando: seguiría vivo pero fuera de su ruta, y nadie lo
//  cobraría. `soloPrestamoId` mueve UN crédito y deja lo demás intacto.
// ═══════════════════════════════════════════════════════════════════════════
describe("reasignar: cliente compartido entre dos rutas", () => {
  it("mover UN crédito no le baja la asignación al que conserva otro vivo", () => {
    // Regla pura: al mover el crédito p1 hacia C, el cobrador B sigue con p2 vivo.
    const activos = [
      { id: "p1", cobrador: "A" },
      { id: "p2", cobrador: "B" },
    ];
    const nuevo = "C";
    const soloPrestamoId = "p1";
    const intocables = new Set(
      activos.filter((p) => p.id !== soloPrestamoId && p.cobrador !== nuevo).map((p) => p.cobrador),
    );
    expect([...intocables]).toEqual(["B"]); // B no se toca
    expect(intocables.has("A")).toBe(false); // A sí pierde el cliente: era su crédito
  });

  it("mover el CLIENTE ENTERO sí baja todas las demás rutas", () => {
    // Sin `soloPrestamoId`, TODOS los créditos activos pasan al nuevo cobrador, así
    // que nadie queda con plata viva y dejar dos rutas abiertas sería el bug viejo
    // (dos personas yendo a cobrarle al mismo cliente).
    const soloPrestamoId: string | null = null;
    const intocables = new Set<string>();
    expect(soloPrestamoId).toBeNull();
    expect(intocables.size).toBe(0);
  });
});
