// ─────────────────────────────────────────────────────────────────────────
//  LAS DOS PUERTAS PARA COLOCAR CAPITAL — qué aparece en cada lista y por qué.
//
//  Este módulo decide, para cada cliente de la ruta, si el cobrador puede
//  colocarle plata HOY y hasta cuánto. Es la pantalla más cara de equivocar del
//  piloto: lo que dibuja acá es lo que el cobrador le dice al cliente en voz alta
//  con el efectivo en la mano. La regla que atraviesa todo el archivo:
//  **la lista nunca puede ofrecer algo que el servidor va a rechazar**, ni
//  esconder a alguien sin decir por qué.
//
//  Estaba sin tests. Los casos de acá son los que se rompieron de verdad en la
//  calle entre el 05 y el 09 de agosto.
//
//  ⚠️ DINERO REAL: toda cifra esperada es entera.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCandidatosRenovar, getCandidatosVenta, getNoElegibles } from "./colocar";
import {
  montoRenovacionAutoAprobable,
  techoRenovacion,
  techoVentaNueva,
  techoVentaGestor,
  RENOVACION_CAP_TOTAL,
} from "@/lib/renovacion";

const YULI = "u-yuli";
const EDWARD = "u-edward";

// ═══════════════════════════════════════════════════════════════════════════
//  DOBLE DE SUPABASE — encadenable, con los filtros de verdad y un CONTADOR de
//  consultas por tabla: el N+1 de pagos es uno de los hallazgos que se prueban.
//  Modela también el corte silencioso de PostgREST a 1000 filas, que es lo que
//  vuelve obligatorio el paginado.
// ═══════════════════════════════════════════════════════════════════════════
type Fila = Record<string, unknown>;
type Filtro = { col: string; tipo: "eq" | "neq" | "in"; val: unknown };

const comparar = (a: unknown, b: unknown): number =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").localeCompare(String(b ?? ""));

function crearDb(tablas: Record<string, Fila[]>, maxFilas = 1000) {
  const consultas: Record<string, number> = {};
  const db = {
    from(tabla: string) {
      consultas[tabla] = (consultas[tabla] ?? 0) + 1;
      const filas = tablas[tabla] ?? [];
      const filtros: Filtro[] = [];
      let orden: { col: string; asc: boolean } | null = null;
      let rango: { d: number; h: number } | null = null;

      const coincide = (f: Fila) =>
        filtros.every((x) =>
          x.tipo === "eq"
            ? f[x.col] === x.val
            : x.tipo === "neq"
              ? f[x.col] !== x.val
              : (x.val as unknown[]).includes(f[x.col]),
        );

      const ejecutar = () => {
        const todas = filas.filter(coincide);
        let out = orden
          ? [...todas].sort((a, b) => comparar(a[orden!.col], b[orden!.col]) * (orden!.asc ? 1 : -1))
          : todas;
        if (rango) out = out.slice(rango.d, rango.h + 1);
        if (out.length > maxFilas) out = out.slice(0, maxFilas); // corte SILENCIOSO
        return { data: out, error: null };
      };

      const b = {
        select: () => b,
        eq: (col: string, val: unknown) => (filtros.push({ col, tipo: "eq", val }), b),
        neq: (col: string, val: unknown) => (filtros.push({ col, tipo: "neq", val }), b),
        in: (col: string, val: unknown[]) => (filtros.push({ col, tipo: "in", val }), b),
        order: (col: string, o?: { ascending?: boolean }) => ((orden = { col, asc: o?.ascending !== false }), b),
        range: (d: number, h: number) => ((rango = { d, h }), b),
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve(ejecutar()).then(ok, fail),
      };
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, consultas };
}

// ── Fábricas ───────────────────────────────────────────────────────────────
const cliente = (id: string, nombre: string) => ({ id, nombre, documento: "1234567", activo: true });
const asignado = (clienteId: string) => ({ cliente_id: clienteId, activo: true });

/** Un crédito. `fecha_inicio` fija: `falta` no depende de hoy (total − pagado). */
function credito(o: {
  id: string;
  cliente: string;
  cobrador?: string | null;
  monto: number;
  cuota: number;
  dias: number;
  estado?: string;
  inicio?: string;
  creado?: string;
}) {
  return {
    id: o.id,
    cliente_id: o.cliente,
    cobrador_id: o.cobrador ?? YULI,
    monto_prestado: o.monto,
    cuota_diaria: o.cuota,
    total_dias: o.dias,
    frecuencia: "diario",
    estado: o.estado ?? "activo",
    fecha_inicio: o.inicio ?? "2026-01-05",
    creado_en: o.creado ?? "2026-01-05T12:00:00Z",
  };
}

const pago = (id: string, prestamo: string, monto: number, dia = 1) => ({
  id,
  prestamo_id: prestamo,
  dia_credito: dia,
  monto,
  anulado: false,
  registrado_en: "2026-02-01T12:00:00Z",
  registrado_por: YULI,
  origen: null,
});

/** Los N pagos que SALDAN un crédito de `cuota × dias`. */
const saldar = (prestamo: string, cuota: number, dias: number) =>
  Array.from({ length: dias }, (_, i) => pago(`pg-${prestamo}-${i}`, prestamo, cuota, i + 1));

// ═══════════════════════════════════════════════════════════════════════════
describe("RENOVAR: solo el que terminó de pagar, y solo si el crédito es SUYO", () => {
  it("ofrece el crédito saldado y deja fuera al que todavía debe", async () => {
    const { db } = crearDb({
      asignaciones: [asignado("c-ana"), asignado("c-beto")],
      clientes: [cliente("c-ana", "ANA"), cliente("c-beto", "BETO")],
      prestamos: [
        credito({ id: "p-ana", cliente: "c-ana", monto: 10_000, cuota: 500, dias: 24 }),
        credito({ id: "p-beto", cliente: "c-beto", monto: 10_000, cuota: 500, dias: 24 }),
      ],
      pagos: [...saldar("p-ana", 500, 24), pago("x1", "p-beto", 500)],
    });

    const out = await getCandidatosRenovar(db, YULI);
    expect(out.map((c) => c.nombre)).toEqual(["ANA"]);
    expect(out[0].prestamoId).toBe("p-ana");
    expect(out[0].falta).toBe(0);
  });

  it("NO ofrece el crédito saldado del COMPAÑERO (la comisión sería suya)", async () => {
    // 54 clientes reales están hoy en dos rutas. Ofrecerlo terminaba en el rojo
    // del servidor —"Ese crédito es de otro cobrador"— delante del cliente.
    const { db } = crearDb({
      asignaciones: [asignado("c-sonia")],
      clientes: [cliente("c-sonia", "SONIA")],
      prestamos: [credito({ id: "p-aj", cliente: "c-sonia", cobrador: EDWARD, monto: 8_000, cuota: 500, dias: 20 })],
      pagos: saldar("p-aj", 500, 20),
    });
    expect(await getCandidatosRenovar(db, YULI)).toEqual([]);
  });

  it("el que terminó UNO y sigue pagando OTRO puede renovar, con la deuda a la vista", async () => {
    // El gate del 08-04 exigía TODOS los créditos en cero y lo hacía desaparecer
    // mudo de la lista (reporte de campo 08-05, caso 8).
    const { db } = crearDb({
      asignaciones: [asignado("c-sonia")],
      clientes: [cliente("c-sonia", "SONIA")],
      prestamos: [
        credito({ id: "p-listo", cliente: "c-sonia", monto: 15_000, cuota: 600, dias: 30 }),
        credito({ id: "p-vivo", cliente: "c-sonia", monto: 30_000, cuota: 1_200, dias: 30 }),
      ],
      pagos: [...saldar("p-listo", 600, 30), pago("y1", "p-vivo", 1_200)],
    });

    const out = await getCandidatosRenovar(db, YULI);
    expect(out).toHaveLength(1);
    expect(out[0].prestamoId).toBe("p-listo");
    // 36.000 del crédito vivo − 1.200 pagados.
    expect(out[0].deudaHermano).toBe(34_800);
  });
});

describe("RENOVAR: los topes que dibuja la tarjeta son los que aplica el servidor", () => {
  it("propone repetir el mismo monto y da el techo del +20%", async () => {
    const { db } = crearDb({
      asignaciones: [asignado("c-ana")],
      clientes: [cliente("c-ana", "ANA")],
      prestamos: [credito({ id: "p1", cliente: "c-ana", monto: 20_000, cuota: 800, dias: 30 })],
      pagos: saldar("p1", 800, 30),
    });

    const [c] = await getCandidatosRenovar(db, YULI);
    expect(c.montoNuevo).toBe(20_000); // se repite TAL CUAL
    expect(c.cuotaNueva).toBe(800); // misma tasa, misma cuota
    expect(c.techo).toBe(24_000); // +20% sin pedir permiso
    expect(c.maximo).toBe(100_000); // el máximo del gestor: piso en el CAP (+20% de 20k queda debajo)
    expect(c.requiereAprobacion).toBe(false); // repetir NUNCA pide permiso
  });

  it("un HEREDADO por encima del tope se repite solo, y su máximo es +20% (regla 16-08: los heredados también suben)", async () => {
    // GERARDO VARELA, $120.000. Recortarlo al CAP sería rebajarle el capital.
    const { db } = crearDb({
      asignaciones: [asignado("c-ger")],
      clientes: [cliente("c-ger", "GERARDO")],
      prestamos: [credito({ id: "p1", cliente: "c-ger", monto: 120_000, cuota: 4_800, dias: 30 })],
      pagos: saldar("p1", 4_800, 30),
    });

    const [c] = await getCandidatosRenovar(db, YULI);
    expect(c.montoNuevo).toBe(120_000);
    expect(c.techo).toBe(montoRenovacionAutoAprobable(120_000)); // = 120.000
    expect(c.maximo).toBe(techoRenovacion(120_000)); // = 144.000: +20% con aprobación
    expect(c.requiereAprobacion).toBe(false);
  });
});

describe("NUEVA VENTA: la lista del operador que 'no encontraba a nadie'", () => {
  it("incluye al que TODAVÍA está pagando (varios créditos a la vez son legítimos)", async () => {
    const { db } = crearDb({
      asignaciones: [asignado("c-ana")],
      clientes: [cliente("c-ana", "ANA")],
      prestamos: [credito({ id: "p1", cliente: "c-ana", monto: 10_000, cuota: 500, dias: 24 })],
      pagos: [pago("x1", "p1", 500)],
    });

    const out = await getCandidatosVenta(db);
    expect(out.map((c) => c.nombre)).toEqual(["ANA"]);
    expect(out[0].deudaHermano).toBe(11_500); // se AVISA, no se bloquea
    expect(out[0].prestamoId).toBeUndefined(); // no hay nada que cerrar
  });

  it("el techo sale de la MISMA función que usa el servidor para aceptarlo", async () => {
    const { db } = crearDb({
      asignaciones: [asignado("c-ana")],
      clientes: [cliente("c-ana", "ANA")],
      prestamos: [credito({ id: "p1", cliente: "c-ana", monto: 7_000, cuota: 350, dias: 24 })],
      pagos: [],
    });
    const [c] = await getCandidatosVenta(db);
    expect(c.techo).toBe(techoVentaNueva(7_000)); // 8.400
    // Y el MÁXIMO también: lo que la lista dice "hasta acá lo aprueba la oficina"
    // es exactamente lo que nuevaVentaDesdeCalle/aprobarSolicitud aceptan (auditoría
    // 16-08: en PROD quedó el CAP a secas y la calle ofrecía de menos).
    expect(c.maximo).toBe(techoVentaGestor(7_000)); // 100.000 (piso CAP)
  });

  it("venta: para un anterior de $90.000 la lista promete el máximo del gestor ($108.000), no el CAP", async () => {
    const { db } = crearDb({
      asignaciones: [asignado("c-big")],
      clientes: [cliente("c-big", "BIG")],
      prestamos: [credito({ id: "p1", cliente: "c-big", monto: 90_000, cuota: 4_500, dias: 24 })],
      pagos: [],
    });
    const [c] = await getCandidatosVenta(db);
    expect(c.techo).toBe(techoVentaNueva(90_000)); // 100.000 (el cobrador solo)
    expect(c.maximo).toBe(108_000); // techoVentaGestor: la oficina hasta acá
  });

  it("con dos créditos de la MISMA fecha, el 'último' es el creado más tarde", async () => {
    // El empalme cargó lotes enteros con la misma `fecha_inicio`. El servidor
    // desempata por `creado_en`; si acá se desempataba distinto, la pantalla
    // ofrecía un techo calculado sobre un crédito y el servidor validaba con otro.
    const { db } = crearDb({
      asignaciones: [asignado("c-ana")],
      clientes: [cliente("c-ana", "ANA")],
      prestamos: [
        credito({ id: "p-viejo", cliente: "c-ana", monto: 5_000, cuota: 250, dias: 24, estado: "finalizado", inicio: "2026-03-01", creado: "2026-03-01T09:00:00Z" }),
        credito({ id: "p-nuevo", cliente: "c-ana", monto: 20_000, cuota: 1_000, dias: 24, estado: "finalizado", inicio: "2026-03-01", creado: "2026-03-01T18:00:00Z" }),
      ],
      pagos: [],
    });
    const [c] = await getCandidatosVenta(db);
    expect(c.monto).toBe(20_000);
    expect(c.techo).toBe(techoVentaNueva(20_000)); // 24.000, no 6.000
  });

  it("el RECIÉN CENSADO aparece como PRIMER crédito, con el CAP de techo", async () => {
    // Regla de Carlos (08-13): "los créditos de censar cliente nuevo" ya no piden
    // autorización — el primer crédito lo coloca el cobrador directo, al 20% del
    // negocio. Antes este cliente no aparecía en NINGUNA lista y todo censo
    // terminaba en un pedido a la oficina esperando días.
    const { db } = crearDb({
      asignaciones: [asignado("c-nuevo")],
      clientes: [cliente("c-nuevo", "RECIÉN CENSADO")],
      prestamos: [],
      pagos: [],
    });
    const out = await getCandidatosVenta(db);
    expect(out).toHaveLength(1);
    expect(out[0].primerCredito).toBe(true);
    expect(out[0].techo).toBe(RENOVACION_CAP_TOTAL); // el único tope es el CAP
    expect(out[0].monto).toBe(0); // no hay último crédito del que partir
    expect(out[0].prestamoId).toBeUndefined(); // no hay nada que cerrar
  });

  it("historial con términos ROTOS del import = mismas reglas que un primer crédito", async () => {
    // Tiene filas en `prestamos` pero con cuota 0: no hay tasa que arrastrar ni
    // techo que medir. Es EXACTAMENTE lo que decide el servidor (`conHistorial`
    // da false → 20% del negocio, tope CAP) — la lista no puede decidir distinto.
    const { db } = crearDb({
      asignaciones: [asignado("c-roto")],
      clientes: [cliente("c-roto", "IMPORT ROTO")],
      prestamos: [credito({ id: "p1", cliente: "c-roto", monto: 10_000, cuota: 0, dias: 24, estado: "finalizado" })],
      pagos: [],
    });
    const out = await getCandidatosVenta(db);
    expect(out).toHaveLength(1);
    expect(out[0].primerCredito).toBe(true);
    expect(out[0].techo).toBe(RENOVACION_CAP_TOTAL);
  });
});

describe("El duplicado de 'Nueva venta': el saldado sale en las DOS listas", () => {
  it("el mismo cliente aparece en renovar Y en venta — por eso la página deduplica", async () => {
    // 142 clientes reales hoy. Sin deduplicar, el cobrador ve el mismo nombre dos
    // veces: una tarjeta que CIERRA el crédito terminado (renovación) y otra que
    // lo deja abierto para siempre (alta). Gana la primera.
    const tablas = {
      asignaciones: [asignado("c-ana")],
      clientes: [cliente("c-ana", "ANA")],
      prestamos: [credito({ id: "p1", cliente: "c-ana", monto: 10_000, cuota: 500, dias: 24 })],
      pagos: saldar("p1", 500, 24),
    };
    const saldados = await getCandidatosRenovar(crearDb(tablas).db, YULI);
    const libres = await getCandidatosVenta(crearDb(tablas).db);

    expect(saldados).toHaveLength(1);
    expect(libres).toHaveLength(1); // ← el duplicado
    expect(saldados[0].clienteId).toBe(libres[0].clienteId);

    // La regla de la página: gana el que trae `prestamoId` (cierra el anterior).
    const conSaldado = new Set(saldados.map((c) => c.clienteId));
    const final = [...saldados, ...libres.filter((c) => !conSaldado.has(c.clienteId))];
    expect(final).toHaveLength(1);
    expect(final[0].prestamoId).toBe("p1");
  });
});

describe("NO ELEGIBLES: nunca se esconde a nadie sin decir por qué", () => {
  it("al que está pagando se le dice cuánto le falta y que puede llevarse otro", async () => {
    const { db } = crearDb({
      asignaciones: [asignado("c-beto")],
      clientes: [cliente("c-beto", "BETO")],
      prestamos: [credito({ id: "p1", cliente: "c-beto", monto: 10_000, cuota: 500, dias: 24 })],
      pagos: [pago("x1", "p1", 500)],
    });
    const [n] = await getNoElegibles(db, YULI, "renovar");
    expect(n.motivo).toContain("11.500");
    expect(n.queHacer).toContain("NUEVA VENTA");
  });

  it("si el crédito es del compañero, se dice eso y no 'le falta pagar'", async () => {
    const { db } = crearDb({
      asignaciones: [asignado("c-sonia")],
      clientes: [cliente("c-sonia", "SONIA")],
      prestamos: [credito({ id: "p1", cliente: "c-sonia", cobrador: EDWARD, monto: 10_000, cuota: 500, dias: 24 })],
      pagos: [pago("x1", "p1", 500)],
    });
    const [n] = await getNoElegibles(db, YULI, "renovar");
    expect(n.motivo).toBe("Su crédito es de otro cobrador.");
    expect(n.queHacer).toContain("supervisor");
  });

  it("en NUEVA VENTA no hay bloqueados: cualquiera con historial puede", async () => {
    const { db } = crearDb({
      asignaciones: [asignado("c-beto")],
      clientes: [cliente("c-beto", "BETO")],
      prestamos: [credito({ id: "p1", cliente: "c-beto", monto: 10_000, cuota: 500, dias: 24 })],
      pagos: [],
    });
    expect(await getNoElegibles(db, YULI, "venta")).toEqual([]);
  });
});

describe("La pantalla tiene que ABRIR en la calle (no era un detalle de estilo)", () => {
  it("pide los pagos de TODA la ruta en una consulta, no una por crédito", async () => {
    // Era un N+1 en SERIE: 124 round-trips encadenados para Luz Ángela, ×2 pasadas
    // en "Nueva venta". Con señal pobre eso se acerca al tope de 22 s de la página
    // y el operador ve una pantalla en blanco.
    const creditos = Array.from({ length: 40 }, (_, i) =>
      credito({ id: `p${i}`, cliente: `c${i}`, monto: 10_000, cuota: 500, dias: 24 }),
    );
    const { db, consultas } = crearDb({
      asignaciones: creditos.map((p) => asignado(p.cliente_id)),
      clientes: creditos.map((p) => cliente(p.cliente_id, `CLIENTE ${p.cliente_id}`)),
      prestamos: creditos,
      pagos: creditos.flatMap((p) => saldar(p.id, 500, 24)),
    });

    await getCandidatosRenovar(db, YULI);
    // 1 página de pagos (960 filas < 1000) — antes eran 40.
    expect(consultas.pagos).toBe(1);
  });

  it("con más de 1000 pagos en la ruta NO se pierde ninguno (paginado)", async () => {
    // El corte de PostgREST viene con `error: null`: los créditos del final
    // aparecían SIN pagos, o sea el que ya terminó se veía debiendo todo y
    // desaparecía de "Renovar" — con el cliente enfrente diciendo que ya pagó.
    const creditos = Array.from({ length: 50 }, (_, i) =>
      credito({ id: `p${i}`, cliente: `c${i}`, monto: 10_000, cuota: 500, dias: 24 }),
    );
    const { db, consultas } = crearDb({
      asignaciones: creditos.map((p) => asignado(p.cliente_id)),
      clientes: creditos.map((p) => cliente(p.cliente_id, `CLIENTE ${p.cliente_id}`)),
      prestamos: creditos,
      pagos: creditos.flatMap((p) => saldar(p.id, 500, 24)), // 1.200 filas
    });

    const out = await getCandidatosRenovar(db, YULI);
    expect(out).toHaveLength(50); // los 50 terminaron: ninguno se pierde
    expect(consultas.pagos).toBe(2); // 1.200 filas = dos páginas
  });
});

describe("el techo mide contra el MAYOR crédito de su historia — 'actual o pasado' (regla de Carlos 19-08)", () => {
  it("bajó de $14.000 a $5.000: su techo sigue saliendo de los $14.000 (no pierde lo ganado)", async () => {
    const { db } = crearDb({
      asignaciones: [asignado("c-lu")],
      clientes: [cliente("c-lu", "LU")],
      prestamos: [
        credito({ id: "viejo", cliente: "c-lu", monto: 14_000, cuota: 700, dias: 24, estado: "finalizado", inicio: "2026-03-01" }),
        credito({ id: "chico", cliente: "c-lu", monto: 5_000, cuota: 250, dias: 24, estado: "finalizado", inicio: "2026-07-01" }),
      ],
      pagos: [],
    });
    const [c] = await getCandidatosVenta(db);
    // La TASA sale del último ($5.000), pero el TECHO del mayor ($14.000).
    expect(c.monto).toBe(5_000);
    expect(c.techo).toBe(techoVentaNueva(14_000)); // 16.800, no 6.000
    expect(c.maximo).toBe(techoVentaGestor(14_000)); // 100.000 (piso CAP)
  });

  it("una venta CANCELADA grande no infla el techo (nunca existió)", async () => {
    const { db } = crearDb({
      asignaciones: [asignado("c-jo")],
      clientes: [cliente("c-jo", "JO")],
      prestamos: [
        credito({ id: "dedazo", cliente: "c-jo", monto: 90_000, cuota: 4_500, dias: 24, estado: "cancelado", inicio: "2026-08-01" }),
        credito({ id: "real", cliente: "c-jo", monto: 5_000, cuota: 250, dias: 24, estado: "finalizado", inicio: "2026-07-01" }),
      ],
      pagos: [],
    });
    const [c] = await getCandidatosVenta(db);
    expect(c.techo).toBe(techoVentaNueva(5_000)); // 6.000
  });
});
