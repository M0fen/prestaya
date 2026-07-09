// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RENDICIÓN de jornada (tabla `rendiciones`, 0013).
//  El "recaudado" es AUTORITATIVO del servidor: suma de `pagos` que el cobrador
//  registró hoy (inmutable). El cobrador solo declara gastos + entregado.
//  Degrada si 0013 aún no existe (disponible=false): la UI avisa, no rompe.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { inicioDiaUYIso, hoyUY } from "@/lib/fecha";
import { toIso } from "@/lib/format";
import type { EstadoRendicion } from "@/lib/rendicion";
import { getGastosCobradorHoy } from "./gastos";
import { tablaFaltante } from "./errores";
import { traerTodo } from "./paginado";

export interface RendicionDia {
  id: string;
  cobradorId: string;
  cobradorNombre?: string;
  recaudado: number;
  cobrosCantidad: number;
  gastos: number;
  entregado: number;
  diferencia: number;
  estado: EstadoRendicion;
  notas: string | null;
  creadoEn: string;
}

export interface EstadoJornada {
  /** Recaudado hoy por el cobrador (suma de sus pagos, autoritativo). */
  recaudado: number;
  cobrosCantidad: number;
  /** Gastos de ruta cargados hoy (para prellenar la rendición). */
  gastosHoy: number;
  /** La rendición de hoy si ya cerró; null si todavía no. */
  yaRendida: RendicionDia | null;
  /** false si falta la migración 0013 (la tabla no existe). */
  disponible: boolean;
}

function mapRendicion(r: Record<string, unknown>): RendicionDia {
  const diferencia = Number(r.diferencia);
  return {
    id: r.id as string,
    cobradorId: r.cobrador_id as string,
    recaudado: Number(r.recaudado),
    cobrosCantidad: Number(r.cobros_cantidad),
    gastos: Number(r.gastos),
    entregado: Number(r.entregado),
    diferencia,
    estado: diferencia === 0 ? "cuadra" : diferencia < 0 ? "faltante" : "sobrante",
    notas: (r.notas as string | null) ?? null,
    creadoEn: r.creado_en as string,
  };
}

/** Recaudado hoy por un cobrador (por `registrado_por`, lo que tiene en mano). */
async function recaudadoHoyDe(
  db: SupabaseClient,
  cobradorId: string,
  desdeIso: string,
): Promise<{ recaudado: number; cobros: number }> {
  const { data, error } = await db
    .from("pagos")
    .select("monto")
    .eq("anulado", false)
    .eq("registrado_por", cobradorId)
    .gte("registrado_en", desdeIso);
  if (error) throw error;
  const recaudado = (data ?? []).reduce((s, r) => s + Number(r.monto), 0);
  return { recaudado, cobros: (data ?? []).length };
}

/** Estado de la jornada del cobrador logueado (para la pantalla de cierre). */
export async function getEstadoJornada(
  db: SupabaseClient,
  cobradorId: string,
  hoy: Date = new Date(),
): Promise<EstadoJornada> {
  const { recaudado, cobros } = await recaudadoHoyDe(db, cobradorId, inicioDiaUYIso(hoy));
  const gastos = await getGastosCobradorHoy(db, cobradorId, hoy);

  let yaRendida: RendicionDia | null = null;
  let disponible = true;
  try {
    const { data, error } = await db
      .from("rendiciones")
      .select("*")
      .eq("cobrador_id", cobradorId)
      .eq("fecha", toIso(hoyUY(hoy)))
      .maybeSingle();
    if (error) throw error;
    if (data) yaRendida = mapRendicion(data);
  } catch (e) {
    if (tablaFaltante(e)) disponible = false;
    else throw e;
  }

  return { recaudado, cobrosCantidad: cobros, gastosHoy: gastos.total, yaRendida, disponible };
}

export interface NuevaRendicion {
  cobradorId: string;
  recaudado: number;
  cobrosCantidad: number;
  gastos: number;
  entregado: number;
  diferencia: number;
  notas: string | null;
  registradoPor: string;
}

/** Inserta la rendición. La `fecha` la pone la BD (día de Uruguay). El único
 *  índice (cobrador_id, fecha) impide dos rendiciones el mismo día. */
export async function crearRendicionDb(db: SupabaseClient, r: NuevaRendicion): Promise<void> {
  const { error } = await db.from("rendiciones").insert({
    cobrador_id: r.cobradorId,
    recaudado: r.recaudado,
    cobros_cantidad: r.cobrosCantidad,
    gastos: r.gastos,
    entregado: r.entregado,
    diferencia: r.diferencia,
    notas: r.notas,
    registrado_por: r.registradoPor,
  });
  if (error) throw error;
}

export interface ResumenRendiciones {
  rendidas: RendicionDia[];
  /** Cobradores que recaudaron hoy pero AÚN no rindieron. */
  pendientes: { cobradorId: string; nombre: string; recaudado: number; cobros: number }[];
  totalEntregado: number;
  totalFaltante: number;
  totalSobrante: number;
  disponible: boolean;
}

/** Vista del gestor: rendiciones de hoy + quién falta rendir. Corre como gestor. */
export async function getRendicionesDia(
  db: SupabaseClient,
  hoy: Date = new Date(),
): Promise<ResumenRendiciones> {
  const desde = inicioDiaUYIso(hoy);

  // Rendiciones de hoy (degrada si falta 0013).
  let rows: Record<string, unknown>[] = [];
  let disponible = true;
  try {
    const { data, error } = await db.from("rendiciones").select("*").eq("fecha", toIso(hoyUY(hoy)));
    if (error) throw error;
    rows = data ?? [];
  } catch (e) {
    if (tablaFaltante(e)) disponible = false;
    else throw e;
  }

  // Recaudado por cobrador hoy (para mostrar a los que faltan rendir). Se PAGINA
  // (con orden estable por id): un día grande puede superar las 1000 filas de
  // PostgREST y truncar los montos en silencio (esto alimenta alertas de dinero).
  const pagos = await traerTodo<{ monto: number; registrado_por: string | null }>((d, h) =>
    db
      .from("pagos")
      .select("monto, registrado_por")
      .eq("anulado", false)
      .gte("registrado_en", desde)
      .order("id", { ascending: true })
      .range(d, h),
  );
  const recaudadoPorCob = new Map<string, { recaudado: number; cobros: number }>();
  for (const p of pagos ?? []) {
    const id = p.registrado_por as string | null;
    if (!id) continue;
    const a = recaudadoPorCob.get(id) ?? { recaudado: 0, cobros: 0 };
    a.recaudado += Number(p.monto);
    a.cobros += 1;
    recaudadoPorCob.set(id, a);
  }

  // Nombres de cobradores.
  const ids = new Set<string>([...recaudadoPorCob.keys(), ...rows.map((r) => r.cobrador_id as string)]);
  const nombre = new Map<string, string>();
  if (ids.size > 0) {
    const { data } = await db.from("usuarios").select("id, nombre").in("id", [...ids]);
    for (const u of data ?? []) nombre.set(u.id as string, u.nombre as string);
  }

  const rendidas = rows
    .map((r) => ({ ...mapRendicion(r), cobradorNombre: nombre.get(r.cobrador_id as string) ?? "Cobrador" }))
    .sort((a, b) => a.diferencia - b.diferencia); // faltantes primero
  const rendidos = new Set(rendidas.map((r) => r.cobradorId));

  const pendientes = [...recaudadoPorCob.entries()]
    .filter(([id]) => !rendidos.has(id))
    .map(([id, v]) => ({ cobradorId: id, nombre: nombre.get(id) ?? "Cobrador", recaudado: v.recaudado, cobros: v.cobros }))
    .sort((a, b) => b.recaudado - a.recaudado);

  return {
    rendidas,
    pendientes,
    totalEntregado: rendidas.reduce((s, r) => s + r.entregado, 0),
    totalFaltante: rendidas.filter((r) => r.diferencia < 0).reduce((s, r) => s - r.diferencia, 0),
    totalSobrante: rendidas.filter((r) => r.diferencia > 0).reduce((s, r) => s + r.diferencia, 0),
    disponible,
  };
}
