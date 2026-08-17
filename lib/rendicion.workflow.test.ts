// ─────────────────────────────────────────────────────────────────────────
//  CAJA DEL DÍA · RENDICIÓN · CIERRE DE ZONA — pruebas de WORKFLOW.
//
//  La regla que no se negocia: la plata TIENE que cuadrar peso a peso.
//      esperado = base + cobrado − gastos      (nunca negativo)
//      diferencia = entregado − esperado       (<0 faltante · >0 sobrante)
//  Y la cadena de custodia: cobrador → supervisor de la zona → caja central.
//  Cada eslabón se sella UNA vez y es inmutable, así que el hueco tiene que
//  aflorar EN EL MOMENTO del cierre (que es cuando todavía se puede ir a
//  buscar el efectivo), no a la mañana siguiente.
//
//  Acá se prueba el recorrido completo, no solo la aritmética:
//   · lo que el cobrador cobró de verdad (nativos, ni importados ni anulados),
//   · una recuperación de DEUDA VIEJA que no cuenta para la meta del día pero
//     SÍ es plata en la mano,
//   · gastos FANTASMA que no pueden bajar el esperado,
//   · la base que no se puede mover DESPUÉS de rendir (fabricar un faltante),
//   · el sello de la zona con pendientes / con cobro post-rendición,
//   · la comisión POR QUINCENA (la cadencia con la que se paga, 08-05).
//
//  Los tests marcados "⚠️ FALLA: bug real, ver informe" están escritos con
//  `it.fails`: hoy la fuente NO cumple la regla, y el test queda como candado
//  invertido — el día que se arregle, `it.fails` se pone en rojo y hay que
//  sacarle el `.fails`. NO se tocó ninguna fuente para hacerlos pasar.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { calcularRendicion } from "./rendicion";
import { consolidarPorZona, type RendidaLite, type PendienteLite } from "./cierreZona";
import { calcularComision } from "./comision";
import { clasificarClienteRuta } from "@/lib/data/ruta";
import {
  periodoKeyDe,
  rangoDePeriodoKey,
  rangosSeSolapan,
  getComisionesPeriodo,
} from "@/lib/data/comisiones";
import { getLiquidacionDiaria } from "@/lib/data/liquidacion";
import { getMisNumeros } from "@/lib/data/misNumeros";

// ─────────────────────────────────────────────────────────────────────────
//  Doble de Supabase: un query-builder encadenable que SÍ respeta los filtros
//  (.eq/.is/.in/.gte/.lt…). Que los respete es el punto: media prueba de plata
//  acá es justamente "esta fila NO tiene que entrar" (pago anulado, importado
//  del empalme, de ayer, de otro cobrador). Un fake que ignora los filtros
//  daría verde a cualquier cosa.
// ─────────────────────────────────────────────────────────────────────────
type Fila = Record<string, unknown>;
type Tablas = Record<string, Fila[]>;

interface FakeDb {
  cliente: SupabaseClient;
  /** Lo que la app ESCRIBIÓ (insert/upsert): la evidencia del test. */
  escrituras: { tabla: string; fila: Fila }[];
}

/** Los timestamps se comparan como INSTANTES, no como texto: en el código
 *  conviven "…T03:00:00.000Z" y "…T00:00:00-03:00" y comparar strings mentiría. */
function comparable(v: unknown): number | string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return Date.parse(v);
  if (typeof v === "number" || typeof v === "string") return v;
  return String(v);
}

function fakeDb(tablas: Tablas, rpcs: Record<string, unknown> = {}): FakeDb {
  const escrituras: { tabla: string; fila: Fila }[] = [];
  const cliente = {
    rpc: (nombre: string) =>
      Promise.resolve(
        nombre in rpcs
          ? { data: rpcs[nombre], error: null }
          : { data: null, error: { code: "42883", message: `no existe la función ${nombre}` } },
      ),
    from(tabla: string) {
      const filtros: ((f: Fila) => boolean)[] = [];
      const filas = (): Fila[] => (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f)));
      const b: Record<string, unknown> = {
        select: () => b,
        order: () => b,
        limit: () => b,
        update: () => b,
        eq: (c: string, v: unknown) => {
          filtros.push((f) => f[c] === v);
          return b;
        },
        neq: (c: string, v: unknown) => {
          filtros.push((f) => f[c] !== v);
          return b;
        },
        is: (c: string, v: unknown) => {
          filtros.push((f) => (v === null ? f[c] == null : f[c] === v));
          return b;
        },
        in: (c: string, v: readonly unknown[]) => {
          filtros.push((f) => v.includes(f[c]));
          return b;
        },
        gte: (c: string, v: unknown) => {
          filtros.push((f) => comparable(f[c]) >= comparable(v));
          return b;
        },
        gt: (c: string, v: unknown) => {
          filtros.push((f) => comparable(f[c]) > comparable(v));
          return b;
        },
        lte: (c: string, v: unknown) => {
          filtros.push((f) => comparable(f[c]) <= comparable(v));
          return b;
        },
        lt: (c: string, v: unknown) => {
          filtros.push((f) => comparable(f[c]) < comparable(v));
          return b;
        },
        range: (d: number, h: number) => Promise.resolve({ data: filas().slice(d, h + 1), error: null }),
        maybeSingle: () => Promise.resolve({ data: filas()[0] ?? null, error: null }),
        insert: (fila: Fila) => {
          escrituras.push({ tabla, fila });
          if (!tablas[tabla]) tablas[tabla] = [];
          tablas[tabla].push(fila);
          return Promise.resolve({ error: null });
        },
        upsert: (fila: Fila) => {
          escrituras.push({ tabla, fila });
          if (!tablas[tabla]) tablas[tabla] = [];
          const lista = tablas[tabla];
          const i = lista.findIndex(
            (f) => f.cobrador_id === fila.cobrador_id && f.fecha === fila.fecha,
          );
          if (i >= 0) lista[i] = fila;
          else lista.push(fila);
          return Promise.resolve({ error: null });
        },
        then: (ok: (r: { data: Fila[]; error: null; count: number }) => unknown) =>
          ok({ data: filas(), error: null, count: filas().length }),
      };
      return b;
    },
  };
  return { cliente: cliente as unknown as SupabaseClient, escrituras };
}

// ── Infraestructura mockeada (sesión, clientes de BD, auditoría) ──────────
// Solo INFRA: la lógica de plata (rendición, aperturas, solicitudes de gasto,
// comisiones) corre REAL contra el doble de BD.
const usuarioActual = vi.fn();
const actorActual = vi.fn();
const bloqueoSoloLectura = vi.fn();
const registrarAuditoria = vi.fn();
const registrarBitacora = vi.fn();
const getCierrePorZona = vi.fn();

let tablas: Tablas = {};
let dbServer: FakeDb = fakeDb({});
let dbAdmin: FakeDb = fakeDb({});

/** Monta un mundo: MISMAS tablas para el cliente de sesión y el admin (en prod
 *  son la misma BD; lo que escribe la rendición por admin lo lee el panel). */
function montar(t: Tablas, rpcs: Record<string, unknown> = {}): void {
  tablas = t;
  dbServer = fakeDb(tablas, rpcs);
  dbAdmin = fakeDb(tablas, rpcs);
}

/** Todo lo que se escribió en una tabla (por cualquiera de los dos clientes). */
function escritas(tabla: string): Fila[] {
  return [...dbServer.escrituras, ...dbAdmin.escrituras]
    .filter((e) => e.tabla === tabla)
    .map((e) => e.fila);
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServer: async () => dbServer.cliente }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdmin: () => dbAdmin.cliente }));
vi.mock("@/lib/observabilidad", () => ({ reportarError: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getUsuarioActual: () => usuarioActual(),
  getActorActual: () => actorActual(),
  esGestor: (rol: string) => rol === "admin" || rol === "supervisor",
  esAdmin: (rol: string) => rol === "admin",
  esCobrador: (rol: string) => rol === "cobrador",
}));
vi.mock("@/lib/data/featureFlags", () => ({ bloqueoSoloLectura: () => bloqueoSoloLectura() }));
vi.mock("@/lib/data/auditoria", () => ({
  registrarAuditoria: (...a: unknown[]) => registrarAuditoria(...a),
}));
vi.mock("@/lib/data/bitacora", () => ({
  registrarBitacora: (...a: unknown[]) => registrarBitacora(...a),
}));
// El cierre de zona se alimenta de un consolidado REAL (armado con el núcleo
// puro en cada test); lo único que se stubea es la lectura a la BD.
vi.mock("@/lib/data/cierreZona", () => ({
  getCierrePorZona: (...a: unknown[]) => getCierrePorZona(...a),
}));

import { cerrarJornada } from "@/lib/acciones/rendicion";
import { setApertura, setAperturasLote } from "@/lib/acciones/aperturas";
import { confirmarCierreZona } from "@/lib/acciones/cierreZona";

beforeEach(() => {
  vi.clearAllMocks();
  bloqueoSoloLectura.mockResolvedValue(null);
  registrarAuditoria.mockResolvedValue(undefined);
  registrarBitacora.mockResolvedValue(undefined);
  montar({});
});

// ═════════════════════════════════════════════════════════════════════════
//  1 · LA ECUACIÓN DE LA CAJA DEL DÍA
// ═════════════════════════════════════════════════════════════════════════
describe("La caja del día: base + cobrado − gastos − entregado", () => {
  it("la base de la mañana vuelve junto con lo cobrado: si no vuelve, es faltante exacto", () => {
    // Arrancó con $5.000, cobró $30.000, gastó $2.000 de nafta aprobada.
    expect(calcularRendicion(30000, 2000, 33000, 5000).estado).toBe("cuadra");
    // Entrega solo lo cobrado menos el gasto: se quedó con la base.
    const r = calcularRendicion(30000, 2000, 28000, 5000);
    expect(r.esperado).toBe(33000);
    expect(r.diferencia).toBe(-5000);
    expect(r.estado).toBe("faltante");
  });

  it("un solo peso de menos YA es faltante: la caja no tiene tolerancia", () => {
    const r = calcularRendicion(23000, 0, 22999);
    expect(r.diferencia).toBe(-1);
    expect(r.estado).toBe("faltante");
  });

  it("con gastos mayores al efectivo, el esperado es 0 y lo que entrega igual es sobrante", () => {
    // No se le puede exigir plata negativa, pero si entrega algo hay que anotarlo.
    const r = calcularRendicion(1000, 9000, 500, 0);
    expect(r.esperado).toBe(0);
    expect(r.diferencia).toBe(500);
    expect(r.estado).toBe("sobrante");
  });

  it("todo se asienta a peso ENTERO: la cuota fraccionaria heredada no deja centésimos", () => {
    // Cuota heredada de Disapp 351,04 → el pago se asienta entero.
    const r = calcularRendicion(351.04, 0, 351);
    expect(r.esperado).toBe(351);
    expect(r.diferencia).toBe(0);
    expect(Number.isInteger(r.esperado)).toBe(true);
    // 351,6 redondea PARA ARRIBA: ahí sí queda $1 de faltante visible.
    expect(calcularRendicion(351.6, 0, 351).diferencia).toBe(-1);
  });

  it("recuperar DEUDA VIEJA no cuenta para la meta del día pero SÍ entra a la caja", () => {
    // Cliente con un crédito vigente (cuota 1.200, cobrada) y uno de plazo
    // vencido en el que recuperó $3.000 de deuda vieja.
    const cliente = clasificarClienteRuta(
      [
        { cuota: 1200, pagadoHoy: 1200, plazoVencido: false },
        { cuota: 800, pagadoHoy: 3000, plazoVencido: true },
      ],
      false,
    );
    expect(cliente.pagadoHoyEnTermino).toBe(1200); // meta del día
    expect(cliente.pagadoHoyTotal).toBe(4200); // plata en la mano
    expect(cliente.cuotaEnTermino).toBe(1200); // el vencido no infla el target

    // La rendición se mide contra la PLATA, no contra la meta.
    expect(calcularRendicion(cliente.pagadoHoyTotal, 0, 4200).estado).toBe("cuadra");
    // Si solo entregara la meta del día, la recuperación aparecería como faltante.
    const r = calcularRendicion(cliente.pagadoHoyTotal, 0, cliente.pagadoHoyEnTermino);
    expect(r.diferencia).toBe(-3000);
    expect(r.estado).toBe("faltante");
  });

  it("cobrar de más (sobrante) no compensa un gasto no declarado: son señales distintas", () => {
    expect(calcularRendicion(30000, 0, 30500).estado).toBe("sobrante");
    expect(calcularRendicion(30000, 0, 30500).diferencia).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  2 · EL CONSOLIDADO DE LA ZONA (núcleo puro del sello)
// ═════════════════════════════════════════════════════════════════════════
describe("consolidarPorZona — la zona tiene que cuadrar peso a peso", () => {
  const nombreZona = new Map<string, string>([
    ["z1", "Zona Centro"],
    ["z2", "Zona Norte"],
  ]);
  const zonaDe = new Map<string, string | null>([
    ["ana", "z1"],
    ["pedro", "z1"],
    ["beto", "z2"],
  ]);
  const rend = (o: Partial<RendidaLite> & { cobradorId: string }): RendidaLite => ({
    nombre: o.cobradorId,
    recaudado: 0,
    gastos: 0,
    entregado: 0,
    diferencia: 0,
    estado: "cuadra",
    ...o,
  });

  it("invariante del sello: esperado − entregado ≡ faltante − sobrante", () => {
    const c = consolidarPorZona(
      [
        // Ana: base 4.000, cobró 20.000, gastó 1.000 → esperado 23.000, entregó 23.000.
        rend({
          cobradorId: "ana",
          base: 4000,
          recaudado: 20000,
          gastos: 1000,
          entregado: 23000,
          diferencia: 0,
        }),
        // Beto: cobró 10.000 y entregó 9.500 → faltante 500.
        rend({
          cobradorId: "beto",
          recaudado: 10000,
          entregado: 9500,
          diferencia: -500,
          estado: "faltante",
        }),
      ],
      [],
      zonaDe,
      nombreZona,
    );
    const esperado = c.zonas.reduce((s, z) => s + z.totalEsperado, 0);
    expect(esperado - c.totalEntregado).toBe(c.totalFaltante - c.totalSobrante);
    expect(c.totalFaltante).toBe(500);
    expect(c.totalSobrante).toBe(0);
  });

  it("la base que el supervisor entregó a la mañana sube el esperado de la zona", () => {
    const sinBase = consolidarPorZona(
      [rend({ cobradorId: "ana", recaudado: 20000, entregado: 20000 })],
      [],
      zonaDe,
      nombreZona,
    );
    // Con base 5.000 y ENTREGANDO los 25.000: la base se devuelve → esperado 25.000.
    const conBase = consolidarPorZona(
      [rend({ cobradorId: "ana", base: 5000, recaudado: 20000, entregado: 25000 })],
      [],
      zonaDe,
      nombreZona,
    );
    expect(sinBase.zonas[0].totalEsperado).toBe(20000);
    expect(conBase.zonas[0].totalEsperado).toBe(25000); // los $5.000 se devuelven
    expect(conBase.zonas[0].cobradores[0].base).toBe(5000);
    // Con base 5.000, entregando 20.000 y diferencia 0 = SE QUEDÓ la base
    // declarada ("me quedo para mañana", 16-08): al supervisor le van 20.000.
    const seQuedo = consolidarPorZona(
      [rend({ cobradorId: "ana", base: 5000, recaudado: 20000, entregado: 20000, diferencia: 0 })],
      [],
      zonaDe,
      nombreZona,
    );
    expect(seQuedo.zonas[0].totalEsperado).toBe(20000);
    expect(seQuedo.zonas[0].cobradores[0].retenido).toBe(5000);
    // Y si NO lo declaró (diferencia −5.000): faltante, el esperado sigue en 25.000.
    const faltante = consolidarPorZona(
      [rend({ cobradorId: "ana", base: 5000, recaudado: 20000, entregado: 20000, diferencia: -5000, estado: "faltante" })],
      [],
      zonaDe,
      nombreZona,
    );
    expect(faltante.zonas[0].totalEsperado).toBe(25000);
    expect(faltante.totalFaltante).toBe(5000);
  });

  it("la plata del que todavía NO rindió no se cuenta como recibida: va a 'por rendir'", () => {
    const pendientes: PendienteLite[] = [
      { cobradorId: "pedro", nombre: "Pedro", recaudado: 8000, cobros: 9 },
    ];
    const c = consolidarPorZona(
      [rend({ cobradorId: "ana", recaudado: 20000, entregado: 20000 })],
      pendientes,
      zonaDe,
      nombreZona,
    );
    const z = c.zonas[0];
    expect(z.porRendir).toBe(8000);
    expect(z.pendientes).toBe(1);
    expect(z.totalRecaudado).toBe(28000); // la zona cobró 28.000
    expect(z.totalEsperado).toBe(20000); // pero solo se le exige al que rindió
    expect(z.totalFaltante).toBe(0); // no rindió ≠ le falta plata
  });

  it("el faltante de una zona no contamina a la otra", () => {
    const c = consolidarPorZona(
      [
        rend({
          cobradorId: "ana",
          recaudado: 20000,
          entregado: 18000,
          diferencia: -2000,
          estado: "faltante",
        }),
        rend({ cobradorId: "beto", recaudado: 10000, entregado: 10000 }),
      ],
      [],
      zonaDe,
      nombreZona,
    );
    const z1 = c.zonas.find((z) => z.zonaId === "z1")!;
    const z2 = c.zonas.find((z) => z.zonaId === "z2")!;
    expect(z1.totalFaltante).toBe(2000);
    expect(z2.totalFaltante).toBe(0);
    expect(c.zonas[0].zonaId).toBe("z1"); // la que hace ruido, primero
  });

  it("lo cobrado DESPUÉS de rendir está en el bolsillo: el sello lo reclama hoy", () => {
    const c = consolidarPorZona(
      [
        rend({
          cobradorId: "ana",
          base: 2000,
          recaudado: 20000,
          entregado: 22000,
          diferencia: 0,
          recaudadoVivo: 20800, // cobró 800 más después de cerrar
        }),
      ],
      [],
      zonaDe,
      nombreZona,
    );
    const z = c.zonas[0];
    expect(z.cobradores[0].cobroPostCierre).toBe(800);
    expect(z.totalEsperado).toBe(22800);
    expect(z.totalFaltante).toBe(800);
    expect(z.totalEsperado - z.totalEntregado).toBe(z.totalFaltante - z.totalSobrante);
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo 1, severidad alta).
  // Pedro tiene $5.000 de base del supervisor y NO cobró a nadie → no está ni en
  // `rendidas` ni en `pendientes` (ambos se derivan de la tabla `pagos`). El
  // consolidado no lo ve, `porRendir` da 0 y la zona se sella —única e inmutable—
  // con $5.000 de la empresa en la calle sin registro de custodia.
  // ⏸️ PENDIENTE DE DECISIÓN (06-08). Tres revisores independientes: 2 lo dejaron
  // en DUDOSO y 1 en bug real. Impacto HOY = $0 porque `aperturas_caja` está
  // VACÍA (nunca se cargó una base a nadie), que es justo el caso 5 que Carlos
  // tiene que definir. Cuando se carguen bases de verdad, esto pasa a ser plata de
  // la empresa que sale y no se reclama en el único momento en que se puede.
  it.fails("la base del cobrador que no cobró nada tiene que contar como plata en la calle", () => {
    const c = consolidarPorZona(
      [rend({ cobradorId: "ana", base: 4000, recaudado: 20000, entregado: 24000 })],
      [], // Pedro no aparece: cero pagos, aunque se llevó $5.000 de base
      zonaDe,
      nombreZona,
    );
    const z = c.zonas[0];
    expect(z.porRendir).toBe(5000); // hoy: 0 — la base de Pedro es invisible
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  3 · CERRAR JORNADA (rendición del cobrador, de punta a punta)
// ═════════════════════════════════════════════════════════════════════════
describe("cerrarJornada — lo que el cobrador entrega al final del día", () => {
  const COB = "cob-1";
  const AHORA = new Date("2026-08-06T15:00:00Z"); // jueves 06-08-2026, 12:00 en UY
  const HOY_UY = "2026-08-06";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    usuarioActual.mockResolvedValue({ id: COB, nombre: "Ana", rol: "cobrador", activo: true });
    montar({
      // Cobros de HOY: cuota del día + cuota del día + recuperación de deuda vieja.
      pagos: [
        { id: 1, monto: 12000, registrado_por: COB, anulado: false, origen: null, registrado_en: "2026-08-06T12:00:00Z" },
        { id: 2, monto: 8000, registrado_por: COB, anulado: false, origen: null, registrado_en: "2026-08-06T13:30:00Z" },
        { id: 3, monto: 3000, registrado_por: COB, anulado: false, origen: null, registrado_en: "2026-08-06T14:10:00Z" },
      ],
      // Vales del día: $2.000 aprobados + $500 todavía pendientes.
      solicitudes_gasto: [
        { id: "s1", cobrador_id: COB, monto: 2000, estado: "aprobada", solicitado_en: "2026-08-06T11:00:00Z" },
        { id: "s2", cobrador_id: COB, monto: 500, estado: "pendiente", solicitado_en: "2026-08-06T14:00:00Z" },
      ],
      aperturas_caja: [{ cobrador_id: COB, fecha: HOY_UY, base: 5000 }],
      rendiciones: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("el recaudado lo pone el SERVIDOR: base + cobros − gastos aprobados", async () => {
    const r = await cerrarJornada({ gastos: 2000, entregado: 26000 });
    expect(r).toEqual({ ok: true, estado: "cuadra", diferencia: 0, esperado: 26000 });
    const fila = escritas("rendiciones")[0];
    expect(fila.recaudado).toBe(23000); // 12.000 + 8.000 + 3.000 (la deuda vieja incluida)
    expect(fila.cobros_cantidad).toBe(3);
    expect(fila.base).toBe(5000);
    expect(fila.gastos).toBe(2000);
    expect(fila.entregado).toBe(26000);
    expect(fila.diferencia).toBe(0);
    expect(fila.fecha).toBe(HOY_UY); // el día UY se captura una vez, no lo pone la BD
  });

  it("los pagos IMPORTADOS del empalme, los ANULADOS y los de AYER no son efectivo en la mano", async () => {
    tablas.pagos.push(
      // Top-up del empalme con Disapp: lleva su registrado_por pero nadie lo tocó.
      { id: 4, monto: 644806, registrado_por: COB, anulado: false, origen: "disapp_import", registrado_en: "2026-08-06T09:00:00Z" },
      { id: 5, monto: 5000, registrado_por: COB, anulado: true, origen: null, registrado_en: "2026-08-06T12:30:00Z" },
      { id: 6, monto: 4000, registrado_por: COB, anulado: false, origen: null, registrado_en: "2026-08-05T20:00:00Z" },
      // Cobro de un compañero: no es su custodia.
      { id: 7, monto: 9000, registrado_por: "cob-2", anulado: false, origen: null, registrado_en: "2026-08-06T12:00:00Z" },
    );
    const r = await cerrarJornada({ gastos: 0, entregado: 28000 });
    expect(r).toEqual({ ok: true, estado: "cuadra", diferencia: 0, esperado: 28000 });
    expect(escritas("rendiciones")[0].recaudado).toBe(23000);
  });

  it("el corte de las 03:00Z en la rendición: 02:30Z es de AYER, 03:30Z ya es de HOY", async () => {
    // Sesión de caos 15-08: "ayer" solo se testeaba a las 20:00Z — nunca pegado
    // al corte uruguayo. Un cobro de las 23:30 UY (02:30Z) pertenece a AYER.
    tablas.pagos.push(
      { id: 8, monto: 1000, registrado_por: COB, anulado: false, origen: null, registrado_en: "2026-08-06T02:30:00Z" },
      { id: 9, monto: 700, registrado_por: COB, anulado: false, origen: null, registrado_en: "2026-08-06T03:30:00Z" },
    );
    const r = await cerrarJornada({ gastos: 2000, entregado: 26700 });
    expect(r).toEqual({ ok: true, estado: "cuadra", diferencia: 0, esperado: 26700 });
    const fila = escritas("rendiciones")[0];
    expect(fila.recaudado).toBe(23700); // +700 de las 00:30 UY; los 1.000 de ayer NO
    expect(fila.cobros_cantidad).toBe(4);
  });

  it("los gastos FANTASMA no bajan el esperado: el excedente aflora como faltante", async () => {
    // Declara $9.000 de gastos con solo $2.500 respaldados (2.000 aprobados + 500
    // pendientes) y entrega como si los $9.000 fueran válidos.
    const r = await cerrarJornada({ gastos: 9000, entregado: 19000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.esperado).toBe(25500); // 5.000 + 23.000 − 2.500
    expect(r.diferencia).toBe(-6500); // exactamente el excedente sin comprobar
    expect(r.estado).toBe("faltante");
    const fila = escritas("rendiciones")[0];
    expect(fila.gastos).toBe(2500);
    expect(String(fila.notas)).toContain("sin comprobar");
  });

  it("si no devuelve la base, la rendición lo marca como faltante (no como 'cuadra')", async () => {
    const r = await cerrarJornada({ gastos: 0, entregado: 23000 });
    expect(r).toEqual({ ok: true, estado: "faltante", diferencia: -5000, esperado: 28000 });
  });

  it("no se puede rendir dos veces el mismo día (el libro de la jornada es único)", async () => {
    const primera = await cerrarJornada({ gastos: 0, entregado: 28000 });
    expect(primera.ok).toBe(true);
    const segunda = await cerrarJornada({ gastos: 0, entregado: 28000 });
    expect(segunda).toEqual({ ok: false, error: "Ya cerraste tu jornada de hoy." });
    expect(escritas("rendiciones")).toHaveLength(1);
  });

  it("en modo solo-lectura (freeze) no se escribe ninguna rendición", async () => {
    bloqueoSoloLectura.mockResolvedValue({ ok: false, error: "Sistema en mantenimiento." });
    const r = await cerrarJornada({ gastos: 0, entregado: 28000 });
    expect(r.ok).toBe(false);
    expect(escritas("rendiciones")).toHaveLength(0);
  });

  it("una sesión caída no cierra la caja de nadie", async () => {
    usuarioActual.mockResolvedValue(null);
    const r = await cerrarJornada({ gastos: 0, entregado: 28000 });
    expect(r).toEqual({ ok: false, error: "Sesión no válida." });
    expect(escritas("rendiciones")).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  4 · LA BASE NO SE MUEVE DESPUÉS DE RENDIR
// ═════════════════════════════════════════════════════════════════════════
describe("Base de caja — no se puede fabricar un faltante moviéndola", () => {
  const ANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const PEDRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
  const AHORA = new Date("2026-08-06T15:00:00Z");
  const HOY_UY = "2026-08-06";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    usuarioActual.mockResolvedValue({
      id: "sup-1",
      nombre: "Mauricio",
      rol: "supervisor",
      activo: true,
    });
    montar({ rendiciones: [], aperturas_caja: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("el gestor fija la base de la mañana: queda a peso entero y con la fecha de hoy", async () => {
    const r = await setApertura({ cobradorId: ANA, base: 5000.6 });
    expect(r).toEqual({ ok: true });
    const fila = escritas("aperturas_caja")[0];
    expect(fila.base).toBe(5001);
    expect(fila.fecha).toBe(HOY_UY);
    expect(fila.cobrador_id).toBe(ANA);
  });

  it("una base negativa se guarda como 0 (nunca plata en contra)", async () => {
    await setApertura({ cobradorId: ANA, base: -3000 });
    expect(escritas("aperturas_caja")[0].base).toBe(0);
  });

  it("si el cobrador YA rindió, la base queda sellada: no se le puede subir para acusarlo", async () => {
    tablas.rendiciones.push({ id: "r1", cobrador_id: ANA, fecha: HOY_UY });
    const r = await setApertura({ cobradorId: ANA, base: 50000 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("sellada");
    expect(escritas("aperturas_caja")).toHaveLength(0);
  });

  it("en lote: al que ya rindió se lo rechaza y a los demás se les guarda igual", async () => {
    tablas.rendiciones.push({ id: "r1", cobrador_id: ANA, fecha: HOY_UY });
    const r = await setAperturasLote({
      items: [
        { cobradorId: ANA, base: 9000 },
        { cobradorId: PEDRO, base: 5000 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.guardadas).toBe(1);
    expect(r.rechazadas).toHaveLength(1);
    expect(r.rechazadas[0].cobradorId).toBe(ANA);
    const filas = escritas("aperturas_caja");
    expect(filas).toHaveLength(1);
    expect(filas[0].cobrador_id).toBe(PEDRO);
    expect(filas[0].base).toBe(5000);
  });

  it("un cobrador que no existe (id forjado) no genera base", async () => {
    const r = await setApertura({ cobradorId: "no-es-uuid", base: 5000 });
    expect(r).toEqual({ ok: false, error: "Cobrador inválido." });
    expect(escritas("aperturas_caja")).toHaveLength(0);
  });

  it("un cobrador no puede fijarse su propia base (solo gestor)", async () => {
    usuarioActual.mockResolvedValue({ id: ANA, nombre: "Ana", rol: "cobrador", activo: true });
    const r = await setApertura({ cobradorId: ANA, base: 90000 });
    expect(r).toEqual({ ok: false, error: "No tenés permisos." });
    expect(escritas("aperturas_caja")).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  5 · EL SELLO DE LA ZONA (supervisor → caja central)
// ═════════════════════════════════════════════════════════════════════════
describe("confirmarCierreZona — el supervisor firma por el efectivo que recibió", () => {
  const AHORA = new Date("2026-08-06T15:00:00Z");
  const nombreZona = new Map<string, string>([["z1", "Zona Centro"]]);
  const zonaDe = new Map<string, string | null>([
    ["ana", "z1"],
    ["pedro", "z1"],
  ]);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
    usuarioActual.mockResolvedValue({ id: "sup-1", nombre: "Mauricio", rol: "admin", activo: true });
    actorActual.mockResolvedValue({ rol: "admin", usuarioId: "sup-1" });
    montar({ cierres_zona: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Consolidado REAL del núcleo puro, servido como si viniera de la BD. */
  function consolidado(rendidas: RendidaLite[], pendientes: PendienteLite[] = []) {
    const c = consolidarPorZona(rendidas, pendientes, zonaDe, nombreZona);
    getCierrePorZona.mockResolvedValue({
      consolidado: c,
      disponible: true,
      confirmacionesDisponible: true,
    });
    return c;
  }

  it("no se sella una zona con cobradores sin rendir: esa plata sigue en la calle", async () => {
    consolidado(
      [
        {
          cobradorId: "ana",
          nombre: "Ana",
          recaudado: 20000,
          gastos: 0,
          entregado: 20000,
          diferencia: 0,
          estado: "cuadra",
        },
      ],
      [{ cobradorId: "pedro", nombre: "Pedro", recaudado: 8000, cobros: 9 }],
    );
    const r = await confirmarCierreZona({ zonaId: "z1" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("por rendir");
    expect(escritas("cierres_zona")).toHaveLength(0);
  });

  it("sella con los totales del servidor y deja escrito el cobro POST-rendición", async () => {
    consolidado([
      {
        cobradorId: "ana",
        nombre: "Ana",
        recaudado: 20000,
        gastos: 0,
        entregado: 20000,
        diferencia: 0,
        estado: "cuadra",
        recaudadoVivo: 20300, // cobró $300 después de rendir
      },
    ]);
    const r = await confirmarCierreZona({ zonaId: "z1" });
    expect(r).toEqual({ ok: true });
    const fila = escritas("cierres_zona")[0];
    expect(fila.total_esperado).toBe(20300); // incluye lo que quedó en el bolsillo
    expect(fila.total_entregado).toBe(20000);
    expect(fila.diferencia).toBe(-300); // el hueco se ve HOY, no mañana
    expect(fila.fecha).toBe("2026-08-06");
    expect(fila.cobradores_rendidos).toBe(1);
    expect(String(fila.notas)).toContain("DESPUÉS de rendir");
  });

  it("una zona sin nada que cerrar no genera un sello vacío", async () => {
    consolidado([]);
    const r = await confirmarCierreZona({ zonaId: "z1" });
    expect(r).toEqual({ ok: false, error: "No hay recaudo para cerrar hoy." });
    expect(escritas("cierres_zona")).toHaveLength(0);
  });

  it("el bucket 'sin zona' (Caja del día) no lo sella un supervisor", async () => {
    consolidado([]);
    usuarioActual.mockResolvedValue({
      id: "sup-2",
      nombre: "Supervisor",
      rol: "supervisor",
      activo: true,
    });
    actorActual.mockResolvedValue({ rol: "supervisor", usuarioId: "sup-2", zonasSupervisadas: ["z1"] });
    const r = await confirmarCierreZona({ zonaId: "__sin_zona__" });
    expect(r).toEqual({ ok: false, error: "No podés cerrar esta caja." });
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo 1, severidad alta).
  // Pedro se llevó $5.000 de base y no cobró a nadie: no es "pendiente" (los
  // pendientes salen de `pagos`), así que el guard de pendientes no lo ve y la
  // zona se sella —única e inmutable— sin reclamarle esa plata.
  // ⏸️ PENDIENTE DE DECISIÓN (06-08), mismo origen que el anterior. Dos de tres
  // revisores lo dieron por NO_ES_BUG. El sello de zona es único e inmutable, así
  // que si se decide contar la base sin devolver, hay que hacerlo ANTES de sellar.
  it.fails("no debería sellarse la zona con una base entregada que nadie devolvió", async () => {
    const c = consolidado([
      {
        cobradorId: "ana",
        nombre: "Ana",
        recaudado: 20000,
        gastos: 0,
        entregado: 24000,
        diferencia: 0,
        estado: "cuadra",
        base: 4000,
      },
    ]);
    // Así lo ve hoy el supervisor: solo un nombre, sin el monto de su base.
    c.zonas[0].sinActividad = [{ cobradorId: "pedro", nombre: "Pedro" }];
    const r = await confirmarCierreZona({ zonaId: "z1" });
    expect(r.ok).toBe(false); // hoy sella igual (ok: true)
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  6 · COMISIÓN POR QUINCENA (la cadencia con la que se paga, 08-05)
// ═════════════════════════════════════════════════════════════════════════
describe("Comisión por quincena", () => {
  const AHORA = new Date("2026-08-05T15:00:00Z"); // 05-08-2026 → 1ª quincena
  const ANA = "ana";
  const BETO = "beto";

  it("la comisión es un % del recaudado, siempre a peso entero", () => {
    expect(calcularComision(400000, 3)).toBe(12000);
    expect(calcularComision(6550, 3)).toBe(197); // 196,50 → redondea para arriba
    expect(Number.isInteger(calcularComision(8425, 3))).toBe(true);
  });

  it("un porcentaje fuera de rango no puede regalar ni robar plata", () => {
    expect(calcularComision(100000, -5)).toBe(0);
    expect(calcularComision(100000, 500)).toBe(100000); // tope 100%
    expect(calcularComision(100000, Number.NaN)).toBe(0);
  });

  it("las dos quincenas del mismo mes NO se solapan (no se paga dos veces)", () => {
    const primera = rangoDePeriodoKey("quincena:2026-08-01")!;
    const segunda = rangoDePeriodoKey("quincena:2026-08-16")!;
    expect(primera).toEqual({ desde: "2026-08-01", hasta: "2026-08-15" });
    expect(segunda).toEqual({ desde: "2026-08-16", hasta: "2026-08-31" });
    expect(rangosSeSolapan(primera, segunda)).toBe(false);
  });

  it("una quincena está DENTRO del mes: liquidar el mes después sería pagar dos veces", () => {
    const quincena = rangoDePeriodoKey("quincena:2026-08-01")!;
    const mes = rangoDePeriodoKey("mes:2026-08")!;
    expect(rangosSeSolapan(quincena, mes)).toBe(true);
  });

  it("la clave de la quincena la fija el DÍA DE INICIO, no el día en que se liquida", () => {
    expect(periodoKeyDe("quincena", "2026-08-01")).toBe("quincena:2026-08-01");
    expect(periodoKeyDe("quincena", "2026-08-16")).toBe("quincena:2026-08-16");
    // Febrero: la 2ª quincena termina el 28 (o el 29 si es bisiesto).
    expect(rangoDePeriodoKey("quincena:2026-02-16")!.hasta).toBe("2026-02-28");
    expect(rangoDePeriodoKey("quincena:2028-02-16")!.hasta).toBe("2028-02-29");
  });

  /** Mundo del panel de comisiones: la RPC 0069 atribuye por DUEÑO DE LA RUTA. */
  function montarComisiones(opts: {
    porRuta?: { cobrador_id: string; recaudado: number; cobros: number }[] | null;
    usuarios: Fila[];
    liquidadas?: Fila[];
  }) {
    const rpcs: Record<string, unknown> = {
      app_recaudo_agregado: {
        recaudado: 500000,
        cobros: 300,
        serie: [],
        // Atribución por QUIEN REGISTRÓ el pago (custodia): a propósito distinta.
        porCobrador: [{ id: BETO, v: 500000, n: 300 }],
      },
      app_suma_pagos_entre: 0,
      app_cuenta_pagos_entre: 0,
    };
    if (opts.porRuta) rpcs.app_comision_por_ruta = opts.porRuta;
    montar(
      {
        usuarios: opts.usuarios,
        comisiones_liquidadas: opts.liquidadas ?? [],
        prestamos: [],
      },
      rpcs,
    );
  }

  it("la quincena en curso se liquida con la clave y el rango de la quincena", async () => {
    montarComisiones({
      porRuta: [{ cobrador_id: ANA, recaudado: 400000, cobros: 220 }],
      usuarios: [{ id: ANA, nombre: "Ana", comision_pct: 3, rol: "cobrador", activo: true }],
    });
    const r = await getComisionesPeriodo(dbServer.cliente, "quincena", AHORA);
    expect(r.periodoKey).toBe("quincena:2026-08-01");
    expect(r.desde).toBe("2026-08-01");
    expect(r.hasta).toBe("2026-08-05"); // quincena EN CURSO: hasta hoy
    expect(r.filas[0].comision).toBe(12000);
    expect(r.totalComision).toBe(12000);
  });

  it("la comisión se le paga al DUEÑO DE LA RUTA, no a quien registró el cobro", async () => {
    // Caso real: el cobrador B le registró $400.000 a clientes de la ruta de A.
    montarComisiones({
      porRuta: [{ cobrador_id: ANA, recaudado: 400000, cobros: 220 }],
      usuarios: [
        { id: ANA, nombre: "Ana", comision_pct: 3, rol: "cobrador", activo: true },
        { id: BETO, nombre: "Beto", comision_pct: 3, rol: "cobrador", activo: true },
      ],
    });
    const r = await getComisionesPeriodo(dbServer.cliente, "quincena", AHORA);
    expect(r.atribuidoPorRuta).toBe(true);
    const ana = r.filas.find((f) => f.cobradorId === ANA)!;
    const beto = r.filas.find((f) => f.cobradorId === BETO)!;
    expect(ana.recaudado).toBe(400000);
    expect(ana.comision).toBe(12000);
    expect(beto.recaudado).toBe(0); // registró la plata, pero no es su ruta
    expect(beto.comision).toBe(0);
  });

  it("sin la RPC de atribución por ruta cae a 'quien registró' y lo AVISA", async () => {
    montarComisiones({
      porRuta: null, // 0069 sin correr
      usuarios: [
        { id: ANA, nombre: "Ana", comision_pct: 3, rol: "cobrador", activo: true },
        { id: BETO, nombre: "Beto", comision_pct: 3, rol: "cobrador", activo: true },
      ],
    });
    const r = await getComisionesPeriodo(dbServer.cliente, "quincena", AHORA);
    expect(r.atribuidoPorRuta).toBe(false);
    expect(r.filas.find((f) => f.cobradorId === BETO)!.recaudado).toBe(500000);
  });

  it("una quincena ya liquidada queda marcada (candado anti doble-pago)", async () => {
    montarComisiones({
      porRuta: [{ cobrador_id: ANA, recaudado: 400000, cobros: 220 }],
      usuarios: [{ id: ANA, nombre: "Ana", comision_pct: 3, rol: "cobrador", activo: true }],
      liquidadas: [
        {
          cobrador_id: ANA,
          periodo_key: "quincena:2026-08-01",
          monto: 12000,
          liquidado_en: "2026-08-16T14:00:00Z",
        },
      ],
    });
    const r = await getComisionesPeriodo(dbServer.cliente, "quincena", AHORA);
    expect(r.filas[0].liquidado).toEqual({ monto: 12000, fecha: "2026-08-16T14:00:00Z" });
    expect(r.totalLiquidado).toBe(12000);
  });

  it("una liquidación de OTRA quincena no marca la de esta (claves distintas)", async () => {
    montarComisiones({
      porRuta: [{ cobrador_id: ANA, recaudado: 400000, cobros: 220 }],
      usuarios: [{ id: ANA, nombre: "Ana", comision_pct: 3, rol: "cobrador", activo: true }],
      liquidadas: [
        {
          cobrador_id: ANA,
          periodo_key: "quincena:2026-07-16",
          monto: 9000,
          liquidado_en: "2026-08-01T14:00:00Z",
        },
      ],
    });
    const r = await getComisionesPeriodo(dbServer.cliente, "quincena", AHORA);
    expect(r.filas[0].liquidado).toBeNull();
    expect(r.totalLiquidado).toBe(0);
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo 2, severidad alta).
  // Ana trabajó la 1ª quincena y la dieron de baja el día 12. El 16, día de pago,
  // el filtro `.eq('activo', true)` la saca de la tabla: sus $12.000 devengados
  // desaparecen de todas las pantallas y `liquidarComision` responde "es cero".
  it("⚠️ FALLA: un cobrador dado de baja con recaudo de la quincena tiene que poder cobrarla", async () => {
    montarComisiones({
      porRuta: [{ cobrador_id: ANA, recaudado: 400000, cobros: 220 }],
      usuarios: [
        { id: ANA, nombre: "Ana", comision_pct: 3, rol: "cobrador", activo: false }, // baja el 12
        { id: BETO, nombre: "Beto", comision_pct: 3, rol: "cobrador", activo: true },
      ],
    });
    const r = await getComisionesPeriodo(dbServer.cliente, "quincena", AHORA);
    const ana = r.filas.find((f) => f.cobradorId === ANA);
    expect(ana?.comision).toBe(12000); // hoy: `ana` es undefined
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  7 · LIQUIDACIÓN DIARIA DEL PANEL (la foto del día por cobrador)
// ═════════════════════════════════════════════════════════════════════════
describe("Liquidación diaria — base + recaudo − retiros", () => {
  const AHORA = new Date("2026-08-06T15:00:00Z");
  const HOY_UY = "2026-08-06";

  function mundo(extra: Partial<Tablas> = {}) {
    montar({
      usuarios: [
        { id: "c1", nombre: "Ana", rol: "cobrador", activo: true },
        { id: "c2", nombre: "Beto", rol: "cobrador", activo: true },
      ],
      pagos: [
        { id: 1, monto: 2000, registrado_por: "c1", anulado: false, origen: null, registrado_en: "2026-08-06T12:00:00Z" },
        { id: 2, monto: 1000, registrado_por: "c1", anulado: false, origen: null, registrado_en: "2026-08-06T13:00:00Z" },
        { id: 3, monto: 1000, registrado_por: "c2", anulado: false, origen: null, registrado_en: "2026-08-06T13:00:00Z" },
        // Ruido que NO es caja de hoy.
        { id: 4, monto: 7000, registrado_por: "c1", anulado: false, origen: null, registrado_en: "2026-08-05T20:00:00Z" },
        { id: 5, monto: 9000, registrado_por: "c1", anulado: true, origen: null, registrado_en: "2026-08-06T12:00:00Z" },
        { id: 6, monto: 500000, registrado_por: "c1", anulado: false, origen: "disapp_import", registrado_en: "2026-08-06T09:00:00Z" },
      ],
      visitas: [
        { id: 1, cobrador_id: "c1", registrado_en: "2026-08-06T12:00:00Z" },
        { id: 2, cobrador_id: "c1", registrado_en: "2026-08-06T12:30:00Z" },
        { id: 3, cobrador_id: "c2", registrado_en: "2026-08-06T12:30:00Z" },
      ],
      movimientos_caja: [
        { id: 1, tipo: "egreso", categoria: "Nafta", monto: 800, cobrador_id: "c1", registrado_en: "2026-08-06T12:00:00Z" },
        { id: 2, tipo: "desembolso", categoria: null, monto: 9000, cobrador_id: "c2", registrado_en: "2026-08-06T12:00:00Z" },
      ],
      prestamos: [{ id: 1, cobrador_id: "c1", creado_en: "2026-08-06T11:00:00Z" }],
      rendiciones: [{ cobrador_id: "c1", fecha: HOY_UY }],
      aperturas_caja: [],
      ...extra,
    });
  }

  it("cada cobrador, su día: recaudo de HOY, visitas, ventas y quién ya cerró", async () => {
    mundo();
    const liq = await getLiquidacionDiaria(dbServer.cliente, AHORA, { global: true });
    expect(liq.fecha).toBe(HOY_UY);
    expect(liq.totalCobradores).toBe(2);
    expect(liq.cajasCerradas).toBe(1);

    const ana = liq.filas.find((f) => f.nombre === "Ana")!;
    // Ni el pago de ayer, ni el anulado, ni el importado del empalme.
    expect(ana.recaudo).toBe(3000);
    expect(ana.visitas).toBe(2);
    expect(ana.ventas).toBe(1);
    expect(ana.retiros).toBe(800);
    expect(ana.cajaFinal).toBe(2200);
    expect(ana.estado).toBe("cerrada");

    const beto = liq.filas.find((f) => f.nombre === "Beto")!;
    expect(beto.recaudo).toBe(1000);
    expect(beto.retiros).toBe(0); // un desembolso de crédito no es retiro de su caja
    expect(beto.estado).toBe("abierta");

    expect(liq.recaudoTotal).toBe(4000);
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo 4, severidad alta).
  // La comisión liquidada sale de la CAJA CENTRAL, no del bolsillo del cobrador:
  // contarla como retiro le baja la caja del día y le inventa un hueco al
  // supervisor que cruza esta pantalla con la rendición (vigilancia.ts ya la excluye).
  it("⚠️ FALLA: la comisión pagada desde caja central no debería bajar la caja del cobrador", async () => {
    mundo({
      movimientos_caja: [
        { id: 1, tipo: "egreso", categoria: "Nafta", monto: 800, cobrador_id: "c1", registrado_en: "2026-08-06T12:00:00Z" },
        { id: 2, tipo: "egreso", categoria: "Comisión", monto: 18000, cobrador_id: "c1", registrado_en: "2026-08-06T18:00:00Z" },
      ],
    });
    const liq = await getLiquidacionDiaria(dbServer.cliente, AHORA, { global: true });
    const ana = liq.filas.find((f) => f.nombre === "Ana")!;
    expect(ana.retiros).toBe(800); // hoy: 18.800
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo 5, severidad media).
  // La base del día vive en `aperturas_caja` (0105) desde que existe /admin/jornada;
  // esta pantalla la busca en `movimientos_caja` tipo 'ingreso', que nadie escribe.
  it("⚠️ FALLA: la base del día tiene que salir de aperturas_caja, como en el cierre", async () => {
    mundo({ aperturas_caja: [{ cobrador_id: "c1", fecha: HOY_UY, base: 5000 }] });
    const liq = await getLiquidacionDiaria(dbServer.cliente, AHORA, { global: true });
    const ana = liq.filas.find((f) => f.nombre === "Ana")!;
    expect(ana.base).toBe(5000); // hoy: null → la columna muestra "—"
    expect(ana.cajaFinal).toBe(5000 + 3000 - 800);
  });
});

// ═════════════════════════════════════════════════════════════════════════
//  8 · "MIS NÚMEROS" DEL COBRADOR (lo que la app le PROMETE)
// ═════════════════════════════════════════════════════════════════════════
describe("Mis números — la promesa tiene que ser lo que la oficina liquida", () => {
  const COB_B = "cob-b";
  const COB_A = "cob-a";

  it("la comisión de la quincena en curso solo cuenta del 16 en adelante", async () => {
    montar({
      // La comisión se calcula sobre créditos de SU ruta → hace falta el crédito.
      prestamos: [{ id: "pr-b", cobrador_id: COB_B }],
      pagos: [
        { id: 1, prestamo_id: "pr-b", monto: 10000, registrado_por: COB_B, anulado: false, origen: null, registrado_en: "2026-08-10T14:00:00Z" },
        { id: 2, prestamo_id: "pr-b", monto: 20000, registrado_por: COB_B, anulado: false, origen: null, registrado_en: "2026-08-18T14:00:00Z" },
      ],
      usuarios: [{ id: COB_B, comision_pct: 3 }],
      rendiciones: [],
      comisiones_liquidadas: [],
    });
    const r = await getMisNumeros(COB_B, new Date("2026-08-20T15:00:00Z"));
    expect(r.quincenaDesde).toBe("2026-08-16");
    expect(r.quincenaRecaudado).toBe(20000);
    expect(r.comisionQuincena).toBe(600);
    expect(r.mesRecaudado).toBe(30000);
    expect(r.comisionMes).toBe(900);
  });

  it("el BORDE de la quincena es el corte UY (03:00Z): el 15 a las 23:59 UY es de la 1ª, el 16 a las 00:00 UY de la 2ª", async () => {
    // Sesión de caos 15-08: las primitivas de fecha estaban selladas en 5 TZs,
    // pero ninguna COMPOSICIÓN metía un pago pegado al corte. Un pago del 16 a
    // las 02:59Z sigue siendo 15-ago 23:59 en Uruguay → 1ª quincena.
    montar({
      prestamos: [{ id: "pr-b", cobrador_id: COB_B }],
      pagos: [
        { id: 1, prestamo_id: "pr-b", monto: 10000, registrado_por: COB_B, anulado: false, origen: null, registrado_en: "2026-08-16T02:59:00Z" },
        { id: 2, prestamo_id: "pr-b", monto: 20000, registrado_por: COB_B, anulado: false, origen: null, registrado_en: "2026-08-16T03:00:00Z" },
      ],
      usuarios: [{ id: COB_B, comision_pct: 3 }],
      rendiciones: [],
      comisiones_liquidadas: [],
    });
    const r = await getMisNumeros(COB_B, new Date("2026-08-20T15:00:00Z"));
    expect(r.quincenaDesde).toBe("2026-08-16");
    expect(r.quincenaRecaudado).toBe(20000); // SOLO el de las 03:00Z (16-ago UY)
    expect(r.comisionQuincena).toBe(600);
    expect(r.mesRecaudado).toBe(30000); // el mes los abraza a los dos
  });

  it("los pagos importados del empalme no entran en la comisión que se le promete", async () => {
    montar({
      prestamos: [{ id: "pr-b", cobrador_id: COB_B }],
      pagos: [
        { id: 1, prestamo_id: "pr-b", monto: 20000, registrado_por: COB_B, anulado: false, origen: null, registrado_en: "2026-08-18T14:00:00Z" },
        { id: 2, prestamo_id: "pr-b", monto: 644806, registrado_por: COB_B, anulado: false, origen: "disapp_import", registrado_en: "2026-08-18T09:00:00Z" },
        { id: 3, prestamo_id: "pr-b", monto: 5000, registrado_por: COB_B, anulado: true, origen: null, registrado_en: "2026-08-18T10:00:00Z" },
      ],
      usuarios: [{ id: COB_B, comision_pct: 3 }],
      rendiciones: [],
      comisiones_liquidadas: [],
    });
    const r = await getMisNumeros(COB_B, new Date("2026-08-20T15:00:00Z"));
    expect(r.quincenaRecaudado).toBe(20000);
    expect(r.comisionQuincena).toBe(600);
  });

  it("cuenta sus jornadas del mes y cuántas le cuadraron", async () => {
    montar({
      pagos: [],
      usuarios: [{ id: COB_B, comision_pct: 3 }],
      rendiciones: [
        { cobrador_id: COB_B, fecha: "2026-08-03", diferencia: 0 },
        { cobrador_id: COB_B, fecha: "2026-08-04", diferencia: -500 },
        { cobrador_id: COB_B, fecha: "2026-07-31", diferencia: 0 }, // mes anterior
      ],
      comisiones_liquidadas: [],
    });
    const r = await getMisNumeros(COB_B, new Date("2026-08-05T15:00:00Z"));
    expect(r.rendiciones).toBe(2);
    expect(r.cuadradas).toBe(1);
  });

  // ✅ ARREGLADO (06-08). Caso Sonia Telis (día 1): B le registró $6.550 en un
  // crédito de la ruta de A. La oficina liquida por `prestamos.cobrador_id` (RPC
  // 0069) → esa plata es de A; "Mis números" sumaba por `registrado_por` y se la
  // prometía a B. Le prometía una comisión que el día de pago no iba a llegar.
  it("cobrar en la ruta de un compañero NO es comisión propia (pero sí es custodia)", async () => {
    montar({
      prestamos: [{ id: "pr-a", cobrador_id: COB_A }],
      pagos: [
        {
          id: 1,
          prestamo_id: "pr-a",
          monto: 6550,
          registrado_por: COB_B, // custodia: la plata la tuvo B
          anulado: false,
          origen: null,
          registrado_en: "2026-08-05T14:00:00Z",
        },
      ],
      usuarios: [{ id: COB_B, comision_pct: 3 }],
      rendiciones: [],
      comisiones_liquidadas: [],
    });
    const r = await getMisNumeros(COB_B, new Date("2026-08-05T15:00:00Z"));
    // La comisión es de A: a B no se le promete nada por esa plata.
    expect(r.quincenaRecaudado).toBe(0);
    expect(r.comisionQuincena).toBe(0);
    // Pero la plata SÍ pasó por sus manos y la tiene que rendir: eso no se borra.
    expect(r.mesRecaudado).toBe(6550);
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo 6, severidad baja).
  // El dataset se trae con `.gte(inicio del MES)`, así que la ventana de 7 días
  // queda recortada del 1 al 6 de cada mes (el día 1 muestra solo lo de hoy).
  it("⚠️ FALLA: 'esta semana' son los últimos 7 días, aunque crucen el cambio de mes", async () => {
    montar({
      pagos: [
        { id: 1, monto: 40000, registrado_por: COB_B, anulado: false, origen: null, registrado_en: "2026-07-30T14:00:00Z" },
        { id: 2, monto: 15000, registrado_por: COB_B, anulado: false, origen: null, registrado_en: "2026-08-02T14:00:00Z" },
      ],
      usuarios: [{ id: COB_B, comision_pct: 3 }],
      rendiciones: [],
      comisiones_liquidadas: [],
    });
    const r = await getMisNumeros(COB_B, new Date("2026-08-03T15:00:00Z"));
    expect(r.semanaRecaudado).toBe(55000); // hoy: 15000
  });
});
