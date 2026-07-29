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
import { getSolicitudesGastoCobrador } from "./solicitudesGasto";
import { getAperturaDia } from "./aperturas";
import { tablaFaltante, columnaFaltante } from "./errores";
import { traerTodo } from "./paginado";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { Alcance } from "./alcance";

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
  /** Base de arranque congelada al cerrar (0105). 0 si no tenía / falta migración. */
  base: number;
  /** Recaudo EN VIVO del cobrador hoy (no el congelado al cerrar). Si es MAYOR que
   *  `recaudado`, cobró DESPUÉS de rendir → esa plata no entró a esta rendición. */
  recaudadoVivo?: number;
}

export interface EstadoJornada {
  /** Recaudado hoy por el cobrador (suma de sus pagos, autoritativo). */
  recaudado: number;
  cobrosCantidad: number;
  /** Gastos de ruta APROBADOS que se SOLICITARON hoy (para prellenar la rendición).
   *  Se bucketea por fecha de SOLICITUD (no de aprobación): un gasto aprobado tarde
   *  pertenece al día en que se incurrió, no a hoy → no se re-prefija ni se descuenta
   *  dos veces en el cierre de otro día. */
  gastosHoy: number;
  /** Tope anti-fuga para el cierre: gastos RESPALDADOS por solicitudes de hoy
   *  (aprobados + pendientes). El cobrador no puede descontar más que esto del
   *  "esperado" (si no, declararía gastos fantasma y la rendición marcaría "cuadra"). */
  gastosRespaldadosHoy: number;
  /** La rendición de hoy si ya cerró; null si todavía no. */
  yaRendida: RendicionDia | null;
  /** Base de arranque que el supervisor le dio al cobrador HOY (0105). Debe
   *  entregarla junto con lo cobrado. 0 si no tiene / falta migración. */
  base: number;
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
    // Defensivo: si 0105 aún no corrió, la columna viene undefined → 0.
    base: r.base == null ? 0 : Number(r.base),
  };
}

/** Recaudado hoy por un cobrador (por `registrado_por`, lo que tiene en mano).
 *  Se lee con el cliente ADMIN (esquiva la RLS por-fila sobre `pagos`) con el scope
 *  EXPLÍCITO por `registrado_por`: así el cobrador cuenta SUS propios cobros aunque
 *  el cliente haya sido REASIGNADO después (la policy pagos_select exige asignación
 *  activa → bajo su sesión no vería ese pago y su cierre entregaría de menos,
 *  descuadrando contra el panel del supervisor, que ya lee por admin igual). */
async function recaudadoHoyDe(
  cobradorId: string,
  desdeIso: string,
): Promise<{ recaudado: number; cobros: number }> {
  const admin = createSupabaseAdmin();
  const data = await traerTodo<{ monto: number }>((d, h) =>
    admin
      .from("pagos")
      .select("monto")
      .eq("anulado", false)
      .eq("registrado_por", cobradorId)
      .gte("registrado_en", desdeIso)
      .order("id", { ascending: true })
      .range(d, h),
  );
  const recaudado = data.reduce((s, r) => s + Number(r.monto), 0);
  return { recaudado, cobros: data.length };
}

/** Estado de la jornada del cobrador logueado (para la pantalla de cierre). */
export async function getEstadoJornada(
  db: SupabaseClient,
  cobradorId: string,
  hoy: Date = new Date(),
): Promise<EstadoJornada> {
  const { recaudado, cobros } = await recaudadoHoyDe(cobradorId, inicioDiaUYIso(hoy));
  // Gastos del día por FECHA DE SOLICITUD (solicitado_en), no de aprobación: un gasto
  // aprobado tarde ya no se re-prefija ni se descuenta dos veces en el cierre de otro
  // día. `aprobadoTotal` prellena; `aprobado + pendiente` acota lo declarable (cierre).
  const sol = await getSolicitudesGastoCobrador(db, cobradorId, hoy);
  const gastosHoy = sol.aprobadoTotal;
  const gastosPendientesHoy = sol.items
    .filter((s) => s.estado === "pendiente")
    .reduce((acc, s) => acc + s.monto, 0);
  // Base de arranque del cobrador HOY (0105). La debe entregar junto con lo cobrado.
  const base = await getAperturaDia(db, cobradorId, hoy);

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

  return {
    recaudado,
    cobrosCantidad: cobros,
    gastosHoy,
    gastosRespaldadosHoy: gastosHoy + gastosPendientesHoy,
    yaRendida,
    base,
    disponible,
  };
}

export interface NuevaRendicion {
  cobradorId: string;
  recaudado: number;
  cobrosCantidad: number;
  gastos: number;
  entregado: number;
  diferencia: number;
  /** Base de arranque congelada en la rendición (0105). */
  base: number;
  notas: string | null;
  registradoPor: string;
}

/**
 * Inserta la rendición. La `fecha` la pone la BD (día de Uruguay). El único
 * índice (cobrador_id, fecha) impide dos rendiciones el mismo día.
 *
 * ⚠️ MONEY-CRITICAL: el INSERT va con SERVICE_ROLE (admin), NO con la sesión del
 * cobrador. Los campos de dinero (recaudado/gastos/entregado/diferencia/base) los
 * computa el server-side de `cerrarJornada` (recaudado autoritativo de `pagos`,
 * gastos capados a lo respaldado). Si el cobrador pudiera INSERTAR su rendición
 * por PostgREST crudo (bajo su sesión), forjaría esos montos —recaudado honesto +
 * gastos fantasma → "cuadra ✓"— y enmascararía el faltante completo sin rastro.
 * Por eso la policy `rend_insert` se cierra a `with check (false)` (migración 0108)
 * y la única vía de escritura es esta función, con los montos ya validados.
 */
export async function crearRendicionDb(r: NuevaRendicion): Promise<void> {
  const admin = createSupabaseAdmin();
  const fila: Record<string, unknown> = {
    cobrador_id: r.cobradorId,
    recaudado: r.recaudado,
    cobros_cantidad: r.cobrosCantidad,
    gastos: r.gastos,
    entregado: r.entregado,
    diferencia: r.diferencia,
    base: r.base,
    notas: r.notas,
    registrado_por: r.registradoPor,
  };
  let { error } = await admin.from("rendiciones").insert(fila);
  // 0105 sin correr → insertar sin `base` (conducta previa; la diferencia igual
  // ya se calculó con base=0, así que no cambia el resultado).
  if (error && columnaFaltante(error)) {
    delete fila.base;
    ({ error } = await admin.from("rendiciones").insert(fila));
  }
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

/**
 * Vista del gestor: rendiciones de hoy + quién falta rendir. Corre como gestor.
 * `alcance` opcional: si viene y NO es global (supervisor con zona), acota TODO
 * a sus cobradores — si no, le mostraríamos faltantes/sin-rendir de otras zonas
 * (acusaría mal + fuga). Sin `alcance` = comportamiento global de siempre.
 */
export async function getRendicionesDia(
  db: SupabaseClient,
  hoy: Date = new Date(),
  alcance?: Alcance,
): Promise<ResumenRendiciones> {
  const desde = inicioDiaUYIso(hoy);
  // Cobradores del alcance (few → `.in` directo es seguro). null = sin recorte.
  const soloCobradores = alcance && !alcance.global ? alcance.cobradorIds : null;

  // Rendiciones de hoy (degrada si falta 0013).
  let rows: Record<string, unknown>[] = [];
  let disponible = true;
  try {
    let q = db.from("rendiciones").select("*").eq("fecha", toIso(hoyUY(hoy)));
    if (soloCobradores) q = q.in("cobrador_id", soloCobradores);
    const { data, error } = await q;
    if (error) throw error;
    rows = data ?? [];
  } catch (e) {
    if (tablaFaltante(e)) disponible = false;
    else throw e;
  }

  // Recaudado por cobrador hoy (para mostrar a los que faltan rendir). Se PAGINA
  // (con orden estable por id): un día grande puede superar las 1000 filas de
  // PostgREST y truncar los montos en silencio (esto alimenta alertas de dinero).
  // Se lee con el cliente ADMIN para esquivar el RLS por-fila sobre `pagos` (lento
  // a escala); el scope va EXPLÍCITO por `registrado_por` (soloCobradores).
  const adminDb = createSupabaseAdmin();
  const pagos = await traerTodo<{ monto: number; registrado_por: string | null }>((d, h) => {
    let q = adminDb
      .from("pagos")
      .select("monto, registrado_por")
      .eq("anulado", false)
      .gte("registrado_en", desde);
    if (soloCobradores) q = q.in("registrado_por", soloCobradores);
    return q.order("id", { ascending: true }).range(d, h);
  });
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
  const esCobrador = new Set<string>();
  if (ids.size > 0) {
    const { data } = await db.from("usuarios").select("id, nombre, rol").in("id", [...ids]);
    for (const u of data ?? []) {
      nombre.set(u.id as string, u.nombre as string);
      if (u.rol === "cobrador") esCobrador.add(u.id as string);
    }
  }

  const rendidas = rows
    .map((r) => {
      const base = mapRendicion(r);
      // Recaudo VIVO (no el congelado): si cobró más DESPUÉS de rendir, se ve.
      const vivo = recaudadoPorCob.get(base.cobradorId)?.recaudado ?? base.recaudado;
      return { ...base, cobradorNombre: nombre.get(base.cobradorId) ?? "Cobrador", recaudadoVivo: vivo };
    })
    .sort((a, b) => a.diferencia - b.diferencia); // faltantes primero
  const rendidos = new Set(rendidas.map((r) => r.cobradorId));

  // Solo COBRADORES quedan como "sin rendir": un gestor (admin/supervisor) que
  // cobra en la oficina ya deja esa plata en la caja central, no la rinde en ruta
  // → contarlo lo mostraba como faltante-fantasma e inflaba "por rendir".
  const pendientes = [...recaudadoPorCob.entries()]
    .filter(([id]) => !rendidos.has(id) && esCobrador.has(id))
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
