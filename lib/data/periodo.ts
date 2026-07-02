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
import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyUY } from "@/lib/fecha";
import { toIso, meses, diasSemana } from "@/lib/format";

const TZ = "America/Montevideo";

export type Periodo = "dia" | "semana" | "mes" | "anio";

export const PERIODOS: { id: Periodo; label: string }[] = [
  { id: "dia", label: "Día" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
  { id: "anio", label: "Año" },
];

export function normalizarPeriodo(v: string | null | undefined): Periodo {
  return v === "semana" || v === "mes" || v === "anio" ? v : "dia";
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
  if (p === "mes") return new Date(y, m, 1);
  return new Date(y, 0, 1); // año
}

function inicioPrevio(inicio: Date, p: Periodo): Date {
  const y = inicio.getFullYear(), m = inicio.getMonth(), d = inicio.getDate();
  if (p === "dia") return new Date(y, m, d - 1);
  if (p === "semana") return new Date(y, m, d - 7);
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
  const prevFinMs = prevInicioMs + transcurrido;

  // Una sola query cubre el período actual y el previo.
  const { data: pagosRaw, error } = await db
    .from("pagos")
    .select("monto, registrado_en, registrado_por")
    .eq("anulado", false)
    .gte("registrado_en", isoUY(prev));
  if (error) throw error;

  // Buckets de la serie interna del período actual.
  const horaActualUY = partesUY(hoy.toISOString()).h;
  const { buckets, indice, unidad } = construirBuckets(base, inicio, periodo, horaActualUY);

  let recaudado = 0;
  let cobros = 0;
  let recaudadoPrevio = 0;
  // Acumulador por cobrador (solo período actual).
  const porCob = new Map<string, { recaudado: number; cobros: number }>();

  for (const r of pagosRaw ?? []) {
    const ts = Date.parse(r.registrado_en as string);
    const monto = Number(r.monto);
    if (ts >= inicioMs && ts <= ahoraMs) {
      recaudado += monto;
      cobros += 1;
      const k = claveBucket(r.registrado_en as string, periodo);
      const i = indice.get(k);
      if (i !== undefined) buckets[i].valor += monto;
      const cobId = (r.registrado_por as string | null) ?? "oficina";
      const acc = porCob.get(cobId) ?? { recaudado: 0, cobros: 0 };
      acc.recaudado += monto;
      acc.cobros += 1;
      porCob.set(cobId, acc);
    } else if (ts >= prevInicioMs && ts <= prevFinMs) {
      recaudadoPrevio += monto;
    }
  }

  // Nombres de los cobradores que recaudaron en el período.
  const cobIds = [...porCob.keys()].filter((k) => k !== "oficina");
  const nombreCob = new Map<string, string>();
  if (cobIds.length > 0) {
    const { data: us } = await db.from("usuarios").select("id, nombre").in("id", cobIds);
    for (const u of us ?? []) nombreCob.set(u.id as string, u.nombre as string);
  }
  const porCobrador: RecaudoCobrador[] = [...porCob.entries()]
    .map(([id, v]) => ({
      cobradorId: id,
      nombre: id === "oficina" ? "Sin asignar" : (nombreCob.get(id) ?? "Cobrador"),
      recaudado: v.recaudado,
      cobros: v.cobros,
    }))
    .sort((a, b) => b.recaudado - a.recaudado);

  // Colocación y créditos del período (por fecha_inicio / finalizado_en).
  const desdeFecha = toIso(inicio);
  const hastaFecha = toIso(base);
  const [colocRes, finRes] = await Promise.all([
    db.from("prestamos").select("monto_prestado").gte("fecha_inicio", desdeFecha).lte("fecha_inicio", hastaFecha),
    db
      .from("prestamos")
      .select("*", { count: "exact", head: true })
      .eq("estado", "finalizado")
      .gte("finalizado_en", isoUY(inicio))
      .lte("finalizado_en", new Date(ahoraMs).toISOString()),
  ]);
  if (colocRes.error) throw colocRes.error;
  const colocado = (colocRes.data ?? []).reduce((s, r) => s + Number(r.monto_prestado), 0);
  const creditosNuevos = (colocRes.data ?? []).length;
  const creditosFinalizados = finRes.count ?? 0;

  const variacionPct =
    recaudadoPrevio > 0 ? (recaudado - recaudadoPrevio) / recaudadoPrevio : recaudado > 0 ? 1 : null;

  return {
    periodo,
    etiqueta: etiquetaPeriodo(base, periodo),
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

/** Clave de bucket de un pago según el período (hora / día / mes). */
function claveBucket(iso: string, periodo: Periodo): string {
  const { y, m, d, h } = partesUY(iso);
  if (periodo === "dia") return `h${h}`;
  if (periodo === "anio") return `${y}-${pad(m)}`;
  return `${y}-${pad(m)}-${pad(d)}`; // semana y mes → por día
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
  // semana (7 días desde el lunes) o mes (todos los días del mes)
  const dias =
    periodo === "semana" ? 7 : new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
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
  if (periodo === "mes") return `${meses[base.getMonth()][0].toUpperCase()}${meses[base.getMonth()].slice(1)}`;
  return `Año ${base.getFullYear()}`;
}
