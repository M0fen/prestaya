// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RENDICIÓN de jornada (tabla `rendiciones`, 0013).
//  El "recaudado" es AUTORITATIVO del servidor: suma de `pagos` que el cobrador
//  registró hoy (inmutable). El cobrador solo declara gastos + entregado.
//  Degrada si 0013 aún no existe (disponible=false): la UI avisa, no rompe.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { inicioDiaUYIso, hoyUY, sumarDiasYmd, diaUYInicioIso, fechaISOUY } from "@/lib/fecha";
import { toIso } from "@/lib/format";
import type { EstadoRendicion } from "@/lib/rendicion";
import { getSolicitudesGastoCobrador } from "./solicitudesGasto";
import { getAperturaDia, getBaseDelDia } from "./aperturas";
import { colocadoPorCobrador, colocadoEnDias, claveColocado } from "./colocado";
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
  /** Capital que colocó en la calle ese día. DERIVADO de `prestamos` (la tabla
   *  `rendiciones` no lo guarda): no vuelve al supervisor, así que baja el esperado. */
  colocado?: number;
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
  /** Capital que ENTREGÓ hoy al renovar/vender en la calle: sale de su bolsillo y
   *  por eso baja lo que tiene que rendir. */
  colocado: number;
  creditosColocados: number;
  /** Base de arranque de HOY (0105): cargada por el supervisor o ARRASTRADA de
   *  la caja final de su última jornada rendida. 0 si no tiene / falta migración. */
  base: number;
  /** De dónde salió la base — para que el cobrador lo VEA ("= tu caja final de
   *  ayer"), regla de Carlos 16-08. `desdeFecha` solo en arrastre. */
  baseOrigen: "cargada" | "arrastre" | "sin_base";
  baseDesdeFecha?: string;
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
    // 0136. Si la migración no corrió viene undefined; el llamador lo completa
    // DERIVÁNDOLO de `prestamos` (lib/data/colocado.ts), así que el número en
    // pantalla es correcto igual — solo se pierde el congelado.
    colocado: r.colocado == null ? undefined : Number(r.colocado),
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
      // Custodia = plata EN MANO: solo pagos nativos (origen NULL). Los pagos
      // importados de Disapp y los ajustes de reconciliación llevan el
      // registrado_por del cobrador real pero ese efectivo rinde en el mundo
      // viejo — sin este filtro el "esperado" del cierre le exigía al cobrador
      // plata que nunca tocó (usar .is: neq/not.in EXCLUYEN los NULL).
      .is("origen", null)
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
  // Base de arranque del cobrador HOY (0105): cargada o arrastrada de su última
  // caja final (con el origen, para decirlo en pantalla).
  const baseInfo = await getBaseDelDia(db, cobradorId, hoy);
  const base = baseInfo.base;
  // Capital que colocó HOY en la calle (renovaciones + ventas): ya no lo tiene.
  const { colocado, creditos: creditosColocados } = await colocadoPorCobrador(
    cobradorId,
    inicioDiaUYIso(hoy),
  );

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
    baseOrigen: baseInfo.origen,
    baseDesdeFecha: baseInfo.desdeFecha,
    colocado,
    creditosColocados,
    disponible,
  };
}

/**
 * ¿AYER quedó recaudo SIN rendir? Devuelve el monto si el cobrador registró pagos
 * ayer y NO existe su rendición de ese día (la plata sigue en su bolsillo sin sello
 * de entrega); null si rindió o no cobró. Alimenta el banner del cobrador — el
 * espejo humano de la invariante INV8 del cron (que alerta al admin): acá se le
 * recuerda al PROPIO cobrador que entregue, antes de que sea un incidente.
 * Degrada a null si falta 0013 (sin tabla no hay flujo de rendición).
 */
export async function getDeudaRendicionAyer(
  db: SupabaseClient,
  cobradorId: string,
  hoy: Date = new Date(),
): Promise<{ fecha: string; monto: number; cobros: number } | null> {
  const fechaHoy = toIso(hoyUY(hoy));
  const ayer = sumarDiasYmd(fechaHoy, -1);
  try {
    const { data: rend, error } = await db
      .from("rendiciones")
      .select("id")
      .eq("cobrador_id", cobradorId)
      .eq("fecha", ayer)
      .maybeSingle();
    if (error) throw error;
    if (rend) return null; // ya rindió ayer → sin deuda
  } catch (e) {
    if (tablaFaltante(e)) return null;
    throw e;
  }
  // Pagos vigentes de AYER [inicio ayer, inicio hoy) — admin client (mismo motivo
  // que recaudadoHoyDe: el RLS por-fila no siempre deja contar pagos reasignados).
  const admin = createSupabaseAdmin();
  const pagos = await traerTodo<{ monto: number }>((d, h) =>
    admin
      .from("pagos")
      .select("monto")
      .eq("anulado", false)
      // Solo pagos nativos: sin esto, el día 1 del piloto el banner exigía
      // rendir los top-ups del empalme ($644.806 fechados 08-04 que ningún
      // cobrador tuvo en la mano) — deuda falsa apenas abre la app.
      .is("origen", null)
      .eq("registrado_por", cobradorId)
      .gte("registrado_en", diaUYInicioIso(ayer))
      .lt("registrado_en", diaUYInicioIso(fechaHoy))
      .order("id", { ascending: true })
      .range(d, h),
  );
  const cobrado = Math.round(pagos.reduce((s, r) => s + Number(r.monto), 0));
  // ⚠️ El capital que colocó AYER en la calle NO lo tiene: el banner le pedía
  // entregar el recaudo BRUTO ("registraste $49.320, entregale ese efectivo") a
  // alguien que en el bolsillo tenía $9.320 porque prestó $40.000.
  const colocadoAyer =
    (await colocadoEnDias([{ cobradorId, ymd: ayer }])).get(claveColocado(cobradorId, ayer)) ?? 0;
  const monto = Math.max(0, cobrado - colocadoAyer);
  return monto > 0 ? { fecha: ayer, monto, cobros: pagos.length } : null;
}

/** Una jornada que quedó con plata y SIN acta de entrega. */
export interface JornadaAbierta {
  cobradorId: string;
  cobradorNombre: string;
  /** Día UY "YYYY-MM-DD". */
  fecha: string;
  /** Lo que registró ese día (custodia, solo nativos). */
  recaudado: number;
  cobros: number;
  /** Base que le habían entregado ese día. */
  base: number;
  /** Capital que puso en la calle ese día: no vuelve. */
  colocado: number;
  /** Gastos aprobados de ese día. */
  gastos: number;
  /** Lo que tendría que haber entregado: base + recaudado − gastos − colocado. */
  esperado: number;
  /** Días que pasaron: 1 = ayer. */
  antiguedad: number;
}

/**
 * JORNADAS SIN CERRAR de los últimos días, con la cuenta ya hecha.
 *
 * ⚠️ Es el agujero más caro del piloto. La app solo sabe cerrar el día de HOY: si al
 * cobrador se le pasó la noche, esa jornada es incerrable PARA SIEMPRE y el
 * supervisor no tiene dónde firmar "recibí el efectivo". Medido el 10-08: 40
 * jornadas abiertas de 19 cobradores por $2.702.391, la más vieja del 10 de julio.
 * Y el aviso del cobrador mira solo AYER, así que a partir del segundo día ni él ve
 * su propia deuda.
 *
 * La plata no está perdida —el libro de pagos la tiene toda— lo que falta es el
 * PAPEL: sin acta, ni el cobrador puede probar que entregó ni la oficina que recibió.
 *
 * Se lee con ADMIN y scope explícito por cobrador, igual que `recaudadoHoyDe`: la
 * RLS por-fila no siempre deja contar los pagos de un crédito reasignado.
 */
export async function getJornadasSinRendir(
  db: SupabaseClient,
  cobradorIds: string[] | null,
  hoy: Date = new Date(),
  dias = 30,
): Promise<JornadaAbierta[]> {
  try {
    if (cobradorIds && cobradorIds.length === 0) return [];
    const admin = createSupabaseAdmin();
    const fechaHoy = toIso(hoyUY(hoy));
    const desdeYmd = sumarDiasYmd(fechaHoy, -dias);

    // 1. Pagos NATIVOS del período, agrupados por (cobrador, día UY). El día se
    //    deriva de `registrado_en` con el corte de las 03:00 UTC, igual que todo lo
    //    demás: un cobro de las 23:50 pertenece a ese día, no al siguiente.
    const pagos = await traerTodo<{ registrado_por: string; registrado_en: string; monto: number }>(
      (d, h) => {
        // El builder se arma FRESCO por página (convención de alcance.ts): reusar
        // uno mutable acumula params entre .range() sucesivos.
        let q = admin
          .from("pagos")
          .select("registrado_por, registrado_en, monto")
          .eq("anulado", false)
          .is("origen", null)
          .gte("registrado_en", diaUYInicioIso(desdeYmd))
          .lt("registrado_en", diaUYInicioIso(fechaHoy)); // HOY no: tiene su propio cierre
        if (cobradorIds) q = q.in("registrado_por", cobradorIds);
        return q.order("id", { ascending: true }).range(d, h);
      },
    );

    const clave = (c: string, f: string) => `${c}|${f}`;
    const acc = new Map<string, { cobradorId: string; fecha: string; recaudado: number; cobros: number }>();
    for (const p of pagos) {
      const cid = p.registrado_por;
      if (!cid) continue;
      const f = fechaISOUY(new Date(p.registrado_en));
      const k = clave(cid, f);
      const a = acc.get(k) ?? { cobradorId: cid, fecha: f, recaudado: 0, cobros: 0 };
      a.recaudado += Math.round(Number(p.monto) || 0);
      a.cobros += 1;
      acc.set(k, a);
    }

    // 1b. LAS BASES TAMBIÉN ABREN UNA JORNADA. Arrancar solo desde los pagos dejaba
    // sin botón justo el peor caso: el que RECIBIÓ base y no registró NI UN cobro
    // ese día (Daniela Millán $73.635 y Alejandro Cardona $31.885 del 06-08 —
    // $105.520 en alerta perpetua sin ninguna salida en la app). Una base entregada
    // es plata en la mano de alguien: su día queda abierto hasta que se selle,
    // haya cobrado o no. ⚠️ Columna `base` (no `monto` — el error que ya cegó dos
    // vigilantes) y PAGINADO: 52 cobradores × 30 días de bases superan el corte
    // mudo de 1000 filas de PostgREST.
    const aps = await traerTodo<{ cobrador_id: string; fecha: string; base: number }>((d, h) => {
      let q = admin
        .from("aperturas_caja")
        .select("cobrador_id, fecha, base")
        .gte("fecha", desdeYmd)
        .lt("fecha", fechaHoy); // hoy tiene su propio cierre
      if (cobradorIds) q = q.in("cobrador_id", cobradorIds);
      return q.order("id", { ascending: true }).range(d, h);
    });
    const baseDe = new Map(
      aps.map((a) => [clave(a.cobrador_id, String(a.fecha)), Math.round(Number(a.base) || 0)]),
    );
    for (const a of aps) {
      const monto = Math.round(Number(a.base) || 0);
      if (monto <= 0) continue;
      const k = clave(a.cobrador_id, String(a.fecha));
      if (!acc.has(k)) acc.set(k, { cobradorId: a.cobrador_id, fecha: String(a.fecha), recaudado: 0, cobros: 0 });
    }
    if (acc.size === 0) return [];

    // 2. Las que YA tienen acta salen de la lista. Paginado por lo mismo de arriba:
    // 52 cobradores rindiendo a diario son ~1.560 filas en 30 días.
    const ids = [...new Set([...acc.values()].map((a) => a.cobradorId))];
    const rends = await traerTodo<{ cobrador_id: string; fecha: string }>((d, h) =>
      admin
        .from("rendiciones")
        .select("id, cobrador_id, fecha")
        .in("cobrador_id", ids)
        .gte("fecha", desdeYmd)
        .order("id", { ascending: true })
        .range(d, h),
    );
    const cerradas = new Set(rends.map((r) => clave(r.cobrador_id, String(r.fecha))));
    const abiertas = [...acc.values()].filter((a) => !cerradas.has(clave(a.cobradorId, a.fecha)));
    if (abiertas.length === 0) return [];

    // 3. Capital colocado, gastos y nombres (los dos primeros bajan el esperado).
    // ⚠️ SE MIRA EL ERROR de cada consulta (o pagina con traerTodo, que lanza solo):
    // acá se sella plata en un acta inmutable, y es preferible que la pantalla no
    // cargue a que cargue con un número de menos.
    const [colocado, gs, usuariosRes] = await Promise.all([
      colocadoEnDias(abiertas.map((a) => ({ cobradorId: a.cobradorId, ymd: a.fecha }))),
      traerTodo<{ cobrador_id: string; monto: number; solicitado_en: string }>((d, h) =>
        admin
          .from("solicitudes_gasto")
          .select("id, cobrador_id, monto, solicitado_en")
          .eq("estado", "aprobada")
          .in("cobrador_id", ids)
          .gte("solicitado_en", diaUYInicioIso(desdeYmd))
          .order("id", { ascending: true })
          .range(d, h),
      ),
      admin.from("usuarios").select("id, nombre").in("id", ids),
    ]);
    if (usuariosRes.error)
      throw Object.assign(new Error("getJornadasSinRendir: usuarios"), usuariosRes.error);
    const usrs = usuariosRes.data;
    const gastoDe = new Map<string, number>();
    for (const g of gs) {
      const k = clave(g.cobrador_id, fechaISOUY(new Date(g.solicitado_en)));
      gastoDe.set(k, (gastoDe.get(k) ?? 0) + Math.round(Number(g.monto) || 0));
    }
    const nombreDe = new Map((usrs ?? []).map((u) => [u.id as string, u.nombre as string]));
    const dia = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getTime();

    return abiertas
      .map((a) => {
        const k = clave(a.cobradorId, a.fecha);
        const base = baseDe.get(k) ?? 0;
        const col = colocado.get(claveColocado(a.cobradorId, a.fecha)) ?? 0;
        const gastos = gastoDe.get(k) ?? 0;
        return {
          cobradorId: a.cobradorId,
          cobradorNombre: nombreDe.get(a.cobradorId) ?? "Cobrador",
          fecha: a.fecha,
          recaudado: a.recaudado,
          cobros: a.cobros,
          base,
          colocado: col,
          gastos,
          esperado: Math.max(0, base + a.recaudado - gastos - col),
          antiguedad: Math.max(1, Math.round((dia(fechaHoy) - dia(a.fecha)) / 86_400_000)),
        };
      })
      // Lo más VIEJO arriba: es el orden de la urgencia, y es lo que se olvida.
      .sort((x, y) => y.antiguedad - x.antiguedad || y.esperado - x.esperado);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export interface NuevaRendicion {
  cobradorId: string;
  /** Día UY "YYYY-MM-DD" al que pertenece la jornada (capturado UNA vez en la
   *  action, el MISMO con el que se computó el recaudado). Antes lo ponía el
   *  default de la BD al momento del INSERT → una confirmación 23:59 que
   *  commiteaba 00:00 fechaba la rendición en el día siguiente (con la plata de
   *  ayer): ayer quedaba "sin rendir" y hoy bloqueado por el unique. */
  fecha: string;
  recaudado: number;
  cobrosCantidad: number;
  gastos: number;
  entregado: number;
  diferencia: number;
  /** Base de arranque congelada en la rendición (0105). */
  base: number;
  /** Capital que entregó en la calle ese día, congelado al cerrar (0136). Es lo
   *  que hace que la fila cuadre consigo misma: base + recaudado − gastos −
   *  colocado − entregado = −diferencia. */
  colocado: number;
  creditosColocados: number;
  notas: string | null;
  registradoPor: string;
}

/**
 * Inserta la rendición. La `fecha` viene EXPLÍCITA de la action (día UY capturado
 * al inicio, el mismo del recaudado) — no el default de la BD, que fechaba al
 * momento del INSERT y en la medianoche envenenaba dos días. El único índice
 * (cobrador_id, fecha) impide dos rendiciones el mismo día.
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
    fecha: r.fecha,
    recaudado: r.recaudado,
    cobros_cantidad: r.cobrosCantidad,
    gastos: r.gastos,
    entregado: r.entregado,
    diferencia: r.diferencia,
    base: r.base,
    // 0136: se CONGELA el capital colocado con el que se calculó la diferencia.
    // Sin esto la fila se contradice a sí misma (base + recaudado − gastos −
    // entregado ≠ diferencia) y el acta firmada se movía sola si el cobrador
    // renovaba a alguien después de rendir.
    colocado: r.colocado,
    creditos_colocados: r.creditosColocados,
    notas: r.notas,
    registrado_por: r.registradoPor,
  };
  let { error } = await admin.from("rendiciones").insert(fila);
  // 0136 sin correr → insertar sin las columnas del colocado. La app lo DERIVA
  // igual (lib/data/colocado.ts), así que el número en pantalla es el correcto;
  // solo se pierde el congelado.
  if (error && columnaFaltante(error)) {
    delete fila.colocado;
    delete fila.creditos_colocados;
    ({ error } = await admin.from("rendiciones").insert(fila));
  }
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
  /** Cobradores que recaudaron hoy pero AÚN no rindieron. `recaudado` es BRUTO;
   *  lo que TIENEN EN MANO es `recaudado − colocado`. */
  pendientes: {
    cobradorId: string;
    nombre: string;
    recaudado: number;
    cobros: number;
    colocado: number;
  }[];
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
      // Custodia del día = solo pagos nativos: de acá salen "pendientes de
      // rendir", el bloqueo del sello de zona y el cobro-post-cierre. Un asiento
      // importado/de reconciliación no es efectivo en la calle.
      .is("origen", null)
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

  // CAPITAL COLOCADO del día por cobrador. `rendiciones` no lo guarda: se DERIVA
  // de `prestamos`. Sin esto, el supervisor veía "entregó $58.053 · esperado
  // $98.053" en la misma fila y el total de la zona le pedía $40.000 que el
  // cobrador ya le había dado a los clientes.
  const ymd = toIso(hoyUY(hoy));
  const colocadoPorCob = await colocadoEnDias(
    rows.map((r) => ({ cobradorId: r.cobrador_id as string, ymd })),
  );

  const rendidas = rows
    .map((r) => {
      const base = mapRendicion(r);
      // Recaudo VIVO (no el congelado): si cobró más DESPUÉS de rendir, se ve.
      const vivo = recaudadoPorCob.get(base.cobradorId)?.recaudado ?? base.recaudado;
      return {
        ...base,
        cobradorNombre: nombre.get(base.cobradorId) ?? "Cobrador",
        recaudadoVivo: vivo,
        // El CONGELADO de la fila manda (es el que explica la `diferencia` firmada);
        // si 0136 no corrió, se cae al derivado.
        colocado: base.colocado ?? colocadoPorCob.get(claveColocado(base.cobradorId, ymd)) ?? 0,
      };
    })
    .sort((a, b) => a.diferencia - b.diferencia); // faltantes primero
  const rendidos = new Set(rendidas.map((r) => r.cobradorId));

  // Los que AÚN NO rindieron: lo que tienen en mano es recaudo − capital colocado.
  // El banner del cobrador y el "en la calle" del admin pedían el recaudo BRUTO.
  const colocadoPendientes = await colocadoEnDias(
    [...recaudadoPorCob.keys()]
      .filter((id) => !rendidos.has(id) && esCobrador.has(id))
      .map((id) => ({ cobradorId: id, ymd })),
  );

  // Solo COBRADORES quedan como "sin rendir": un gestor (admin/supervisor) que
  // cobra en la oficina ya deja esa plata en la caja central, no la rinde en ruta
  // → contarlo lo mostraba como faltante-fantasma e inflaba "por rendir".
  const pendientes = [...recaudadoPorCob.entries()]
    .filter(([id]) => !rendidos.has(id) && esCobrador.has(id))
    .map(([id, v]) => {
      const colocado = colocadoPendientes.get(claveColocado(id, ymd)) ?? 0;
      // `recaudado` queda BRUTO (es lo que cobró, un hecho); el capital colocado
      // viaja aparte para que cada pantalla reste y pueda MOSTRAR la resta. Lo que
      // el supervisor va a recibir es `recaudado − colocado`.
      return {
        cobradorId: id,
        nombre: nombre.get(id) ?? "Cobrador",
        recaudado: v.recaudado,
        cobros: v.cobros,
        colocado,
      };
    })
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
