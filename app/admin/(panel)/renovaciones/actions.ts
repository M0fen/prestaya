"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — ALTA REAL del crédito de renovación (solo gestor).
//  Escribe dinero: finaliza el crédito saldado y crea el nuevo, arrastrando la
//  tasa (la cuota la calcula el servidor, ver lib/data/renovaciones.ts).
//  Corre con la sesión del gestor → el RLS exige app_es_gestor().
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual, esGestor, esAdmin } from "@/lib/auth";
import { crearRenovacion, type ResultadoAlta } from "@/lib/data/renovaciones";
import {
  getSolicitudPorId,
  resolverSolicitudDb,
  cerrarSolicitudPendienteDeAnterior,
  marcarAprobadaPorCreditoExistente,
} from "@/lib/data/solicitudesRenovacion";
import { getClientePorId } from "@/lib/data/clientes";
import { getPrestamoPorId } from "@/lib/data/prestamos";
import { crearCreditoNuevoDb } from "@/lib/data/creditoNuevo";
import { calcularCuotaCreditoNuevo, interesDeBase, INTERES_DEFECTO_PCT } from "@/lib/creditoNuevo";
import { evaluarRenovacion, explicaTecho, techoRenovacion, techoVentaGestor, RENOVACION_CAP_TOTAL } from "@/lib/renovacion";
import { avisarUsuario } from "@/lib/push/avisarGestores";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { reportarError } from "@/lib/observabilidad";
import { opIdDeterminista } from "@/lib/idempotencia";
import { proximoDiaCobro } from "@/lib/cartones";
import { hoyUY } from "@/lib/fecha";
import { toIso, UYU } from "@/lib/format";
import type { FrecuenciaPrestamo } from "@/types/db";

type ResultadoSimple = { ok: true } | { ok: false; error: string };

/**
 * Cierra (rechazada) una solicitud que quedó VIEJA — su crédito de referencia
 * fue cancelado o ya no está activo. Sin esto, la tarjeta devolvía un error sin
 * salida y el pedido inflaba la franja y el contador para siempre. Best-effort
 * y con el guard de 'pendiente' (no pisa una resolución ajena).
 */
async function cerrarComoVieja(
  db: Awaited<ReturnType<typeof createSupabaseServer>>,
  u: { id: string; nombre: string },
  solicitudId: string,
  motivo: string,
): Promise<void> {
  try {
    const resolvio = await resolverSolicitudDb(db, solicitudId, {
      estado: "rechazada",
      resueltoPor: u.id,
      motivoRechazo: motivo,
    });
    if (resolvio) {
      await registrarAuditoria(db, {
        actorId: u.id,
        actorNombre: u.nombre,
        accion: "Solicitud cerrada por quedar vieja",
        entidad: "solicitud",
        entidadId: solicitudId,
        detalle: motivo.slice(0, 120),
      });
    }
    revalidatePath("/admin/renovaciones");
    revalidatePath("/admin");
  } catch (e) {
    reportarError("cerrarComoVieja", e, { solicitudId });
  }
}

/**
 * LA VUELTA DEL CIRCUITO (auditoría 21-08): al aprobar o rechazar, el COBRADOR
 * que pidió se entera por push — hasta ahora la respuesta solo aparecía si él
 * recargaba su inicio a mano, que es la receta del crédito duplicado de JORGE.
 * AWAITED a propósito: en serverless, un void queda congelado al responder.
 */
async function avisarAlCobrador(
  solicitadoPor: string | null,
  payload: { titulo: string; cuerpo: string },
): Promise<void> {
  if (!solicitadoPor) return;
  try {
    await avisarUsuario(solicitadoPor, { ...payload, url: "/cobrador#pedidos", tag: "respuesta-pedido" });
  } catch {
    /* best-effort: la resolución ya está escrita; «Tus pedidos» la muestra igual */
  }
}

/** Resultado de renovar: `via` dice cómo se resolvió. */
export type ResultadoRenovar =
  | { ok: true; via: "auto" | "admin"; prestamoId: string; cuota: number }
  | { ok: true; via: "solicitud" }
  | { ok: false; error: string };

/**
 * Renovación cap-aware (una sola puerta):
 *  · DENTRO del tope (aumento ≤ 20% y ≤ $100.000) → se aprueba SOLA al instante.
 *  · FUERA del tope → la autoriza EL GESTOR que la está creando, sea admin o
 *    supervisor (regla de Carlos, 08-13: el supervisor también es aprobador — "que
 *    den aprobación o hagan esto manual ellos mismos"). Las SOLICITUDES quedan
 *    para la calle: el cobrador pide, y cualquier gestor de la zona resuelve.
 *  El servidor decide con `evaluarRenovacion` (verdad del dinero); el preview
 *  del form es solo informativo. El techo ABSOLUTO sigue siendo duro para todos.
 */
export async function renovarCredito(input: {
  clienteId: string;
  prestamoAnteriorId: string;
  monto: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
}): Promise<ResultadoRenovar> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || !esGestor(usuario.rol)) {
    return { ok: false, error: "No tenés permisos para dar de alta créditos." };
  }
  const monto = Math.round(Number(input.monto));
  const totalDias = Math.round(Number(input.totalDias));
  if (!(monto > 0) || !(totalDias > 0)) return { ok: false, error: "Revisá el monto y las cuotas." };
  // Kill switch: renovar COLOCA capital (crea un crédito nuevo) → congelar en freeze.
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;

  const db = await createSupabaseServer();

  // Monto del crédito anterior para evaluar el tope de auto-aprobación.
  const ant = await getPrestamoPorId(db, input.prestamoAnteriorId);
  if (!ant || ant.cliente_id !== input.clienteId || ant.estado !== "activo") {
    return { ok: false, error: "El crédito anterior no está activo." };
  }
  const evalu = evaluarRenovacion(ant.monto_prestado, monto);

  // ⚠️ TECHO ABSOLUTO — el que impide que un cero de más se vuelva un crédito.
  // Al mandar el sobre-CAP por el camino de solicitud (antes era un rechazo duro
  // que moría acá) cayeron los DOS candados a la vez: la app dejaba de mirar el
  // monto y `aprobarSolicitud` apagaba el de la base. Un supervisor que escribía
  // 2000000 —o que se le iba un cero: 200000 en vez de 20000— generaba una
  // solicitud sin techo, y el admin la aprobaba de un toque viendo solo la cifra
  // pedida. La regla que faltaba: el CAP solo se puede pasar si el crédito
  // ANTERIOR ya lo pasaba, y nunca por encima de él. Para un crédito normal el
  // techo sigue siendo $100.000 (la solicitud sobre-tramo, que es su razón de ser,
  // no cambia); para un heredado de $1.750.000, su propio monto.
  // Techo del GESTOR (regla de Carlos 16-08): hasta +20% sobre el anterior, con
  // piso en el CAP. Más que eso en UNA renovación no lo autoriza nadie — es el
  // candado contra el dedazo ($20.000 tipeado como $200.000).
  const techoAbsoluto = techoRenovacion(ant.monto_prestado);
  if (monto > techoAbsoluto) {
    return {
      ok: false,
      error: `Este crédito se puede renovar hasta ${UYU(techoAbsoluto)} ${explicaTecho(ant.monto_prestado, techoAbsoluto)}. Más que eso en una sola renovación no se autoriza — si hace falta, renovalo por el máximo ahora y subilo en la próxima.`,
    };
  }

  // ⚠️ ACÁ YA NO NACEN SOLICITUDES. El que llegó hasta acá es un GESTOR (admin o
  // supervisor), y desde el 08-13 los DOS son aprobadores (regla de Carlos: "que
  // den aprobación o hagan esto manual ellos mismos"): lo que antes era "el
  // supervisor genera una solicitud y espera al admin" ahora es autorización
  // directa, con el techo absoluto de arriba como único freno duro. La cola de
  // solicitudes queda para los pedidos de la CALLE (cobrador sobre su techo).
  // ⚠️ SOBRE-CAP desde el panel (auditoría 16-08): la RPC 0146 solo honra el
  // flag desde una vía de CONFIANZA (service_role o admin logueado). El
  // SUPERVISOR es aprobador legítimo desde el 08-13 y ya pasó los gates de
  // arriba (rol, alcance por RLS al leer `ant`, techo del gestor): para él el
  // sobre-CAP se escribe con service_role — el MISMO patrón que la calle
  // (renovarDesdeCalle) — o el form prometía "hasta $108.000" y la base
  // rebotaba P0414 con un mensaje de cobrador. Bajo el CAP nada cambia: la
  // sesión del gestor sigue siendo el cinturón (RLS + trigger 0126).
  const sobreCap = monto > RENOVACION_CAP_TOTAL;
  const res = await crearRenovacion(sobreCap && !esAdmin(usuario.rol) ? createSupabaseAdmin() : db, {
    clienteId: input.clienteId,
    prestamoAnteriorId: input.prestamoAnteriorId,
    monto,
    totalDias,
    frecuencia: input.frecuencia,
    creadoPor: usuario.id,
    permitirSobreCap: sobreCap,
  });
  if (!res.ok) return res;
  // Si este crédito tenía una SOLICITUD pendiente y se renovó por alta directa, se
  // cierra para que no quede huérfana apuntando a un crédito ya finalizado
  // (best-effort: el crédito ya está creado, esto es solo limpieza de la cola).
  try {
    // Se cierra como RECHAZADA con el motivo: el gestor renovó por su cuenta desde
    // la lista de candidatos y nadie miró el pedido. Marcarlo "aprobada" dejaba
    // escrito que la oficina autorizó un monto que jamás se colocó.
    if (res.prestamoId)
      await cerrarSolicitudPendienteDeAnterior(
        db,
        input.prestamoAnteriorId,
        res.prestamoId,
        usuario.id,
        "rechazada",
        `Se renovó desde el panel por ${UYU(monto)} sin resolver el pedido.`,
      );
  } catch { /* no bloquea la renovación ya hecha */ }
  await registrarAuditoria(db, {
    actorId: usuario.id,
    actorNombre: usuario.nombre,
    accion: evalu.autoAprobable
      ? "Renovó crédito (auto, dentro del tope)"
      : evalu.superaCap
        ? "Renovó crédito (autorizó POR ENCIMA del tope de $100.000)"
        : "Renovó crédito (autorizó sobre el tope del tramo)",
    entidad: "cliente",
    entidadId: input.clienteId,
    detalle: `Nuevo crédito ${UYU(monto)} × ${totalDias} (${input.frecuencia})`,
  });
  // El nuevo crédito cambia cartera, mora y renovaciones.
  revalidatePath("/admin/renovaciones");
  revalidatePath("/admin/mora");
  revalidatePath("/admin");
  return { ok: true, via: evalu.autoAprobable ? "auto" : "admin", prestamoId: res.prestamoId, cuota: res.cuota };
}

// ── Flujo de APROBACIÓN (el cobrador solicita → cualquier gestor resuelve) ──
// La CREACIÓN de solicitudes vive en la calle (lib/acciones/cobradorCredito.ts):
// cobrador sobre su techo, en renovación o en venta nueva. Desde el 08-13 las
// resuelve CUALQUIER GESTOR — el supervisor de la zona o el admin (regla de
// Carlos: "supervisor debería poder aceptar estas solicitudes"). La RLS 0096 ya
// acota lo que el supervisor VE y ESCRIBE a los clientes de su zona, así que el
// alcance no se decide acá: una solicitud fuera de su zona ni le aparece.

/** Un GESTOR aprueba: crea el crédito (renovación o venta según el tipo) y
 *  cierra la solicitud. */
export async function aprobarSolicitud(id: string): Promise<ResultadoAlta> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol))
    return { ok: false, error: "Las solicitudes las resuelve un supervisor o el administrador." };
  const bloqueo = await bloqueoSoloLectura(); // kill switch: aprobar coloca capital
  if (bloqueo) return bloqueo;
  try {
    const db = await createSupabaseServer();
    const s = await getSolicitudPorId(db, id);
    if (!s || s.estado !== "pendiente") return { ok: false, error: "La solicitud ya no está pendiente." };

    // ⚠️ El monto de la solicitud es texto libre que escribió otra persona, y
    // acá se apagaba el CAP sin volver a mirarlo. Se revalida contra el crédito
    // ANTERIOR —la misma vara que al pedirla— para que aprobar no pueda crear un
    // crédito que nadie podría haber dado de alta directo. Si el pedido no
    // corresponde, se rechaza en vez de fabricar plata.
    const ant = await getPrestamoPorId(db, s.prestamoAnteriorId);

    if (s.tipo === "venta") {
      // ── VENTA NUEVA sobre el techo del cobrador ──────────────────────────
      // El "anterior" acá es la REFERENCIA de tasa/techo (el último crédito del
      // cliente al momento del pedido), NO un crédito a finalizar: puede seguir
      // vivo (multi-crédito legítimo) o estar saldado hace meses. Por eso este
      // camino NO pasa por crearRenovacion — finalizaría un crédito que nadie
      // quiso cerrar. El tope revalidado es el del GESTOR: +20% del anterior con
      // piso en el CAP (regla de Carlos 16-08: más del 20% SE PUEDE, con
      // aprobación — antes acá decía "no lo puede aprobar nadie" sobre $100.000).
      if (!ant || ant.cliente_id !== s.clienteId)
        return { ok: false, error: "El crédito de referencia del pedido ya no existe. Rechazá la solicitud." };
      // ⚠️ Referencia CANCELADA = "financieramente nunca existió" (la regla de
      // getUltimoCreditoDe): un dedazo de $90.000 deshecho DESDE LA CALLE dejaba
      // la solicitud viva y aprobable con techo/tasa medidos contra ese fantasma
      // (auditoría 21-08). El deshacer ahora cierra sus pendientes, y este gate
      // es la defensa en profundidad para CUALQUIER productor de cancelaciones.
      if (ant.estado === "cancelado") {
        await cerrarComoVieja(db, u, id, "El crédito de referencia fue deshecho/cancelado: el pedido quedó sin base real.");
        return {
          ok: false,
          error: "El crédito de referencia de este pedido fue deshecho. El pedido se cerró solo — que lo pidan de nuevo con la base real.",
        };
      }
      const techoGestor = techoVentaGestor(ant.monto_prestado);
      if (s.monto > techoGestor)
        return {
          ok: false,
          error: `El monto pedido (${UYU(s.monto)}) supera lo que se puede autorizar en una venta: ${UYU(techoGestor)} ${explicaTecho(ant.monto_prestado, techoGestor)}. Rechazá la solicitud y que la pidan bien.`,
        };
      // El cliente puede haber caído de baja MIENTRAS el pedido esperaba: todos
      // los demás caminos lo frenan (puerta() en la calle, el chequeo del panel)
      // y aprobar acá lo resucitaba en la ruta (auditoría 08-14).
      const cliente = await getClientePorId(db, s.clienteId);
      if (!cliente || !cliente.activo)
        return { ok: false, error: "El cliente está dado de baja. Rechazá la solicitud." };
      // El crédito nace a nombre del COBRADOR QUE LO PIDIÓ (misma regla que la
      // renovación: el efectivo sale de su bolsillo y el colocado se cuenta por
      // `creado_por`). Sin cobrador no hay a quién ruteárselo — y tiene que
      // seguir SIENDO cobrador activo: aprobarle un pedido a uno dado de baja
      // fabrica el "crédito fantasma" que ninguna ruta ve (46 casos, 08-02).
      if (!s.solicitadoPor)
        return { ok: false, error: "El pedido no dice qué cobrador lo hizo. Rechazalo y que lo pidan de nuevo." };
      const { data: cob } = await db
        .from("usuarios")
        .select("id, rol, activo")
        .eq("id", s.solicitadoPor)
        .maybeSingle();
      // La consulta corre con la sesión del gestor: si el cobrador es de OTRA
      // zona (cliente compartido entre zonas), la RLS no lo devuelve — y el
      // upsert de asignaciones rebotaría después con un error mudo. Se dice
      // cuál es la salida en vez de invitar a reintentar lo imposible.
      if (!cob)
        return {
          ok: false,
          error: "El cobrador que pidió esto es de otra zona: este pedido lo tiene que resolver el administrador.",
        };
      if (cob.rol !== "cobrador" || !cob.activo)
        return {
          ok: false,
          error: "El cobrador que lo pidió ya no está activo. Rechazá la solicitud y reasigná al cliente.",
        };
      const baseTasa = {
        monto: Math.round(Number(ant.monto_prestado) || 0),
        cuota: Number(ant.cuota_diaria) || 0,
        totalDias: Number(ant.total_dias) || 0,
      };
      const interesPct = interesDeBase(baseTasa);
      const cuota = calcularCuotaCreditoNuevo(baseTasa, s.monto, s.totalDias, interesPct ?? INTERES_DEFECTO_PCT);
      if (!(cuota > 0)) return { ok: false, error: "La cuota calculada no es válida. Rechazá la solicitud." };
      const res = await crearCreditoNuevoDb(db, {
        clienteId: s.clienteId,
        cobradorId: s.solicitadoPor,
        monto: s.monto,
        cuota,
        totalDias: s.totalDias,
        frecuencia: s.frecuencia,
        fechaInicio: toIso(proximoDiaCobro(hoyUY(new Date()))),
        interesPct,
        creadoPor: s.solicitadoPor,
        // Determinista POR SOLICITUD: el reintento de "Aprobar" tras un blip no
        // coloca el capital dos veces (devuelve el crédito ya creado).
        opId: opIdDeterminista("venta-aprobada", s.id),
      });
      if (!res.ok) return res;
      try {
        const marcada = await resolverSolicitudDb(db, id, { estado: "aprobada", resueltoPor: u.id, prestamoNuevoId: res.prestamoId });
        // ⚠️ CARRERA aprobar-vs-rechazar: si otro gestor la rechazó mientras el
        // crédito se creaba, la solicitud diría "rechazada" con plata ACTIVA en
        // la calle — y Mis pedidos invitaría a colocarla de nuevo. La verdad es
        // el crédito: se re-marca aprobada y el choque queda anotado.
        if (!marcada) await marcarAprobadaPorCreditoExistente(db, id, res.prestamoId, u.id);
      } catch (e) {
        reportarError("aprobarSolicitud:resolver", e, { solicitudId: id, prestamoId: res.prestamoId });
      }
      // Auditoría solo del alta REAL: el reintento idempotente (repetido) ya
      // tiene su entrada — dos filas "Aprobó venta" parecían capital doble.
      if (!res.repetido) {
        await registrarAuditoria(db, {
          actorId: u.id,
          actorNombre: u.nombre,
          accion: "Aprobó venta nueva (sobre el techo del cobrador)",
          entidad: "cliente",
          entidadId: s.clienteId,
          detalle: `${UYU(s.monto)} × ${s.totalDias} (${s.frecuencia}) · cuota ${UYU(cuota)}`,
        });
      }
      await avisarAlCobrador(s.solicitadoPor, {
        titulo: "✅ Venta aprobada",
        cuerpo: `Te aprobaron ${UYU(s.monto)} (cuota ${UYU(cuota)}). Ya podés entregar la plata — está en «Tus pedidos».`,
      });
      revalidatePath("/admin/renovaciones");
      revalidatePath("/admin/mora");
      revalidatePath("/admin");
      return { ok: true, prestamoId: res.prestamoId, cuota };
    }

    // ── RENOVACIÓN: finaliza el anterior (que debe seguir activo) y crea el nuevo ──
    if (!ant || ant.estado !== "activo") {
      // El crédito se renovó/cerró por otro camino mientras el pedido esperaba.
      // Antes esto devolvía un error SIN salida y la solicitud quedaba inflando
      // la franja y el contador para siempre: se cierra sola, con el motivo.
      await cerrarComoVieja(db, u, id, "El crédito ya no está activo (se renovó o cerró por otro camino): el pedido quedó viejo.");
      return {
        ok: false,
        error: "Ese crédito ya no está activo (se renovó o cerró por otro camino). El pedido se cerró solo — si el cliente quiere más, que lo pidan de nuevo.",
      };
    }
    // Mismos gates que la rama VENTA (auditoría 21-08: acá faltaban): el cliente
    // pudo caer de baja y el cobrador que pidió pudo dejar de estar activo
    // mientras el pedido esperaba — aprobar resucitaba al archivado o fabricaba
    // un crédito a nombre de alguien sin ruta (el "crédito fantasma").
    const clienteRen = await getClientePorId(db, s.clienteId);
    if (!clienteRen || !clienteRen.activo)
      return { ok: false, error: "El cliente está dado de baja. Rechazá la solicitud." };
    if (s.solicitadoPor) {
      const { data: cobRen } = await db
        .from("usuarios")
        .select("id, rol, activo")
        .eq("id", s.solicitadoPor)
        .maybeSingle();
      if (cobRen && (cobRen.rol !== "cobrador" || !cobRen.activo))
        return {
          ok: false,
          error: "El cobrador que lo pidió ya no está activo. Rechazá la solicitud y reasigná al cliente.",
        };
    }
    const techoAbsoluto = techoRenovacion(ant.monto_prestado);
    if (s.monto > techoAbsoluto)
      return {
        ok: false,
        error: `El monto pedido (${UYU(s.monto)}) no corresponde a este crédito: el máximo es ${UYU(techoAbsoluto)} ${explicaTecho(ant.monto_prestado, techoAbsoluto)}. Rechazá la solicitud y que la vuelvan a pedir bien.`,
      };

    // Sobre-CAP aprobado por un SUPERVISOR: service_role (vía de confianza de la
    // 0146) tras los gates de arriba — igual que renovarCredito.
    const sobreCapSol = s.monto > RENOVACION_CAP_TOTAL;
    const res = await crearRenovacion(sobreCapSol && !esAdmin(u.rol) ? createSupabaseAdmin() : db, {
      clienteId: s.clienteId,
      prestamoAnteriorId: s.prestamoAnteriorId,
      monto: s.monto,
      totalDias: s.totalDias,
      frecuencia: s.frecuencia,
      // ⚠️ El crédito nace a nombre del COBRADOR QUE LO PIDIÓ, no del gestor que
      // aprueba: el efectivo lo saca él del bolsillo, parado al lado del cliente.
      // El capital colocado se cuenta por `creado_por`, así que ponerle el id del
      // gestor le dejaba el `colocado` en $0 y el cierre le volvía a pedir esa
      // plata — exactamente el faltante fantasma que la 0136 vino a matar, mudado
      // al camino de aprobación. Quién aprobó queda en la auditoría, que es donde va.
      creadoPor: s.solicitadoPor ?? u.id,
      // Solo si el monto REALMENTE se pasa del tope — y ya se validó arriba que
      // no puede pasar del crédito anterior. Antes iba `true` incondicional, que
      // apagaba el candado de la base para cualquier solicitud.
      permitirSobreCap: s.monto > RENOVACION_CAP_TOTAL,
    });
    if (!res.ok) return res;
    // El crédito YA se creó (fuente de verdad). Marcar la solicitud es best-effort:
    // si falla (blip), NO devolvemos error — el reintento chocaría con el anterior ya
    // finalizado. Se registra el fallo pero la aprobación se considera exitosa.
    try {
      const marcada = await resolverSolicitudDb(db, id, { estado: "aprobada", resueltoPor: u.id, prestamoNuevoId: res.prestamoId });
      // Carrera aprobar-vs-rechazar (ver rama venta): el crédito EXISTE y el
      // anterior ya quedó finalizado — la solicitud no puede decir "rechazada".
      if (!marcada) await marcarAprobadaPorCreditoExistente(db, id, res.prestamoId, u.id);
    } catch (e) {
      reportarError("aprobarSolicitud:resolver", e, { solicitudId: id, prestamoId: res.prestamoId });
    }
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Aprobó renovación",
      entidad: "cliente",
      entidadId: s.clienteId,
      detalle: `${UYU(s.monto)} × ${s.totalDias} (${s.frecuencia})`,
    });
    await avisarAlCobrador(s.solicitadoPor, {
      titulo: "✅ Renovación aprobada",
      cuerpo: `Te aprobaron ${UYU(s.monto)} × ${s.totalDias}. Ya podés entregar la plata — está en «Tus pedidos».`,
    });
    revalidatePath("/admin/renovaciones");
    revalidatePath("/admin/mora");
    revalidatePath("/admin");
    return res;
  } catch {
    return { ok: false, error: "No se pudo aprobar. Probá de nuevo." };
  }
}

/** Un GESTOR rechaza una solicitud (con motivo opcional). */
export async function rechazarSolicitud(id: string, motivo: string): Promise<ResultadoSimple> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol))
    return { ok: false, error: "Las solicitudes las resuelve un supervisor o el administrador." };
  try {
    const db = await createSupabaseServer();
    // El tipo (0139) para que la auditoría diga la verdad: rechazar una VENTA
    // no es rechazar una renovación (efectos distintos sobre el crédito anterior).
    const s = await getSolicitudPorId(db, id);
    // ⚠️ Si otro gestor ya la resolvió, el update afecta 0 filas — y eso NO es un
    // error de SQL. Sin este chequeo, rechazar una solicitud que un compañero
    // acababa de APROBAR devolvía ok, escribía "Rechazó renovación" en la auditoría
    // y la tarjeta desaparecía: el segundo se iba convencido de haberla frenado
    // mientras el crédito ya estaba creado y el cliente lo estaba pagando.
    const resolvio = await resolverSolicitudDb(db, id, {
      estado: "rechazada",
      resueltoPor: u.id,
      motivoRechazo: (motivo ?? "").trim().slice(0, 300) || null,
    });
    if (!resolvio)
      return {
        ok: false,
        error: "Otra persona ya resolvió esta solicitud. Recargá la pantalla para ver cómo quedó — si la aprobaron, el crédito YA está creado.",
      };
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: s?.tipo === "venta" ? "Rechazó venta nueva" : "Rechazó renovación",
      entidad: "solicitud",
      entidadId: id,
      detalle: (motivo ?? "").slice(0, 120),
    });
    await avisarAlCobrador(s?.solicitadoPor ?? null, {
      titulo: "Tu pedido no se aprobó",
      cuerpo: `El pedido de ${UYU(s?.monto ?? 0)} no se aprobó${(motivo ?? "").trim() ? `: ${(motivo ?? "").trim().slice(0, 80)}` : ""}. NO entregues plata por este pedido — el detalle está en «Tus pedidos».`,
    });
    revalidatePath("/admin/renovaciones");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo rechazar." };
  }
}
