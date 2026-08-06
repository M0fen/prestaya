// ─────────────────────────────────────────────────────────────────────────
//  WORKFLOW de la RUTA del cobrador y el ARQUEO del día (auditoría 08-06).
//
//  Estos tests miran la ruta como la mira el cobrador parado en la vereda:
//  "¿a quién me falta?", "¿cuánto le pido?", "¿ya le cobré?" — y como la mira
//  el gestor a la noche: "¿cuánto esperaba, cuánto entró?".
//
//  Cubren los casos que ROMPIERON EN LA CALLE el día 1 (doble cobro por falta
//  de scope por cobrador_id, clientes que no aparecen, clasificación de estado)
//  y los que el auditor dejó marcados como bugs VIVOS. Los que hoy fallan van
//  con `it.fails` + el comentario "⚠️ FALLA: bug real": documentan la conducta
//  CORRECTA sin pintar la suite de rojo, y el día que se arregle la fuente el
//  `it.fails` va a reventar, obligando a sacarle el `.fails`.
//
//  ⚠️ DINERO REAL: toda cifra esperada es entera (la única excepción es la
//  cuota FRACCIONARIA heredada de Disapp, donde el residuo sub-peso es el tema).
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clasificarClienteRuta, cuotaObjetivoHoy, estadoHoyDe, getRutaCobrador } from "./ruta";
import { calcularEstadosCarton, saldoCredito } from "@/lib/cartones";
import { parseFecha } from "@/lib/format";
import type { FrecuenciaPrestamo } from "@/types/db";

// ── Reloj FIJO (nada de new Date() sin argumentos) ──────────────────────────
/** Jueves 06-ago-2026, 12:00 en Uruguay (día hábil de cobro). */
const HOY = new Date("2026-08-06T15:00:00Z");
/** Domingo 09-ago-2026, 12:00 en Uruguay: NO es día de cobro. */
const DOMINGO = new Date("2026-08-09T15:00:00Z");
/** Un cobro sellado HOY (después del corte de las 03:00 UTC). */
const AHORA_ISO = "2026-08-06T13:00:00.000Z";
/** Un cobro de AYER: 05-ago 22:00 UY, ya del otro lado del corte del día UY. */
const AYER_ISO = "2026-08-06T01:00:00.000Z";
/** Lunes 03-ago: 24 cuotas diarias terminan el 29-ago → EN TÉRMINO. */
const INICIO_VIGENTE = "2026-08-03";
/** Lunes 04-may: 24 cuotas diarias terminaron el 30-may → PLAZO VENCIDO. */
const INICIO_VENCIDO = "2026-05-04";

// ── Doble de Supabase ───────────────────────────────────────────────────────
type Fila = Record<string, unknown>;

/**
 * Query-builder encadenable que SÍ aplica los filtros (a diferencia de otros
 * dobles del repo): sin eso no se puede probar lo único que evitó el doble
 * cobro del día 1 — el `.eq("cobrador_id", …)` sobre `prestamos`.
 * Soporta .select/.eq/.in/.gte/.order y resuelve al await (thenable).
 */
function fakeDb(tablas: Record<string, Fila[]>): SupabaseClient {
  return {
    from(tabla: string) {
      const rows = tablas[tabla] ?? [];
      const filtros: ((r: Fila) => boolean)[] = [];
      let ordenar: { col: string; asc: boolean } | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filtros.push((r) => r[col] === val);
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          filtros.push((r) => vals.includes(r[col]));
          return builder;
        },
        gte: (col: string, val: unknown) => {
          filtros.push((r) => Date.parse(String(r[col])) >= Date.parse(String(val)));
          return builder;
        },
        order: (col: string, o?: { ascending?: boolean }) => {
          ordenar = { col, asc: o?.ascending !== false };
          return builder;
        },
        then: (onF: (v: { data: Fila[]; error: null }) => unknown) => {
          let out = rows.filter((r) => filtros.every((f) => f(r)));
          const ord = ordenar as { col: string; asc: boolean } | null;
          if (ord) {
            out = [...out].sort(
              (a, b) => String(a[ord.col]).localeCompare(String(b[ord.col])) * (ord.asc ? 1 : -1),
            );
          }
          return onF({ data: out, error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const cliente = (id: string, nombre: string): Fila => ({
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
  acceso_entregado_en: null,
  acceso_entregado_por: null,
  acceso_visto_en: null,
  creado_en: "2026-01-01T00:00:00.000Z",
  actualizado_en: "2026-01-01T00:00:00.000Z",
});

const asignacion = (cliente_id: string, orden: number | null = null): Fila => ({
  cliente_id,
  orden,
  activo: true,
});

const prestamo = (o: {
  id: string;
  cliente: string;
  cuota: number;
  dias?: number;
  inicio?: string;
  frecuencia?: FrecuenciaPrestamo;
  acum?: number;
  cobrador?: string;
}): Fila => ({
  id: o.id,
  cliente_id: o.cliente,
  cuota_diaria: o.cuota,
  total_dias: o.dias ?? 24,
  fecha_inicio: o.inicio ?? INICIO_VIGENTE,
  frecuencia: o.frecuencia ?? "diario",
  pagado_acum: o.acum ?? 0,
  estado: "activo",
  cobrador_id: o.cobrador ?? "cob-A",
});

const pago = (prestamo_id: string, monto: number, registrado_en = AHORA_ISO): Fila => ({
  prestamo_id,
  monto,
  anulado: false,
  registrado_en,
});

const visita = (prestamo_id: string, resultado: string): Fila => ({
  prestamo_id,
  resultado,
  registrado_en: AHORA_ISO,
});

// ═══════════════════════════════════════════════════════════════════════════
//  1. EL DOBLE COBRO DEL DÍA 1 — cada cobrador cobra SOLO lo suyo
// ═══════════════════════════════════════════════════════════════════════════
describe("ruta: un cliente compartido por dos cobradores (fallo #2 de campo)", () => {
  // SONIA TELIS: 6 créditos de Juan José ($5.350/día) + 2 de Alejandro ($1.200).
  // Sin el filtro por dueño los dos veían $6.550 y los dos salían a cobrarlo.
  const db = () =>
    fakeDb({
      asignaciones: [asignacion("cli-sonia")],
      clientes: [cliente("cli-sonia", "SONIA TELIS")],
      prestamos: [
        prestamo({ id: "p1", cliente: "cli-sonia", cuota: 1200, cobrador: "cob-juanjo" }),
        prestamo({ id: "p2", cliente: "cli-sonia", cuota: 1200, cobrador: "cob-juanjo" }),
        prestamo({ id: "p3", cliente: "cli-sonia", cuota: 550, cobrador: "cob-juanjo" }),
        prestamo({ id: "p4", cliente: "cli-sonia", cuota: 600, cobrador: "cob-juanjo" }),
        prestamo({ id: "p5", cliente: "cli-sonia", cuota: 1200, cobrador: "cob-juanjo" }),
        prestamo({ id: "p6", cliente: "cli-sonia", cuota: 600, cobrador: "cob-juanjo" }),
        prestamo({ id: "p7", cliente: "cli-sonia", cuota: 600, cobrador: "cob-ale" }),
        prestamo({ id: "p8", cliente: "cli-sonia", cuota: 600, cobrador: "cob-ale" }),
      ],
      pagos: [],
      visitas: [],
    });

  it("a cada cobrador la tarjeta le pide SOLO la cuota de sus propios créditos", async () => {
    const juanjo = await getRutaCobrador(db(), HOY, "cob-juanjo");
    const ale = await getRutaCobrador(db(), HOY, "cob-ale");
    expect(juanjo.items[0].cuota).toBe(5350);
    expect(ale.items[0].cuota).toBe(1200);
    // Ninguno de los dos puede ver NUNCA el total del cliente: eso era el doble cobro.
    expect(juanjo.items[0].cuota + ale.items[0].cuota).toBe(6550);
    expect(juanjo.items[0].cuota).not.toBe(6550);
    expect(ale.items[0].cuota).not.toBe(6550);
  });

  it("el esperado del día de cada uno es el de SU cartera, no el del cliente entero", async () => {
    const juanjo = await getRutaCobrador(db(), HOY, "cob-juanjo");
    const ale = await getRutaCobrador(db(), HOY, "cob-ale");
    expect(juanjo.arqueo.esperado).toBe(5350);
    expect(ale.arqueo.esperado).toBe(1200);
    // Los dos lo cuentan como UNA parada (es su cliente): el denominador no se rompe.
    expect(juanjo.arqueo.clientes).toBe(1);
    expect(ale.arqueo.clientes).toBe(1);
  });

  it("que el compañero ya haya cobrado NO deja mi parada en 'Cobrado'", async () => {
    const tablas = {
      asignaciones: [asignacion("cli-sonia")],
      clientes: [cliente("cli-sonia", "SONIA TELIS")],
      prestamos: [
        prestamo({ id: "p1", cliente: "cli-sonia", cuota: 5350, cobrador: "cob-juanjo" }),
        prestamo({ id: "p7", cliente: "cli-sonia", cuota: 1200, cobrador: "cob-ale" }),
      ],
      pagos: [pago("p1", 5350)], // cobró Juan José, no Alejandro
      visitas: [],
    };
    const ale = await getRutaCobrador(fakeDb(tablas), HOY, "cob-ale");
    expect(ale.items[0].estadoHoy).toBe("pendiente"); // le falta cobrar SUS $1.200
    expect(ale.arqueo.recaudado).toBe(0); // la plata del compañero no es su recaudo
    expect(ale.arqueo.recaudadoRuta).toBe(0);
    const juanjo = await getRutaCobrador(fakeDb(tablas), HOY, "cob-juanjo");
    expect(juanjo.items[0].estadoHoy).toBe("pagado");
    expect(juanjo.arqueo.recaudado).toBe(5350);
  });

  it("si el cliente SOLO tiene créditos del compañero, en mi ruta figura 'sin crédito' y no infla nada", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-sonia")],
        clientes: [cliente("cli-sonia", "SONIA TELIS")],
        prestamos: [prestamo({ id: "p7", cliente: "cli-sonia", cuota: 600, cobrador: "cob-juanjo" })],
        pagos: [],
        visitas: [],
      }),
      HOY,
      "cob-ale",
    );
    expect(ruta.items).toHaveLength(1); // sigue VISIBLE (no desaparece: fallo #3)
    expect(ruta.items[0].estadoHoy).toBe("sin_credito");
    expect(ruta.items[0].prestamoId).toBeNull();
    expect(ruta.arqueo.esperado).toBe(0);
    expect(ruta.arqueo.clientes).toBe(0); // no cuenta en "Cobrados N/M"
    expect(ruta.arqueo.pendientes).toBe(0);
  });

  it("sin cobradorId (llamador viejo) se conserva la conducta previa: suma TODO", async () => {
    // Documentado a propósito en la firma: el default no filtra. Si alguien
    // llama sin el id desde la app del cobrador, vuelve el doble cobro.
    const ruta = await getRutaCobrador(db(), HOY);
    expect(ruta.items[0].cuota).toBe(6550);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. MULTI-CRÉDITO DEL MISMO COBRADOR — el neteo entre créditos
// ═══════════════════════════════════════════════════════════════════════════
describe("ruta: dos créditos EN TÉRMINO del MISMO cobrador", () => {
  it("cobrar la cuota de los dos → 'Cobrado' y el esperado del cliente cumplido", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-silvina")],
        clientes: [cliente("cli-silvina", "SILVINA FAGIANI")],
        prestamos: [
          prestamo({ id: "pa", cliente: "cli-silvina", cuota: 3600 }),
          prestamo({ id: "pb", cliente: "cli-silvina", cuota: 2500 }),
        ],
        pagos: [pago("pa", 3600), pago("pb", 2500)],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.items[0].cuota).toBe(6100);
    expect(ruta.items[0].estadoHoy).toBe("pagado");
    expect(ruta.arqueo.esperado).toBe(6100);
    expect(ruta.arqueo.recaudadoRuta).toBe(6100);
    expect(ruta.arqueo.cobrados).toBe(1);
  });

  it("cobrar la cuota de UNO solo (sin sobrepago) → 'Abonó', la parada sigue abierta", async () => {
    const clase = clasificarClienteRuta(
      [
        { cuota: 3600, pagadoHoy: 3600, plazoVencido: false },
        { cuota: 2500, pagadoHoy: 0, plazoVencido: false },
      ],
      false,
    );
    expect(clase.cuotaEnTermino).toBe(6100);
    expect(clase.pagadoHoyEnTermino).toBe(3600);
    expect(clase.estadoHoy).toBe("abono"); // le falta la cuota del crédito B
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo ALTO — netea ENTRE créditos).
  // SILVINA FAGIANI viene atrasada en el crédito A ($3.600) y hoy le paga 2 cuotas
  // ($7.200) SOLO a ese crédito. El crédito B ($2.500) no recibió un peso, pero la
  // suma plana 7.200 ≥ 6.100 la marca "Cobrado". La imputación debe ser crédito por
  // crédito: Σ min(pagado_i, cuota_i) = 3.600 → "Abonó", falta $2.500.
  it.fails(
    "pagar de MÁS en un crédito NO puede tapar la cuota impaga del otro (163 clientes en la base)",
    () => {
      const clase = clasificarClienteRuta(
        [
          { cuota: 3600, pagadoHoy: 7200, plazoVencido: false },
          { cuota: 2500, pagadoHoy: 0, plazoVencido: false },
        ],
        false,
      );
      expect(clase.pagadoHoyEnTermino).toBe(3600); // hoy da 7200 (neteo entre créditos)
      expect(clase.estadoHoy).toBe("abono"); // hoy da "pagado"
    },
  );

  // ⚠️ FALLA: bug real, ver informe — el mismo neteo visto desde el ARQUEO.
  it.fails("el sobrepago en un crédito no puede dar por cumplida la meta del día del cliente", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-silvina")],
        clientes: [cliente("cli-silvina", "SILVINA FAGIANI")],
        prestamos: [
          prestamo({ id: "pa", cliente: "cli-silvina", cuota: 3600 }),
          prestamo({ id: "pb", cliente: "cli-silvina", cuota: 2500 }),
        ],
        pagos: [pago("pa", 7200)], // 2 cuotas del crédito A, nada del B
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.arqueo.esperado).toBe(6100);
    expect(ruta.items[0].estadoHoy).toBe("abono"); // hoy: "pagado" → la tarjeta se opaca y baja
    expect(ruta.arqueo.recaudadoRuta).toBe(3600); // hoy: 6100 → "Falta $0" con $2.500 sin cobrar
    expect(ruta.arqueo.cobrados).toBe(0);
  });

  it("el tope por CLIENTE sigue firme: pagar de más NO tapa el faltante de OTRO cliente", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-uno"), asignacion("cli-dos")],
        clientes: [cliente("cli-uno", "AAA"), cliente("cli-dos", "BBB")],
        prestamos: [
          prestamo({ id: "p1", cliente: "cli-uno", cuota: 1000 }),
          prestamo({ id: "p2", cliente: "cli-dos", cuota: 1000 }),
        ],
        pagos: [pago("p1", 2000)], // se puso al día pagando 2 cuotas
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.arqueo.esperado).toBe(2000);
    expect(ruta.arqueo.recaudado).toBe(2000); // la plata que entró es plata
    expect(ruta.arqueo.recaudadoRuta).toBe(1000); // pero la ruta sigue "Falta $1.000"
    expect(ruta.arqueo.cobrados).toBe(1);
    expect(ruta.arqueo.pendientes).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. CARTERA VENCIDA — visible para recuperar, fuera del target del día
// ═══════════════════════════════════════════════════════════════════════════
describe("ruta: cartera vencida (plazo cumplido) y recuperaciones", () => {
  it("un vencido puro NO infla el esperado ni el denominador, pero sigue en la lista", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-v")],
        clientes: [cliente("cli-v", "VENCIDO PURO")],
        prestamos: [prestamo({ id: "pv", cliente: "cli-v", cuota: 900, inicio: INICIO_VENCIDO, acum: 500 })],
        pagos: [],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.items).toHaveLength(1);
    expect(ruta.items[0].plazoVencido).toBe(true);
    expect(ruta.items[0].cuota).toBe(0); // no persigue una cuota que ya no está programada
    expect(ruta.arqueo.esperado).toBe(0);
    expect(ruta.arqueo.clientes).toBe(0);
    expect(ruta.arqueo.pendientes).toBe(0); // no bloquea "Ruta completa 🎉"
  });

  it("recuperar deuda vieja: entra al recaudo del día pero NO al % de la ruta", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-v")],
        clientes: [cliente("cli-v", "VENCIDO PURO")],
        prestamos: [prestamo({ id: "pv", cliente: "cli-v", cuota: 900, inicio: INICIO_VENCIDO, acum: 500 })],
        pagos: [pago("pv", 5000)],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.arqueo.recaudado).toBe(5000); // la plata es plata
    expect(ruta.arqueo.recaudadoRuta).toBe(0); // pero no cubre ninguna cuota de hoy
    expect(ruta.arqueo.esperado).toBe(0);
    expect(ruta.items[0].recuperadoHoy).toBe(5000); // señal anti re-visita
  });

  it("cliente MIXTO: la recuperación no marca 'pagado' la cuota vigente (no se saltea la parada)", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-m")],
        clientes: [cliente("cli-m", "MIXTO")],
        prestamos: [
          prestamo({ id: "pt", cliente: "cli-m", cuota: 2000 }),
          prestamo({ id: "pv", cliente: "cli-m", cuota: 1500, inicio: INICIO_VENCIDO, acum: 100 }),
        ],
        pagos: [pago("pv", 5000)], // recuperación sobre el vencido, a las 9 de la mañana
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.items[0].estadoHoy).toBe("pendiente"); // la cuota de hoy sigue impaga
    expect(ruta.items[0].cuota).toBe(2000); // el vencido no suma su cuota al target
    expect(ruta.items[0].plazoVencido).toBe(false); // tiene crédito vigente: no es cartera vencida
    expect(ruta.arqueo.esperado).toBe(2000);
    expect(ruta.arqueo.recaudado).toBe(5000);
    expect(ruta.arqueo.recaudadoRuta).toBe(0);
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo MEDIO — 202 clientes, $18,4M vencidos).
  // `recuperadoHoy` existe justamente para que el cobrador no vuelva a pasar y
  // cobre de nuevo; el gate `soloVencido` lo apaga en los clientes MIXTOS, que
  // son los que más riesgo de doble cobro tienen (tarjeta "Pendiente · $2.000"
  // sin rastro de los $5.000 que ya se llevó).
  it.fails("la recuperación cobrada hoy debe verse TAMBIÉN en el cliente mixto (anti doble cobro)", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-m")],
        clientes: [cliente("cli-m", "MIXTO")],
        prestamos: [
          prestamo({ id: "pt", cliente: "cli-m", cuota: 2000 }),
          prestamo({ id: "pv", cliente: "cli-m", cuota: 1500, inicio: INICIO_VENCIDO, acum: 100 }),
        ],
        pagos: [pago("pv", 5000)],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.items[0].recuperadoHoy).toBe(5000); // hoy devuelve 0: la plata queda invisible
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. CRÉDITOS SALDADOS — tienen que SALIR de la ruta
// ═══════════════════════════════════════════════════════════════════════════
describe("ruta: crédito saldado que todavía no se finalizó", () => {
  it("cuota entera pagada al 100% → el cliente sale de la ruta (no se lo persigue)", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-s")],
        clientes: [cliente("cli-s", "SALDADO")],
        prestamos: [prestamo({ id: "ps", cliente: "cli-s", cuota: 750, dias: 24, acum: 18000 })],
        pagos: [],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.items[0].estadoHoy).toBe("sin_credito");
    expect(ruta.items[0].cuota).toBe(0);
    expect(ruta.arqueo.esperado).toBe(0);
    expect(ruta.arqueo.clientes).toBe(0);
  });

  it("al que le falta UNA cuota entera NO se lo saca: sigue pendiente por $750", async () => {
    // Crédito de 24 cuotas de $750 que arrancó el 10-07: su cuota 24 vence HOY
    // (06-08) contando Lun–Sáb. Pagó 23 ($17.250) → hoy le toca la última.
    // La fecha de inicio importa: con el cronograma, "le falta una cuota" y "hoy
    // le toca una cuota" no son lo mismo — si la última venciera mañana, hoy no
    // se le pide nada (aparece igual en la lista, como "Hoy no toca").
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-s")],
        clientes: [cliente("cli-s", "CASI SALDADO")],
        prestamos: [
          prestamo({ id: "ps", cliente: "cli-s", cuota: 750, dias: 24, inicio: "2026-07-10", acum: 17250 }),
        ],
        pagos: [],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.items[0].estadoHoy).toBe("pendiente");
    expect(ruta.arqueo.esperado).toBe(750);
  });

  it("el CARTÓN de una cuota fraccionaria pagada con enteros da los 24 días PAGADOS", () => {
    // Cuota heredada de Disapp 8425/24 = 351,0416…; el cobrador cobra $351 (lo que
    // la app propone) 24 veces → 8.424 y un residuo INCOBRABLE de $1.
    const cuota = 8425 / 24;
    const pagos = Array.from({ length: 24 }, (_, i) => ({ dia_credito: i + 1, monto: 351 }));
    const carton = calcularEstadosCarton(
      { cuota_diaria: cuota, total_dias: 24, fecha_inicio: "2026-06-03" },
      pagos,
      HOY,
    );
    expect(carton.dias.every((d) => d.estado === "pagado")).toBe(true);
    expect(carton.montoVencido).toBe(0);
    // Y sin embargo el saldo redondeado da $1: ese peso es el que discuten los módulos.
    expect(Math.round(saldoCredito(cuota, 24, 8424))).toBe(1);
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo BAJO — 21 créditos fraccionarios).
  // La ruta corta el saldado con tolerancia FIJA de 0,5 y el cartón con la
  // ACUMULATIVA (0,5 + fracción×días). Con residuo $1 la ruta lo deja vivo y,
  // pasado el plazo, lo pinta "⏳ Cartera vencida · a recuperar" para siempre,
  // mientras el cliente ve su cartón 100% pagado. Dos verdades, mismo crédito.
  it.fails("un crédito fraccionario que el cartón da por pagado no puede seguir en la ruta", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-f")],
        clientes: [cliente("cli-f", "DIEGO ACOSTAL")],
        prestamos: [
          prestamo({ id: "pf", cliente: "cli-f", cuota: 8425 / 24, dias: 24, inicio: "2026-06-03", acum: 8424 }),
        ],
        pagos: [],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.items[0].estadoHoy).toBe("sin_credito"); // hoy: "pendiente" con plazoVencido
    expect(ruta.items[0].plazoVencido).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. EL DÍA QUE NO EXISTE — domingo, y el "hoy no toca" de los no-diarios
// ═══════════════════════════════════════════════════════════════════════════
describe("ruta: cobro de LUNES a SÁBADO", () => {
  it("SEMANAL al día, en un día sin cuota → 'Hoy no toca': fuera del esperado y del denominador", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-sem")],
        clientes: [cliente("cli-sem", "SEMANAL AL DIA")],
        prestamos: [
          prestamo({
            id: "psem",
            cliente: "cli-sem",
            cuota: 1000,
            dias: 10,
            inicio: "2026-07-06",
            frecuencia: "semanal",
            acum: 5000, // pagó las 5 cuotas ya vencidas
          }),
        ],
        pagos: [],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.items[0].sinCuotaHoy).toBe(true);
    expect(ruta.items[0].cuota).toBe(0);
    expect(ruta.arqueo.esperado).toBe(0);
    expect(ruta.arqueo.clientes).toBe(0); // no arranca el día "Cobrados 1/1" sin cobrar nada
    expect(ruta.arqueo.cobrados).toBe(0);
  });

  it("SEMANAL atrasado sí figura, y con el target de UNA cuota (no la deuda entera)", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-sem")],
        clientes: [cliente("cli-sem", "SEMANAL ATRASADO")],
        prestamos: [
          prestamo({
            id: "psem",
            cliente: "cli-sem",
            cuota: 1000,
            dias: 10,
            inicio: "2026-07-06",
            frecuencia: "semanal",
            acum: 2000, // debe 5, pagó 2
          }),
        ],
        pagos: [],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.items[0].sinCuotaHoy).toBe(false);
    expect(ruta.arqueo.esperado).toBe(1000); // una cuota, no 3.000
    expect(ruta.items[0].estadoHoy).toBe("pendiente");
  });

  it("el domingo un NO-DIARIO al día no pide nada (la rama que sí mira el calendario)", () => {
    const semanal = {
      cuota: 1000,
      totalDias: 10,
      fechaInicio: "2026-07-06",
      frecuencia: "semanal" as const,
      pagadoAcum: 5000,
    };
    expect(cuotaObjetivoHoy(semanal, parseFecha("2026-08-09"))).toBe(0);
  });

  // ✅ ARREGLADO (06-08): el domingo NINGUNA cuota vence (fechaDeCuota corre el
  // domingo al lunes), pero la rama diaria devolvía la cuota fija los 7 días →
  // toda la cartera "Pendiente" un día que no se cobra. `cuotaObjetivoHoy` ahora
  // usa el cronograma para TODAS las frecuencias.
  it("el DOMINGO un cliente diario al día no debe nada (ninguna cuota vence en domingo)", () => {
    const diario = {
      cuota: 350,
      totalDias: 24,
      fechaInicio: INICIO_VIGENTE,
      frecuencia: "diario" as const,
      pagadoAcum: 350 * 6, // pagó las 6 cuotas hábiles ya vencidas (lun 03 → sáb 08)
    };
    expect(cuotaObjetivoHoy(diario, parseFecha("2026-08-09"))).toBe(0);
  });

  // ✅ ARREGLADO (06-08): el mismo domingo, visto desde el arqueo.
  it("el DOMINGO el arqueo del cobrador no puede abrir con la cartera entera como meta", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-d")],
        clientes: [cliente("cli-d", "DIARIO AL DIA")],
        prestamos: [prestamo({ id: "pd", cliente: "cli-d", cuota: 350, acum: 350 * 6 })],
        pagos: [],
        visitas: [],
      }),
      DOMINGO,
      "cob-A",
    );
    expect(ruta.arqueo.esperado).toBe(0);
    expect(ruta.items[0].sinCuotaHoy).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  6. CUÁNTO PEDIRLE — el objetivo del día vs. la deuda REAL
// ═══════════════════════════════════════════════════════════════════════════
describe("cuotaObjetivoHoy: el monto que la tarjeta le pide al cliente", () => {
  it("DIARIO al día → 0; con una cuota sin pagar → la cuota fija", () => {
    // Arrancó el lunes 03-08; al jueves 06-08 vencieron 4 cuotas. Con 4 pagadas
    // ($3.000) está al día INCLUIDA la de hoy: pedirle otra sería cobrarle dos
    // veces el mismo día — y el cartón ya da el día 4 por PAGADO. Con 3 pagadas,
    // le toca la de hoy.
    const base = {
      cuota: 750,
      totalDias: 24,
      fechaInicio: INICIO_VIGENTE,
      frecuencia: "diario" as const,
    };
    expect(cuotaObjetivoHoy({ ...base, pagadoAcum: 3000 }, parseFecha("2026-08-06"))).toBe(0);
    expect(cuotaObjetivoHoy({ ...base, pagadoAcum: 2250 }, parseFecha("2026-08-06"))).toBe(750);
    // Atrasado de verdad: debe 4 cuotas pero el target del día sigue siendo UNA.
    expect(cuotaObjetivoHoy({ ...base, pagadoAcum: 0 }, parseFecha("2026-08-06"))).toBe(750);
  });

  it("NO-DIARIO en el tramo final → pide SOLO el saldo (nunca más que la deuda)", () => {
    // cuota 750 × 24 = 18.000, pagado 17.800: la deuda REAL es $200.
    const s = {
      cuota: 750,
      totalDias: 24,
      fechaInicio: "2026-01-05",
      frecuencia: "semanal" as const,
      pagadoAcum: 17800,
    };
    expect(cuotaObjetivoHoy(s, parseFecha("2026-08-06"))).toBe(200);
  });

  // ⚠️ FALLA: bug real, ver informe (hallazgo MEDIO — descuadre de caja).
  // El cobrador le cobra $750 en efectivo, el servidor clampea el asiento a $200
  // (anti sobre-pago) y quedan $550 físicos sin registrar: sobrante en la
  // rendición y plata a devolverle al cliente. La rama diaria ignora pagado_acum.
  it.fails("DIARIO en el tramo final: no puede pedir más que el saldo que queda ($200, no $750)", () => {
    const d = {
      cuota: 750,
      totalDias: 24,
      fechaInicio: "2026-07-20",
      frecuencia: "diario" as const,
      pagadoAcum: 17800,
    };
    expect(cuotaObjetivoHoy(d, parseFecha("2026-08-06"))).toBe(200); // hoy devuelve 750
  });

  it("el objetivo se calcula con lo pagado ANTES de hoy: cobrar a medias no encoge la cuota", () => {
    // Regla anti doble-descuento: el llamador pasa pagado_acum − pagadoHoy. Si el
    // cliente abonó $400 de una cuota de $1.000, el objetivo sigue siendo $1.000
    // (el faltante lo marca estadoHoyDe), no $600.
    const s = {
      cuota: 1000,
      totalDias: 10,
      fechaInicio: "2026-07-06",
      frecuencia: "semanal" as const,
      pagadoAcum: 4000, // 5 vencidas, 4 pagadas ANTES de hoy
    };
    expect(cuotaObjetivoHoy(s, parseFecha("2026-08-06"))).toBe(1000);
    expect(estadoHoyDe(400, 1000, false)).toBe("abono");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  7. LO QUE ENTRÓ HOY — corte de día UY, anulaciones y visitas
// ═══════════════════════════════════════════════════════════════════════════
describe("arqueo: qué plata cuenta como cobrada HOY", () => {
  const conPagos = (pagos: Fila[], visitas: Fila[] = []) =>
    fakeDb({
      asignaciones: [asignacion("cli-1")],
      clientes: [cliente("cli-1", "PEPE")],
      prestamos: [prestamo({ id: "p1", cliente: "cli-1", cuota: 1000 })],
      pagos,
      visitas,
    });

  it("un cobro de AYER no cuenta hoy (el día uruguayo corta a las 03:00 UTC)", async () => {
    const ruta = await getRutaCobrador(conPagos([pago("p1", 1000, AYER_ISO)]), HOY, "cob-A");
    expect(ruta.arqueo.recaudado).toBe(0);
    expect(ruta.items[0].estadoHoy).toBe("pendiente"); // hoy todavía no le cobró
  });

  it("un pago ANULADO no vuelve a contar (los pagos no se borran, se anulan)", async () => {
    const anulado = { ...pago("p1", 1000), anulado: true };
    const ruta = await getRutaCobrador(conPagos([anulado]), HOY, "cob-A");
    expect(ruta.arqueo.recaudado).toBe(0);
    expect(ruta.items[0].estadoHoy).toBe("pendiente");
  });

  it("dos abonos del mismo día se SUMAN y completan la cuota", async () => {
    const ruta = await getRutaCobrador(conPagos([pago("p1", 400), pago("p1", 600)]), HOY, "cob-A");
    expect(ruta.items[0].pagadoHoy).toBe(1000);
    expect(ruta.items[0].estadoHoy).toBe("pagado");
    expect(ruta.arqueo.recaudadoRuta).toBe(1000);
    expect(ruta.arqueo.abonos).toBe(0);
  });

  it("un abono PARCIAL deja la parada abierta ('Abonó', no 'Cobrado')", async () => {
    const ruta = await getRutaCobrador(conPagos([pago("p1", 400)]), HOY, "cob-A");
    expect(ruta.items[0].estadoHoy).toBe("abono");
    expect(ruta.arqueo.abonos).toBe(1);
    expect(ruta.arqueo.cobrados).toBe(0);
    expect(ruta.arqueo.pendientes).toBe(0); // ya fue visitado: no es "pendiente puro"
    expect(ruta.arqueo.recaudadoRuta).toBe(400);
  });

  it("visita sin cobro → 'No pago' (y no queda contado como pendiente)", async () => {
    const ruta = await getRutaCobrador(conPagos([], [visita("p1", "no_estaba")]), HOY, "cob-A");
    expect(ruta.items[0].estadoHoy).toBe("no_pago");
    expect(ruta.arqueo.noPagos).toBe(1);
    expect(ruta.arqueo.pendientes).toBe(0);
    expect(ruta.arqueo.esperado).toBe(1000); // pero la cuota sigue esperándose
  });

  it("si además pagó, el cobro le gana a la visita no-pago", async () => {
    const ruta = await getRutaCobrador(conPagos([pago("p1", 1000)], [visita("p1", "pago")]), HOY, "cob-A");
    expect(ruta.items[0].estadoHoy).toBe("pagado");
    expect(ruta.arqueo.noPagos).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  8. EL RECORRIDO Y EL DENOMINADOR DE "RUTA COMPLETA"
// ═══════════════════════════════════════════════════════════════════════════
describe("ruta: orden del recorrido y denominador del día", () => {
  it("el orden guardado por el cobrador viaja al item; sin orden queda null (va al final)", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [
          asignacion("cli-a", 5),
          asignacion("cli-a", 2), // dos asignaciones activas: gana la MENOR
          asignacion("cli-b", null),
        ],
        clientes: [cliente("cli-a", "AAA"), cliente("cli-b", "BBB")],
        prestamos: [
          prestamo({ id: "p1", cliente: "cli-a", cuota: 100 }),
          prestamo({ id: "p2", cliente: "cli-b", cuota: 100 }),
        ],
        pagos: [],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    const porNombre = Object.fromEntries(ruta.items.map((i) => [i.cliente.nombre, i]));
    expect(porNombre["AAA"].orden).toBe(2);
    expect(porNombre["BBB"].orden).toBeNull();
  });

  it("el denominador cuenta SOLO paradas cobrables: ni vencidos, ni 'hoy no toca', ni sin crédito", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [
          asignacion("cli-1"),
          asignacion("cli-2"),
          asignacion("cli-3"),
          asignacion("cli-4"),
        ],
        clientes: [
          cliente("cli-1", "A DIARIO PENDIENTE"),
          cliente("cli-2", "B VENCIDO"),
          cliente("cli-3", "C SEMANAL AL DIA"),
          cliente("cli-4", "D SIN CREDITO"),
        ],
        prestamos: [
          prestamo({ id: "p1", cliente: "cli-1", cuota: 1200 }),
          prestamo({ id: "p2", cliente: "cli-2", cuota: 900, inicio: INICIO_VENCIDO, acum: 100 }),
          prestamo({
            id: "p3",
            cliente: "cli-3",
            cuota: 1000,
            dias: 10,
            inicio: "2026-07-06",
            frecuencia: "semanal",
            acum: 5000,
          }),
        ],
        pagos: [],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.items).toHaveLength(4); // los 4 siguen VISIBLES en la lista
    expect(ruta.arqueo.clientes).toBe(1); // "Cobrados 0/1", no 0/4
    expect(ruta.arqueo.pendientes).toBe(1);
    expect(ruta.arqueo.esperado).toBe(1200);
  });

  it("cobrada la única parada cobrable, la ruta queda COMPLETA aunque haya vencidos en la lista", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-1"), asignacion("cli-2")],
        clientes: [cliente("cli-1", "A DIARIO"), cliente("cli-2", "B VENCIDO")],
        prestamos: [
          prestamo({ id: "p1", cliente: "cli-1", cuota: 1200 }),
          prestamo({ id: "p2", cliente: "cli-2", cuota: 900, inicio: INICIO_VENCIDO, acum: 100 }),
        ],
        pagos: [pago("p1", 1200)],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.arqueo.cobrados).toBe(1);
    expect(ruta.arqueo.clientes).toBe(1);
    expect(ruta.arqueo.pendientes).toBe(0);
    expect(ruta.arqueo.recaudadoRuta).toBe(ruta.arqueo.esperado); // "Ruta completa 🎉"
  });

  it("sin asignaciones activas la ruta viene vacía y el arqueo en cero (no explota)", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({ asignaciones: [], clientes: [], prestamos: [], pagos: [], visitas: [] }),
      HOY,
      "cob-A",
    );
    expect(ruta.items).toEqual([]);
    expect(ruta.arqueo.esperado).toBe(0);
    expect(ruta.arqueo.recaudado).toBe(0);
    expect(ruta.arqueo.clientes).toBe(0);
  });

  it("un cliente dado de BAJA (activo=false) no aparece en la ruta", async () => {
    const inactivo = { ...cliente("cli-x", "BAJA"), activo: false };
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-x")],
        clientes: [inactivo],
        prestamos: [prestamo({ id: "px", cliente: "cli-x", cuota: 500 })],
        pagos: [],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.items).toEqual([]);
    expect(ruta.arqueo.esperado).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  9. TOLERANCIA SUB-PESO — cuota fraccionaria de Disapp con pagos ENTEROS
// ═══════════════════════════════════════════════════════════════════════════
describe("ruta: cuota fraccionaria heredada + pagos enteros", () => {
  it("cobrar el entero que la app propone marca la parada COBRADA (no 'Abonó' por 4 centavos)", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-f")],
        clientes: [cliente("cli-f", "FRACCIONARIO")],
        prestamos: [
          prestamo({ id: "pf", cliente: "cli-f", cuota: 8425 / 24, dias: 24, inicio: INICIO_VIGENTE }),
        ],
        pagos: [pago("pf", 351)],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.items[0].estadoHoy).toBe("pagado");
    expect(ruta.arqueo.cobrados).toBe(1);
    expect(ruta.arqueo.abonos).toBe(0);
  });

  it("un abono parcial de VERDAD sigue siendo abono (la tolerancia no lo tapa)", async () => {
    const ruta = await getRutaCobrador(
      fakeDb({
        asignaciones: [asignacion("cli-f")],
        clientes: [cliente("cli-f", "FRACCIONARIO")],
        prestamos: [
          prestamo({ id: "pf", cliente: "cli-f", cuota: 8425 / 24, dias: 24, inicio: INICIO_VIGENTE }),
        ],
        pagos: [pago("pf", 300)],
        visitas: [],
      }),
      HOY,
      "cob-A",
    );
    expect(ruta.items[0].estadoHoy).toBe("abono");
    expect(ruta.arqueo.abonos).toBe(1);
  });

  it("estadoHoyDe: el margen es de medio peso, no de un peso", () => {
    expect(estadoHoyDe(351, 351.04, false)).toBe("pagado");
    expect(estadoHoyDe(350, 351.04, false)).toBe("abono");
    expect(estadoHoyDe(1199, 1200, false)).toBe("abono"); // cuota entera: $1 menos NO cierra
  });
});
