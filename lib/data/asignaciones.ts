// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ASIGNACIONES (cobrador ↔ cliente).
//  Un cliente tiene UN cobrador activo (índice único). De ahí se DERIVA su
//  zona. Reasignar = bajar la activa y subir la nueva (respetando el índice).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CobradorDeCliente {
  cobradorId: string;
  cobradorNombre: string;
  zonaId: string | null;
}

/** Cobrador ACTIVO de un cliente (con su zona), o null si no tiene. */
export async function getCobradorDeCliente(
  db: SupabaseClient,
  clienteId: string,
): Promise<CobradorDeCliente | null> {
  // Desde 0038 un cliente puede tener VARIOS cobradores activos (créditos de
  // distintos cobradores). Devolvemos el más reciente (no usar maybeSingle: con
  // múltiples activos rompería). El detalle por crédito lo maneja cada superficie.
  const { data: filas, error } = await db
    .from("asignaciones")
    .select("cobrador_id, usuarios(nombre, zona_id)")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .order("asignado_en", { ascending: false })
    .limit(1);
  const data = filas && filas.length > 0 ? filas[0] : null;
  if (error || !data) return null;
  const d = data as {
    cobrador_id: string;
    usuarios?: { nombre?: string; zona_id?: string | null } | { nombre?: string; zona_id?: string | null }[];
  };
  const u = Array.isArray(d.usuarios) ? d.usuarios[0] : d.usuarios;
  return {
    cobradorId: d.cobrador_id,
    cobradorNombre: u?.nombre ?? "—",
    zonaId: u?.zona_id ?? null,
  };
}

/**
 * COMPENSACIÓN: baja una asignación activa cliente↔cobrador recién creada cuando la
 * operación que la motivó (p. ej. una venta de tienda) falló. Evita dejar al cliente
 * en la ruta de un cobrador sin crédito. NO toca prestamos.cobrador_id (no conocemos
 * el valor previo); revierte solo la RUTA. Idempotente. Best-effort en el llamador.
 */
export async function desactivarAsignacion(
  db: SupabaseClient,
  clienteId: string,
  cobradorId: string,
): Promise<void> {
  const { error } = await db
    .from("asignaciones")
    .update({ activo: false })
    .eq("cliente_id", clienteId)
    .eq("cobrador_id", cobradorId)
    .eq("activo", true);
  if (error) throw error;
}

/**
 * Reasigna un cliente a un nuevo cobrador: baja la asignación activa actual y
 * activa la del nuevo (respeta el índice "un cobrador activo por cliente").
 */
export async function reasignarCliente(
  db: SupabaseClient,
  clienteId: string,
  nuevoCobradorId: string,
  /** Mover SOLO este crédito (el resto del cliente no se toca). Es lo correcto
   *  cuando el cliente está compartido: 60 clientes tienen créditos vivos con
   *  cobradores DISTINTOS y mover "el cliente" entero le arrancaría al compañero
   *  un crédito que está cobrando. null = mover todo lo del cobrador de origen. */
  soloPrestamoId: string | null = null,
  /**
   * A QUIÉN se le está sacando el cliente. Solo hace falta cuando el cliente
   * tiene créditos vivos de VARIOS cobradores; con un solo dueño se deduce.
   *
   * ⚠️ El motor NO adivina. Antes movía TODOS los créditos activos del cliente
   * sin mirar de quién eran, y ahí está el bug de los $5,6M del 10-08 (hoy: 60
   * clientes, 187 créditos, $7.925.265): reasignar a Pedro un cliente compartido
   * le arrancaba a Alejandro los créditos que él colocó y viene cobrando, junto
   * con la comisión ya devengada, sin rastro y sin aviso.
   */
  cobradorOrigenId: string | null = null,
): Promise<void> {
  // ORDEN DELIBERADO: primero SE SUBE la nueva, después se bajan las viejas.
  //
  // Son dos requests distintas (no hay transacción). Al revés —bajar y después
  // subir— un corte en el medio (504 / cierre de la función serverless / red)
  // dejaba al cliente SIN NINGUNA asignación activa: desaparecía de la ruta de
  // todos mientras seguía debiendo, y nadie se enteraba porque ninguna pantalla
  // lista "créditos sin ruta". Es el "cliente fantasma", y ya pasó de verdad
  // (46 créditos activos / $634.666 huérfanos, reparados a mano en la auditoría
  // del 08-02). En este orden, el peor caso es que el cliente quede un instante
  // en DOS rutas: molesto, visible y sin plata perdida — desde 0038 la tabla
  // admite varios cobradores activos por cliente, así que no viola nada.
  // ── CAMINO ATÓMICO (0153) ────────────────────────────────────────────────
  // Las tres escrituras de abajo son tres requests distintas y PostgREST no tiene
  // transacción entre ellas: un corte en el medio deja la ruta movida y la
  // comisión apuntando al cobrador viejo, o un crédito invisible en las dos
  // rutas. La RPC hace lo mismo dentro de UNA transacción y con advisory lock por
  // cliente. Si 0153 todavía no corrió (42883/PGRST202) se cae al camino de tres
  // requests, que es la conducta previa — sin regresión.
  const rpc = await db.rpc("reasignar_cliente_seguro", {
    p_cliente_id: clienteId,
    p_nuevo_cobrador_id: nuevoCobradorId,
    p_solo_prestamo_id: soloPrestamoId,
    p_cobrador_origen_id: cobradorOrigenId,
  });
  if (!rpc.error) return;
  {
    const code = (rpc.error as { code?: string }).code;
    if (code === "P0417")
      throw new Error(
        "Este cliente tiene créditos vivos de varios cobradores: hay que decir a cuál se le reasigna (o mover un crédito puntual).",
      );
    if (code === "P0418")
      throw new Error(
        "La ruta se cambió pero no se pudo mover el dueño de los créditos activos (la comisión seguiría yendo al cobrador anterior).",
      );
    // Solo "la función no existe" cae al camino viejo; cualquier otro error es real.
    if (code !== "42883" && code !== "PGRST202") throw rpc.error;
  }

  // ── PASO 0: ¿a quién se le saca? Se decide ANTES de escribir nada. ────────
  // Los dueños de créditos VIVOS de este cliente. Todo el que no sea el origen
  // ni el destino es INTOCABLE: ni se le baja la asignación (perdería al cliente
  // de su ruta con plata suya en la calle) ni se le mueve el crédito (perdería
  // la comisión que ya se ganó cobrando).
  const { data: vivos, error: eVivos } = await db
    .from("prestamos")
    .select("id, cobrador_id")
    .eq("cliente_id", clienteId)
    .eq("estado", "activo");
  if (eVivos) throw eVivos;
  const duenosVivos = [
    ...new Set((vivos ?? []).map((p) => p.cobrador_id as string | null).filter(Boolean) as string[]),
  ];
  const ajenos = duenosVivos.filter((id) => id !== nuevoCobradorId);

  // Con un solo dueño no hay nada que adivinar: ese es el origen.
  const origen = cobradorOrigenId ?? (ajenos.length === 1 ? ajenos[0] : null);

  // ⚠️ AMBIGÜEDAD = SE FRENA, NO SE ADIVINA. Si el cliente tiene créditos vivos
  // de varios cobradores y nadie dijo a cuál se le saca, cualquier elección le
  // quita plata a alguien. Antes el motor elegía "todos" en silencio. Este freno
  // vive acá y no en la pantalla a propósito: `aprobarPedidoTienda` llama a este
  // motor directo, sin pasar por la guardia de la Server Action.
  if (!soloPrestamoId && !origen && ajenos.length > 1) {
    throw new Error(
      "Este cliente tiene créditos vivos de varios cobradores: hay que decir a cuál se le reasigna (o mover un crédito puntual).",
    );
  }

  const on = await db
    .from("asignaciones")
    .upsert(
      { cobrador_id: nuevoCobradorId, cliente_id: clienteId, activo: true },
      { onConflict: "cobrador_id,cliente_id" },
    );
  if (on.error) throw on.error;

  // 2) Bajar las OTRAS activas — pero NUNCA la de un cobrador que tiene un
  //    crédito VIVO con este cliente. Bajarla lo dejaba con plata en la calle y
  //    sin el cliente en su ruta: no lo veía, no lo cobraba, y no se enteraba.
  //    (Si se está moviendo UN crédito puntual, el dueño de ese crédito sí puede
  //    perder la asignación: justamente se la estamos sacando.)
  // ⚠️ Solo hay intocables cuando se mueve UN crédito puntual. Si se mueve el
  // CLIENTE ENTERO, el paso 3 le cambia el dueño a TODOS sus créditos activos, así
  // que ningún otro cobrador queda con plata viva y sus asignaciones sí deben
  // bajarse (si no, el cliente quedaría en dos rutas sin motivo).
  // ⚠️ LOS INTOCABLES RIGEN SIEMPRE, no solo al mover un crédito puntual.
  // Esta condición estaba dentro de un `if (soloPrestamoId)`, y como las dos
  // puertas llaman con `null`, en la práctica el set quedaba VACÍO y se bajaban
  // TODAS las asignaciones: el cliente desaparecía de la ruta del compañero
  // mientras sus créditos seguían vivos. Plata que nadie sale a cobrar y que
  // ninguna pantalla lista — el "cliente fantasma" que ya costó $634.666.
  //
  // Intocable = tiene un crédito VIVO con este cliente, no es el destino, y no
  // es a quien se le está sacando (si se mueve un crédito puntual, su dueño sí
  // pierde la asignación: justamente se la estamos sacando).
  const intocables = new Set<string>();
  for (const p of vivos ?? []) {
    const id = p.cobrador_id as string | null;
    if (!id || id === nuevoCobradorId) continue;
    if (soloPrestamoId ? p.id !== soloPrestamoId : id !== origen) intocables.add(id);
  }

  // Se listan las asignaciones activas y se baja SOLO las que corresponde: es más
  // explícito que un `not in` y se puede probar.
  const { data: activasRaw } = await db
    .from("asignaciones")
    .select("cobrador_id")
    .eq("cliente_id", clienteId)
    .eq("activo", true);
  const aBajar = [
    ...new Set(
      (activasRaw ?? [])
        .map((a) => a.cobrador_id as string)
        .filter((id) => !!id && id !== nuevoCobradorId && !intocables.has(id)),
    ),
  ];
  if (aBajar.length > 0) {
    const off = await db
      .from("asignaciones")
      .update({ activo: false })
      .eq("cliente_id", clienteId)
      .eq("activo", true)
      .in("cobrador_id", aBajar);
    if (off.error) throw off.error;
  }

  // 3) Sincronizar el DUEÑO de los créditos ACTIVOS del cliente. La ruta se arma
  // desde `asignaciones`, pero `prestamos.cobrador_id` es la fuente de verdad del
  // dueño de la ruta para comisiones (RPC app_comision_por_ruta) y auditorías. Sin
  // esto quedaba STALE: comisión y auditoría apuntaban al cobrador viejo. Solo los
  // ACTIVOS (los finalizados conservan su historia). Los pagos ya hechos guardan su
  // registrado_por, no se tocan.
  // ⚠️ Si se pidió mover UN crédito, se mueve ESE y nada más: cambiarle el dueño
  // a todos los créditos del cliente le transferiría al nuevo cobrador la comisión
  // de un crédito que sigue caminando el compañero.
  let updQ = db
    .from("prestamos")
    .update({ cobrador_id: nuevoCobradorId })
    .eq("cliente_id", clienteId)
    .eq("estado", "activo");
  if (soloPrestamoId) {
    updQ = updQ.eq("id", soloPrestamoId);
  } else if (origen) {
    // ⚠️ SOLO los créditos del cobrador al que se le saca el cliente. Sin este
    // filtro el UPDATE barría TODOS los créditos activos, incluidos los de un
    // compañero: como la comisión sale de `prestamos.cobrador_id` y se liquida
    // por período sobre los pagos, mover la columna RE-IMPUTA hacia atrás plata
    // que el compañero ya se ganó en la calle.
    updQ = updQ.eq("cobrador_id", origen);
  }
  const upd = await updQ.select("id");
  if (upd.error) throw upd.error;

  // Un UPDATE que no matchea filas bajo RLS NO es un error en PostgREST: vuelve
  // vacío y en silencio. Si el cliente tiene créditos activos y ninguno se movió,
  // la ruta cambió pero la COMISIÓN sigue yendo al cobrador viejo → hay que verlo,
  // no tragárselo. (Cero filas con cero créditos activos es normal y no avisa.)
  if ((upd.data?.length ?? 0) === 0) {
    const { count } = await db
      .from("prestamos")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .eq("estado", "activo");
    if ((count ?? 0) > 0) {
      throw new Error(
        "La ruta se cambió pero no se pudo mover el dueño de los créditos activos (la comisión seguiría yendo al cobrador anterior).",
      );
    }
  }
}
