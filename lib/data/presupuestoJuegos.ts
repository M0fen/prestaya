// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — PRESUPUESTO DE JUEGOS (0130).
//  Suma lo que REALMENTE se entregó en premios por período (día/semana/mes/año)
//  y arma el insumo del simulador "¿cuánto dejo en la calle si regalo N?".
//
//  Fuente de verdad de cada juego:
//   · raspaditas_jugadas  → una fila por jugada; `costo` congelado al entregar.
//   · quinielas           → `costo_premio` cuando el sorteo se CIERRA con ganador.
//   · rifas               → `costo_premio` cuando se sortea.
//   · estrellas_redenciones → `costo` de los canjes APROBADOS.
//
//  Todo degrada a ceros si 0130 aún no corrió (columnaFaltante/tablaFaltante),
//  igual que el resto del panel: una migración pendiente no rompe la pantalla.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "./paginado";
import { tablaFaltante, columnaFaltante } from "./errores";
import { hoyUY, fechaISOUY, diaUYInicioIso, inicioMesUYIso } from "@/lib/fecha";
import {
  totalDe,
  costoDeTramo,
  type GastoPeriodo,
  type CostoTramo,
  type PremioConCosto,
} from "@/lib/presupuestoJuegos";
import { getSegmentosRaspa } from "./promos";

/** Ventana [desde, hasta) en ISO, más su etiqueta. */
interface Ventana {
  etiqueta: string;
  desde: string;
  hasta: string;
}

/** Las 4 ventanas del panel, en hora de Uruguay. */
export function ventanasDe(hoy: Date = new Date()): Ventana[] {
  const finIso = new Date(hoyUY(hoy).getTime() + 86_400_000).toISOString(); // mañana 00:00 UY
  const ymd = fechaISOUY(hoy);
  const inicioAnio = `${ymd.slice(0, 4)}-01-01`;
  // Semana = últimos 7 días corridos (incluye hoy): es lo que el dueño entiende
  // por "esta semana" cuando mira el gasto, sin depender de en qué día cae.
  const hace6 = new Date(hoyUY(hoy).getTime() - 6 * 86_400_000);
  return [
    { etiqueta: "Hoy", desde: diaUYInicioIso(ymd), hasta: finIso },
    { etiqueta: "Últimos 7 días", desde: diaUYInicioIso(fechaISOUY(hace6)), hasta: finIso },
    { etiqueta: "Este mes", desde: inicioMesUYIso(hoy), hasta: finIso },
    { etiqueta: "Este año", desde: diaUYInicioIso(inicioAnio), hasta: finIso },
  ];
}

interface FilaCosto {
  fecha: string;
  costo: number;
}

/** Lee una tabla de premios entregados y devuelve [{fecha, costo}]. Degrada a [].
 *  `igual` es un filtro opcional de igualdad (p. ej. solo los aprobados). */
async function leerCostos(
  db: SupabaseClient,
  tabla: string,
  colFecha: string,
  colCosto: string,
  desdeAnio: string,
  igual?: { col: string; val: string },
): Promise<FilaCosto[]> {
  try {
    const filas = await traerTodo<Record<string, unknown>>((d, h) => {
      const base = db
        .from(tabla)
        .select(`${colFecha}, ${colCosto}`)
        .gte(colFecha, desdeAnio);
      const conFiltro = igual ? base.eq(igual.col, igual.val) : base;
      return conFiltro.order("id", { ascending: true }).range(d, h);
    });
    return filas
      .filter((r) => r[colFecha] != null)
      .map((r) => ({ fecha: String(r[colFecha]), costo: Number(r[colCosto] ?? 0) }));
  } catch (e) {
    if (tablaFaltante(e) || columnaFaltante(e)) return []; // 0130 sin correr
    throw e;
  }
}

const enVentana = (f: string, v: Ventana) => f >= v.desde && f < v.hasta;

export interface ResumenPresupuesto {
  periodos: GastoPeriodo[];
  /** Tope mensual configurado (0 = sin tope). */
  topeMensual: number;
  /** Costo esperado por jugada de cada tramo (insumo del simulador). */
  tramos: CostoTramo[];
  /** Premios de raspadita sin costo cargado → la proyección sería mentira. */
  premiosSinCosto: string[];
  /** ¿Corrió 0130? Si no, todo da 0 y la pantalla lo dice en vez de mentir. */
  disponible: boolean;
}

/**
 * Todo lo que la pantalla de presupuesto necesita, en una sola pasada.
 * Se lee el AÑO en curso una vez y se corta en memoria para las 4 ventanas
 * (son tablas chicas: 111 jugadas hoy, 2 quinielas, 1 rifa).
 */
export async function getResumenPresupuesto(
  db: SupabaseClient,
  hoy: Date = new Date(),
): Promise<ResumenPresupuesto> {
  const vs = ventanasDe(hoy);
  const desdeAnio = vs[3].desde;

  const [raspa, quiniela, rifa, estrellas, premios, segmentos, tope] = await Promise.all([
    // Solo las jugadas GANADORAS cuestan: un "¡Seguí participando!" no se paga.
    leerCostos(db, "raspaditas_jugadas", "jugado_en", "costo", desdeAnio, {
      col: "premio_tipo",
      val: "beneficio",
    }),
    // Una quiniela cuesta cuando se CIERRA (ya hay ganador).
    leerCostos(db, "quinielas", "sorteo_en", "costo_premio", desdeAnio),
    leerCostos(db, "rifas", "sorteo_en", "costo_premio", desdeAnio),
    // Canjes de estrellas APROBADOS (los pendientes/rechazados no se pagaron).
    leerCostos(db, "estrellas_redenciones", "resuelto_en", "costo", desdeAnio, {
      col: "estado",
      val: "aprobada",
    }),
    getPremiosConCosto(db),
    getSegmentosRaspa(db).catch(() => []),
    getTopeMensual(db),
  ]);

  const periodos = vs.map((v) =>
    totalDe({
      etiqueta: v.etiqueta,
      raspaditas: raspa.filter((r) => enVentana(r.fecha, v)).length,
      raspaditasCosto: raspa.filter((r) => enVentana(r.fecha, v)).reduce((s, r) => s + r.costo, 0),
      quinielas: quiniela.filter((r) => enVentana(r.fecha, v)).length,
      quinielasCosto: quiniela.filter((r) => enVentana(r.fecha, v)).reduce((s, r) => s + r.costo, 0),
      rifas: rifa.filter((r) => enVentana(r.fecha, v)).length,
      rifasCosto: rifa.filter((r) => enVentana(r.fecha, v)).reduce((s, r) => s + r.costo, 0),
      estrellas: estrellas.filter((r) => enVentana(r.fecha, v)).length,
      estrellasCosto: estrellas.filter((r) => enVentana(r.fecha, v)).reduce((s, r) => s + r.costo, 0),
    }),
  );

  const tramos = segmentos
    .filter((s) => s.activo)
    .map((s) =>
      costoDeTramo(
        s,
        premios.filter((p) => (p.segmentoId ?? null) === s.id || (s.esDefault && !p.segmentoId)),
      ),
    );

  return {
    periodos,
    topeMensual: tope,
    tramos,
    premiosSinCosto: premios
      .filter((p) => p.tipo === "beneficio" && p.activo && p.costo <= 0)
      .map((p) => p.label),
    disponible: premios.length === 0 || premios.some((p) => "costo" in p),
  };
}

/** Premios de raspadita con su costo de lista (0130). Costo 0 si falta la columna. */
export async function getPremiosConCosto(db: SupabaseClient): Promise<PremioConCosto[]> {
  const map = (r: Record<string, unknown>): PremioConCosto => ({
    id: r.id as string,
    label: (r.label as string) ?? "",
    tipo: (r.tipo as PremioConCosto["tipo"]) ?? "nada",
    peso: Number(r.peso ?? 0),
    activo: Boolean(r.activo),
    segmentoId: (r.segmento_id as string | null) ?? null,
    costo: Number(r.costo ?? 0),
  });
  try {
    const { data, error } = await db
      .from("raspadita_premios")
      .select("id, label, tipo, peso, activo, segmento_id, costo")
      .order("orden", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(map);
  } catch (e) {
    if (!columnaFaltante(e) && !tablaFaltante(e)) throw e;
    try {
      const { data } = await db
        .from("raspadita_premios")
        .select("id, label, tipo, peso, activo, segmento_id")
        .order("orden", { ascending: true });
      return (data ?? []).map(map); // costo 0 → la pantalla avisa que falta 0130
    } catch {
      return [];
    }
  }
}

/** Tope mensual de gasto en premios (0 = sin tope). */
export async function getTopeMensual(db: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await db
      .from("presupuesto_juegos")
      .select("tope_mensual")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    return Math.round(Number(data?.tope_mensual ?? 0));
  } catch {
    return 0;
  }
}
