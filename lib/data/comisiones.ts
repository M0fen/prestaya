// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — COMISIONES por cobrador (tasa % sobre lo recaudado).
//  Reusa el recaudado por cobrador del período (getResumenPeriodo) y le aplica
//  la comision_pct de cada cobrador (columna en `usuarios`, 0014). Lista TODOS
//  los cobradores activos (para poder fijarles la tasa aunque no hayan cobrado).
//  Degrada si 0014 aún no corrió (disponible=false, pct=0).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { getResumenPeriodo, type Periodo } from "./periodo";
import { calcularComision } from "@/lib/comision";
import { columnaFaltante } from "./errores";
import { meses } from "@/lib/format";
import { diaUYInicioIso, diaUYFinIso } from "@/lib/fecha";

/** Recaudado del período atribuido al DUEÑO DE LA RUTA (`prestamos.cobrador_id`),
 *  no a quien registró el pago: un cobro de oficina/transferencia igual le paga
 *  comisión al cobrador de la ruta (regla del negocio). Vía RPC `app_comision_por_ruta`
 *  (0069). Devuelve null si la RPC no está aún → el llamador cae a la atribución
 *  previa (por `registrado_por`) sin romperse. `desde`/`hasta` son días UY "YYYY-MM-DD". */
async function recaudoPorRuta(
  db: SupabaseClient,
  desde: string,
  hasta: string,
): Promise<Map<string, { recaudado: number; cobros: number }> | null> {
  const { data, error } = await db.rpc("app_comision_por_ruta", {
    desde: diaUYInicioIso(desde),
    hasta: diaUYFinIso(hasta), // fin EXCLUSIVO (inicio del día siguiente)
  });
  if (error) return null; // 0069 sin correr → fallback
  const m = new Map<string, { recaudado: number; cobros: number }>();
  for (const r of (data ?? []) as { cobrador_id: string | null; recaudado: number; cobros: number }[]) {
    if (r.cobrador_id) m.set(r.cobrador_id, { recaudado: Number(r.recaudado), cobros: Number(r.cobros) });
  }
  return m;
}

/** Período canónico ("mes:2026-07") → etiqueta legible ("Julio 2026"). */
export function etiquetaPeriodoKey(key: string): string {
  const [tipo, val] = (key ?? "").split(":");
  if (!val) return key;
  const [y, m, d] = val.split("-").map(Number);
  const mesN = (mm: number) => meses[mm - 1] ?? "";
  if (tipo === "mes") return `${mesN(m)} ${y}`;
  if (tipo === "anio") return `Año ${y}`;
  if (tipo === "dia") return `${d} ${mesN(m).slice(0, 3)} ${y}`;
  if (tipo === "semana") return `Semana del ${d} ${mesN(m).slice(0, 3)}`;
  return key;
}

export interface Liquidacion {
  id: string;
  cobradorNombre: string;
  periodoKey: string;
  monto: number;
  liquidadoPorNombre: string | null;
  liquidadoEn: string;
}

/** Historial de comisiones ya liquidadas (más reciente primero). Vacío si falta 0049. */
export async function getHistorialLiquidaciones(
  db: SupabaseClient,
  limite = 40,
): Promise<Liquidacion[]> {
  try {
    const { data, error } = await db
      .from("comisiones_liquidadas")
      .select("id, cobrador_id, periodo_key, monto, liquidado_por_nombre, liquidado_en")
      .order("liquidado_en", { ascending: false })
      .limit(limite);
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    const ids = [...new Set(rows.map((r) => r.cobrador_id as string).filter(Boolean))];
    const nombre = new Map<string, string>();
    if (ids.length > 0) {
      const { data: us } = await db.from("usuarios").select("id, nombre").in("id", ids);
      for (const u of us ?? []) nombre.set(u.id as string, u.nombre as string);
    }
    return rows.map((r) => ({
      id: r.id as string,
      cobradorNombre: nombre.get(r.cobrador_id as string) ?? "Cobrador",
      periodoKey: r.periodo_key as string,
      monto: Number(r.monto),
      liquidadoPorNombre: (r.liquidado_por_nombre as string | null) ?? null,
      liquidadoEn: r.liquidado_en as string,
    }));
  } catch {
    return [];
  }
}

export interface FilaComision {
  cobradorId: string;
  nombre: string;
  recaudado: number;
  cobros: number;
  pct: number;
  comision: number;
  /** Si ya se liquidó la comisión de ESTE período (candado anti-doble-pago). */
  liquidado: { monto: number; fecha: string } | null;
}

/** Clave canónica del período para la idempotencia (mes:2026-07, dia:2026-07-09…).
 *  Exportada para test: es la LLAVE del candado anti-doble-pago de comisiones
 *  (0049). Si dos períodos distintos generaran la misma clave, un cobrador podría
 *  cobrar dos veces o quedar bloqueado — por eso se fija con test. */
export function periodoKeyDe(periodo: Periodo, desde: string): string {
  if (periodo === "mes") return `mes:${desde.slice(0, 7)}`;
  if (periodo === "anio") return `anio:${desde.slice(0, 4)}`;
  return `${periodo}:${desde}`; // dia / semana usan el inicio del período
}

/**
 * Rango de fechas [desde, hasta] (día UY "YYYY-MM-DD") que CUBRE una periodo_key
 * canónica (dia/semana/mes/anio). Sirve para detectar SOLAPAMIENTO entre cadencias
 * al liquidar comisiones: día ⊂ semana ⊂ mes ⊂ año comparten recaudo, y el candado
 * unique(cobrador, periodo_key) solo frena la MISMA clave, no las que se cruzan.
 * Pura y testeable. Devuelve null si la clave no es reconocible.
 */
export function rangoDePeriodoKey(key: string): { desde: string; hasta: string } | null {
  const [tipo, valor] = (key ?? "").split(":");
  if (!valor) return null;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (tipo === "dia") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
    return { desde: valor, hasta: valor };
  }
  if (tipo === "semana") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
    const fin = new Date(new Date(`${valor}T00:00:00Z`).getTime() + 6 * 86400000);
    return { desde: valor, hasta: fmt(fin) }; // semana = 7 días desde el inicio
  }
  if (tipo === "mes") {
    if (!/^\d{4}-\d{2}$/.test(valor)) return null;
    const [y, m] = valor.split("-").map(Number);
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate(); // último día del mes m (1-indexado)
    return { desde: `${valor}-01`, hasta: `${valor}-${String(ultimo).padStart(2, "0")}` };
  }
  if (tipo === "anio") {
    if (!/^\d{4}$/.test(valor)) return null;
    return { desde: `${valor}-01-01`, hasta: `${valor}-12-31` };
  }
  return null;
}

/** daterange de Postgres `[desde, finExclusivo)` para el constraint EXCLUDE (0083).
 *  desde/hasta son días UY INCLUSIVOS "YYYY-MM-DD"; el upper se hace EXCLUSIVO
 *  (+1 día en UTC, sin DST) para que dos días adyacentes NO se solapen pero
 *  día ⊂ mes SÍ — la MISMA semántica que rangosSeSolapan, pero atómica en la BD. */
export function rangoPgDePeriodo(desde: string, hasta: string): string {
  const finExcl = new Date(new Date(`${hasta}T00:00:00Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return `[${desde},${finExcl})`;
}

/** ¿Se solapan dos rangos de fechas [desde,hasta] (strings YYYY-MM-DD, comparables
 *  lexicográficamente)? Comparten al menos un día. */
export function rangosSeSolapan(
  a: { desde: string; hasta: string },
  b: { desde: string; hasta: string },
): boolean {
  return a.desde <= b.hasta && b.desde <= a.hasta;
}

export interface ResumenComisiones {
  periodo: Periodo;
  etiqueta: string;
  /** Rango del período (día UY "YYYY-MM-DD"), para mostrar "del X al Y". */
  desde: string;
  hasta: string;
  filas: FilaComision[];
  totalRecaudado: number;
  totalComision: number;
  /** Total de cobros del período (suma de cobros de todos los cobradores). */
  totalCobros: number;
  /** Clave canónica del período (para liquidar de forma idempotente). */
  periodoKey: string;
  /** Total ya liquidado en el período (candado 0049). */
  totalLiquidado: number;
  /** false si falta la columna comision_pct (migración 0014 sin correr). */
  disponible: boolean;
  /** true si el recaudado se atribuyó al DUEÑO DE LA RUTA (RPC 0069); false = aún
   *  por `registrado_por` (0069 sin correr). Un cobro de oficina cuenta la comisión
   *  del cobrador de la ruta solo cuando es true. */
  atribuidoPorRuta: boolean;
}

export async function getComisionesPeriodo(
  db: SupabaseClient,
  periodo: Periodo,
  hoy: Date = new Date(),
): Promise<ResumenComisiones> {
  const resumen = await getResumenPeriodo(db, periodo, hoy);
  // Recaudado para la comisión: por DUEÑO DE LA RUTA (0069) si la RPC está; si no,
  // cae a la atribución previa por `registrado_por` (conducta actual, sin romper).
  const porRuta = await recaudoPorRuta(db, resumen.desde, resumen.hasta);
  const atribuidoPorRuta = porRuta !== null;
  const recaudadoDe: Map<string, { recaudado: number; cobros: number }> =
    porRuta ??
    new Map(resumen.porCobrador.map((c) => [c.cobradorId, { recaudado: c.recaudado, cobros: c.cobros }]));

  // Cobradores activos + su tasa (degrada si no existe la columna).
  let cobs: { id: string; nombre: string; comision_pct: number }[] = [];
  let disponible = true;
  try {
    const { data, error } = await db
      .from("usuarios")
      .select("id, nombre, comision_pct")
      .eq("rol", "cobrador")
      .eq("activo", true)
      .order("nombre");
    if (error) throw error;
    cobs = (data ?? []).map((u) => ({
      id: u.id as string,
      nombre: u.nombre as string,
      comision_pct: Number(u.comision_pct ?? 0),
    }));
  } catch (e) {
    if (!columnaFaltante(e)) throw e;
    disponible = false;
    const { data } = await db
      .from("usuarios")
      .select("id, nombre")
      .eq("rol", "cobrador")
      .eq("activo", true)
      .order("nombre");
    cobs = (data ?? []).map((u) => ({ id: u.id as string, nombre: u.nombre as string, comision_pct: 0 }));
  }

  // Liquidaciones ya hechas de ESTE período (candado idempotente 0049).
  const periodoKey = periodoKeyDe(periodo, resumen.desde);
  const liqMap = new Map<string, { monto: number; fecha: string }>();
  try {
    const { data, error } = await db
      .from("comisiones_liquidadas")
      .select("cobrador_id, monto, liquidado_en")
      .eq("periodo_key", periodoKey);
    if (error) throw error;
    for (const r of data ?? [])
      liqMap.set(r.cobrador_id as string, { monto: Number(r.monto), fecha: r.liquidado_en as string });
  } catch {
    /* sin 0049: sin candado (se comporta como antes, sin marca de liquidado) */
  }

  const filas: FilaComision[] = cobs
    .map((u) => {
      const r = recaudadoDe.get(u.id);
      const recaudado = r?.recaudado ?? 0;
      const cobros = r?.cobros ?? 0;
      return {
        cobradorId: u.id,
        nombre: u.nombre,
        recaudado,
        cobros,
        pct: u.comision_pct,
        comision: calcularComision(recaudado, u.comision_pct),
        liquidado: liqMap.get(u.id) ?? null,
      };
    })
    .sort((a, b) => b.comision - a.comision || b.recaudado - a.recaudado);

  return {
    periodo,
    etiqueta: resumen.etiqueta,
    desde: resumen.desde,
    hasta: resumen.hasta,
    filas,
    // Suma de las filas (no `resumen.recaudado`): las filas son solo cobradores, así
    // que este total puede ser < recaudo del dashboard (excluye pagos de créditos sin
    // cobrador y —en fallback— registrados por no-cobradores). Cuadra con lo visible.
    totalRecaudado: filas.reduce((s, f) => s + f.recaudado, 0),
    totalComision: filas.reduce((s, f) => s + f.comision, 0),
    totalCobros: filas.reduce((s, f) => s + f.cobros, 0),
    periodoKey,
    totalLiquidado: [...liqMap.values()].reduce((s, l) => s + l.monto, 0),
    disponible,
    atribuidoPorRuta,
  };
}

/** Fija la comisión (%) de un cobrador. */
export async function setComisionPctDb(
  db: SupabaseClient,
  cobradorId: string,
  pct: number,
): Promise<void> {
  const { error } = await db.from("usuarios").update({ comision_pct: pct }).eq("id", cobradorId);
  if (error) throw error;
}
