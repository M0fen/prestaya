// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — MOVIMIENTO por PERÍODO (día / semana / mes / año).
//  Da al admin el flujo real de cada ventana: recaudado (con comparación al
//  período anterior de igual duración transcurrida), cobros, ticket, capital
//  colocado, créditos nuevos/finalizados, y una serie interna para graficar.
//
//  Cortes SIEMPRE en el día calendario de Uruguay (UTC−3, sin horario de
//  verano) y tz-independiente del runtime: los límites se calculan con Date.UTC
//  a las 03:00 UTC = medianoche de Uruguay.
// ─────────────────────────────────────────────────────────────────────────
import { traerTodo } from "./paginado";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyUY } from "@/lib/fecha";
import { toIso, meses, diasSemana } from "@/lib/format";

const TZ = "America/Montevideo";

export type Periodo = "dia" | "semana" | "quincena" | "mes" | "anio";

export const PERIODOS: { id: Periodo; label: string }[] = [
  { id: "dia", label: "Día" },
  { id: "semana", label: "Semana" },
  { id: "quincena", label: "Quincena" },
  { id: "mes", label: "Mes" },
  { id: "anio", label: "Año" },
];

export function normalizarPeriodo(v: string | null | undefined): Periodo {
  return v === "semana" || v === "quincena" || v === "mes" || v === "anio" ? v : "dia";
}

export interface PuntoSerie {
  etiqueta: string;
  valor: number;
  esActual: boolean;
}

export interface RecaudoCobrador {
  cobradorId: string;
  nombre: string;
  recaudado: number;
  cobros: number;
}

export interface ResumenPeriodo {
  periodo: Periodo;
  etiqueta: string;
  /** Rango del período en "YYYY-MM-DD" (día UY). Para mostrar "del X al Y". */
  desde: string;
  hasta: string;
  recaudado: number;
  cobros: number;
  ticketPromedio: number;
  colocado: number;
  creditosNuevos: number;
  creditosFinalizados: number;
  recaudadoPrevio: number;
  /** Variación vs el período anterior (misma duración transcurrida). null si no hay base. */
  variacionPct: number | null;
  serie: PuntoSerie[];
  serieUnidad: string;
  /** Recaudo por cobrador en el período (de mayor a menor). */
  porCobrador: RecaudoCobrador[];
}

// ── Helpers de tiempo (Uruguay) ────────────────────────────────────────────

/** UTC ISO de la medianoche de Uruguay para la fecha calendario del Date local. */
function isoUY(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 3, 0, 0)).toISOString();
}

/** Partes calendario de Uruguay (año/mes/día/hora) de un instante ISO. */
function partesUY(iso: string): { y: number; m: number; d: number; h: number } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour") };
}

/** Inicio del período (Date local con la fecha calendario de Uruguay). */
function inicioPeriodo(base: Date, p: Periodo): Date {
  const y = base.getFullYear(), m = base.getMonth(), d = base.getDate();
  if (p === "dia") return new Date(y, m, d);
  if (p === "semana") return new Date(y, m, d - ((base.getDay() + 6) % 7)); // lunes
  // Quincena: la cadencia con la que se LIQUIDAN las comisiones (decisión 08-05).
  // 1ª = del 1 al 15 · 2ª = del 16 a fin de mes (calendario, no "cada 15 días").
  if (p === "quincena") return new Date(y, m, d <= 15 ? 1 : 16);
  if (p === "mes") return new Date(y, m, 1);
  return new Date(y, 0, 1); // año
}

function inicioPrevio(inicio: Date, p: Periodo): Date {
  const y = inicio.getFullYear(), m = inicio.getMonth(), d = inicio.getDate();
  if (p === "dia") return new Date(y, m, d - 1);
  if (p === "semana") return new Date(y, m, d - 7);
  // 2ª quincena → la 1ª del mismo mes; 1ª quincena → la 2ª del mes anterior.
  if (p === "quincena") return d >= 16 ? new Date(y, m, 1) : new Date(y, m - 1, 16);
  if (p === "mes") return new Date(y, m - 1, 1);
  return new Date(y - 1, 0, 1);
}

const pad = (n: number) => String(n).padStart(2, "0");

// ── Cálculo ────────────────────────────────────────────────────────────────

export async function getResumenPeriodo(
  db: SupabaseClient,
  periodo: Periodo,
  hoy: Date = new Date(),
): Promise<ResumenPeriodo> {
  const base = hoyUY(hoy);
  const inicio = inicioPeriodo(base, periodo);
  const prev = inicioPrevio(inicio, periodo);

  const inicioMs = Date.parse(isoUY(inicio));
  const ahoraMs = hoy.getTime();
  const transcurrido = Math.max(0, ahoraMs - inicioMs);
  const prevInicioMs = Date.parse(isoUY(prev));
  // La ventana previa se CAPA al inicio del período actual: con períodos de
  // distinta longitud (2ª quincena de 16 días vs 1ª de 15, febrero vs enero) el
  // "previo + transcurrido" desbordaba hacia el período ACTUAL y la comparación
  // contaba recaudo de hoy como si fuera de ayer.
  const prevFinMs = Math.min(prevInicioMs + transcurrido, inicioMs);

  // Buckets vacíos de la serie interna del período actual.
  const horaActualUY = partesUY(hoy.toISOString()).h;
  const { buckets, indice, unidad } = construirBuckets(base, inicio, periodo, horaActualUY);
  const hastaIso = new Date(ahoraMs).toISOString();
  const prevFinIso = new Date(prevFinMs).toISOString();

  // Recaudo AGREGADO en SQL (una llamada) en vez de traer decenas de miles de
  // pagos y sumar en JS (eso hacía que /cierre tardara minutos). `unidad` mapea
  // el bucket: hora (día) · día (semana/mes) · mes (año).
  const unidadSql = periodo === "dia" ? "hora" : periodo === "anio" ? "mes" : "dia";
  let recaudado = 0;
  let cobros = 0;
  let recaudadoPrevio = 0;
  let porCobRaw: { id: string | null; v: number; n: number }[] = [];
  try {
    const [aggRes, prevRes] = await Promise.all([
      db.rpc("app_recaudo_agregado", { desde: isoUY(inicio), hasta: hastaIso, unidad: unidadSql }),
      db.rpc("app_suma_pagos_entre", { desde: isoUY(prev), hasta: prevFinIso }),
    ]);
    if (aggRes.error) throw aggRes.error;
    const a = (aggRes.data ?? {}) as {
      recaudado?: number; cobros?: number;
      serie?: { k: string; v: number }[];
      porCobrador?: { id: string | null; v: number; n: number }[];
    };
    recaudado = Number(a.recaudado ?? 0);
    cobros = Number(a.cobros ?? 0);
    recaudadoPrevio = Number(prevRes.data ?? 0);
    for (const s of a.serie ?? []) {
      const i = indice.get(s.k);
      if (i !== undefined) buckets[i].valor = Number(s.v);
    }
    porCobRaw = a.porCobrador ?? [];
  } catch {
    // Fallback si aún no se re-corrió 0040 (RPC nueva ausente): escalares con las
    // RPCs vivas; la serie y el detalle por cobrador quedan vacíos temporalmente.
    const [sAct, cAct, sPrev] = await Promise.all([
      db.rpc("app_suma_pagos_entre", { desde: isoUY(inicio), hasta: hastaIso }),
      db.rpc("app_cuenta_pagos_entre", { desde: isoUY(inicio), hasta: hastaIso }),
      db.rpc("app_suma_pagos_entre", { desde: isoUY(prev), hasta: prevFinIso }),
    ]);
    recaudado = Number(sAct.data ?? 0);
    cobros = Number(cAct.data ?? 0);
    recaudadoPrevio = Number(sPrev.data ?? 0);
  }

  // Nombres de los cobradores que recaudaron en el período.
  const cobIds = porCobRaw.map((c) => c.id).filter((x): x is string => !!x);
  const nombreCob = new Map<string, string>();
  if (cobIds.length > 0) {
    const { data: us } = await db.from("usuarios").select("id, nombre").in("id", cobIds);
    for (const u of us ?? []) nombreCob.set(u.id as string, u.nombre as string);
  }
  const porCobrador: RecaudoCobrador[] = porCobRaw
    .map((c) => ({
      cobradorId: c.id ?? "oficina",
      nombre: c.id ? (nombreCob.get(c.id) ?? "Cobrador") : "Sin asignar",
      recaudado: Number(c.v),
      cobros: Number(c.n),
    }))
    .sort((a, b) => b.recaudado - a.recaudado);

  const desdeFecha = toIso(inicio);
  const hastaFecha = toIso(base);
  // Colocación y créditos del período.
  // ⚠️ Por `creado_en` (CUÁNDO se entregó la plata), NO por `fecha_inicio`: desde
  // que el crédito arranca el próximo día de cobro, `fecha_inicio` es mañana. Con
  // el filtro viejo, "Colocado hoy" mostraba lo de AYER; lo colocado el sábado
  // daba $0 (su inicio es lunes) y lo del día 15 se iba a la quincena siguiente.
  const [coloc, finRes] = await Promise.all([
    traerTodo<{ monto_prestado: number; creado_por: string | null }>((d, h) =>
      db
        .from("prestamos")
        .select("monto_prestado, creado_por")
        // Una venta DESHECHA (estado cancelado) no es capital colocado: contarla
        // inflaba "Colocado hoy" del Cierre/Dashboard (queja del admin 16-08).
        .neq("estado", "cancelado")
        .gte("creado_en", isoUY(inicio))
        .lte("creado_en", new Date(ahoraMs).toISOString())
        .order("id", { ascending: true }) // estable: evita overlap entre páginas
        .range(d, h),
    ),
    db
      .from("prestamos")
      .select("*", { count: "exact", head: true })
      .eq("estado", "finalizado")
      .gte("finalizado_en", isoUY(inicio))
      .lte("finalizado_en", new Date(ahoraMs).toISOString()),
  ]);
  if (finRes.error) throw finRes.error;
  // ⚠️ Solo lo COLOCADO POR ALGUIEN. El empalme importa la cartera de las zonas que
  // siguen en Disapp SIN setear `creado_por`, y `creado_en` cae por default en el
  // momento del import: sin este filtro, el día en que se corre el empalme
  // "Colocado hoy" se llenaba con cartera importada que nadie prestó hoy. Con el
  // filtro viejo (`fecha_inicio`) esto quedaba tapado de rebote.
  const colocadoDelPeriodo = coloc.filter((r) => r.creado_por != null);
  const colocado = colocadoDelPeriodo.reduce((s, r) => s + Number(r.monto_prestado), 0);
  const creditosNuevos = colocadoDelPeriodo.length;
  const creditosFinalizados = finRes.count ?? 0;

  const variacionPct =
    recaudadoPrevio > 0 ? (recaudado - recaudadoPrevio) / recaudadoPrevio : recaudado > 0 ? 1 : null;

  return {
    periodo,
    etiqueta: etiquetaPeriodo(base, periodo),
    desde: desdeFecha,
    hasta: hastaFecha,
    recaudado,
    cobros,
    ticketPromedio: cobros > 0 ? Math.round(recaudado / cobros) : 0,
    colocado,
    creditosNuevos,
    creditosFinalizados,
    recaudadoPrevio,
    variacionPct,
    serie: buckets,
    serieUnidad: unidad,
    porCobrador,
  };
}

/** Arma los buckets vacíos de la serie interna + su índice y la unidad. */
function construirBuckets(
  base: Date,
  inicio: Date,
  periodo: Periodo,
  horaActualUY: number,
): { buckets: PuntoSerie[]; indice: Map<string, number>; unidad: string } {
  const buckets: PuntoSerie[] = [];
  const indice = new Map<string, number>();
  const push = (clave: string, etiqueta: string, esActual: boolean) => {
    indice.set(clave, buckets.length);
    buckets.push({ etiqueta, valor: 0, esActual });
  };

  if (periodo === "dia") {
    for (let h = 6; h <= 21; h++) push(`h${h}`, `${h}`, h === horaActualUY);
    return { buckets, indice, unidad: "por hora" };
  }
  if (periodo === "anio") {
    const y = base.getFullYear();
    for (let m = 1; m <= 12; m++)
      push(`${y}-${pad(m)}`, meses[m - 1].slice(0, 3), m - 1 === base.getMonth());
    return { buckets, indice, unidad: "por mes" };
  }
  // semana (7 días desde el lunes) · quincena (1–15 / 16–fin) · mes (todos los días)
  const ultimoDelMes = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const dias =
    periodo === "semana"
      ? 7
      : periodo === "quincena"
        ? inicio.getDate() === 1
          ? 15
          : ultimoDelMes - 15
        : ultimoDelMes;
  for (let i = 0; i < dias; i++) {
    const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    const clave = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const etiqueta =
      periodo === "semana" ? `${diasSemana[d.getDay()].slice(0, 3)} ${d.getDate()}` : `${d.getDate()}`;
    const esActual = toIso(d) === toIso(base);
    push(clave, etiqueta, esActual);
  }
  return { buckets, indice, unidad: "por día" };
}

function etiquetaPeriodo(base: Date, periodo: Periodo): string {
  if (periodo === "dia") return `Hoy · ${base.getDate()} ${meses[base.getMonth()].slice(0, 3)}`;
  if (periodo === "semana") return "Esta semana";
  if (periodo === "quincena")
    return `${base.getDate() <= 15 ? "1ª" : "2ª"} quincena de ${meses[base.getMonth()]}`;
  if (periodo === "mes") return `${meses[base.getMonth()][0].toUpperCase()}${meses[base.getMonth()].slice(1)}`;
  return `Año ${base.getFullYear()}`;
}
