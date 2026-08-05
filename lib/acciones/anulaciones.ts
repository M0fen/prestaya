"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — ANULACIÓN de pagos (decisión 2: doble registro).
//   · admin: anula DIRECTO.
//   · supervisor: SOLICITA anular un pago de SU zona → una SEGUNDA persona
//     (admin u otro gestor distinto) CONFIRMA. Recién ahí se anula.
//  El doble registro se valida en el servidor con el núcleo puro permisos.ts.
//  El pago se marca anulado con service_role (por RLS anular = solo admin);
//  nunca se borra. Todo queda auditado.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual } from "@/lib/auth";
import { getZonasDeSupervisor } from "@/lib/data/zonas";
import { upsertDiscrepanciaDb } from "@/lib/data/discrepancias";
import { rangoDeRangoPg, rangoDePeriodoKey } from "@/lib/data/comisiones";
import { hoyUY } from "@/lib/fecha";
import { toIso } from "@/lib/format";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  actorDesde,
  puedeAnularPagoDirecto,
  puedeSolicitarAnulacion,
  puedeSolicitarAnulacionCobrador,
  puedeConfirmarAnulacion,
  puedeVerZona,
} from "@/lib/permisos";
import {
  getZonaDePago,
  getPagoResumen,
  getSolicitud,
  getSolicitudPendienteDePago,
} from "@/lib/data/anulaciones";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { reportarError } from "@/lib/observabilidad";
import type { Usuario } from "@/types/db";

type Resultado = { ok: true } | { ok: false; error: string };

async function actorYUsuario() {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return null;
  const zonas = u.rol === "supervisor" ? await getZonasDeSupervisor(await createSupabaseServer(), u.id) : [];
  return { u, actor: actorDesde(u, zonas) };
}

/**
 * ¿El pago anulado cae dentro de un período cuya comisión YA se le liquidó a quien
 * lo registró? Si sí, abre una discrepancia con el monto del pago para que la
 * oficina descuente esa comisión a mano. Silencioso cuando no aplica.
 */
async function avisarComisionYaLiquidada(
  admin: SupabaseClient,
  pago: Record<string, unknown>,
  u: Usuario,
): Promise<void> {
  // Un pago importado/de reconciliación jamás generó comisión (0127: la base
  // excluye origen ≠ NULL) → anularlo no deja comisión colgada; avisar sería
  // ruido de triage cada vez que se corrija un import.
  if ((pago.origen as string | null) != null) return;
  const registradoEn = pago.registrado_en as string | null;
  if (!registradoEn) return;
  const diaPago = toIso(hoyUY(new Date(registradoEn)));

  // La comisión se paga al DUEÑO DE LA RUTA (prestamos.cobrador_id, regla 0069),
  // no a quien registró: un pago de oficina/transferencia comisiona al cobrador
  // de la ruta. Buscar la liquidación por registrado_por callaba el aviso justo
  // en esos casos. Fallback a registrado_por si el crédito no aparece.
  let cobradorId = (pago.registrado_por as string | null) ?? null;
  const prestamoId = (pago.prestamo_id as string | null) ?? null;
  if (prestamoId) {
    const { data: pr } = await admin
      .from("prestamos")
      .select("cobrador_id")
      .eq("id", prestamoId)
      .maybeSingle();
    if (pr?.cobrador_id) cobradorId = pr.cobrador_id as string;
  }
  if (!cobradorId) return;

  const { data: liqs } = await admin
    .from("comisiones_liquidadas")
    .select("periodo_key, periodo_rango, monto")
    .eq("cobrador_id", cobradorId);
  if (!liqs || liqs.length === 0) return;

  // Se prefiere el rango REAL guardado (0083); si esa columna no está, se deriva
  // de la clave canónica — las dos rutas ya existen y están testeadas.
  const cubre = liqs.find((l) => {
    const r =
      rangoDeRangoPg(l.periodo_rango as string | null) ?? rangoDePeriodoKey(l.periodo_key as string);
    return r != null && diaPago >= r.desde && diaPago <= r.hasta;
  });
  if (!cubre) return;

  const monto = Math.round(Number(pago.monto) || 0);
  await upsertDiscrepanciaDb(admin, {
    creditoId: pago.prestamo_id as string,
    estado: "abierto",
    tipo: "anulacion-con-comision-liquidada",
    montoDiferencia: monto,
    nota:
      `Se anuló un pago de $${monto.toLocaleString("es-UY")} del ${diaPago}, pero la comisión del ` +
      `período ${cubre.periodo_key} de ese cobrador YA se liquidó ($${Math.round(Number(cubre.monto) || 0).toLocaleString("es-UY")}). ` +
      `Se le pagó comisión sobre un cobro que ya no existe: descontarlo en la próxima liquidación.`,
    adminId: u.id,
    ahoraIso: new Date().toISOString(),
  });
}

/** Marca el pago anulado con service_role (RLS: anular = solo admin). */
async function flipAnulado(pagoId: string, u: Usuario, motivo: string): Promise<boolean> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from("pagos")
    .update({
      anulado: true,
      anulado_por: u.id,
      anulado_en: new Date().toISOString(),
      motivo_anulacion: motivo,
    })
    .eq("id", pagoId)
    .eq("anulado", false) // idempotente: no re-anula uno ya anulado
    .select("id, prestamo_id, monto, registrado_por, registrado_en, origen");
  const ok = !error && (data?.length ?? 0) > 0;

  // COMISIÓN YA PAGADA sobre plata que dejó de existir. La comisión se liquida
  // sobre el recaudo de un período; si después se anula un pago de ESE período,
  // el egreso ya salió de la caja y nada lo revisa: el candado unique(cobrador,
  // periodo_key) impide re-liquidar, así que tampoco se auto-corrige en la
  // siguiente vuelta. No se hace clawback automático (es una decisión del
  // negocio, y tocar un egreso ya entregado es peor): se deja una discrepancia
  // en la cola de triage con el monto exacto para descontarlo a mano.
  if (ok) {
    try {
      await avisarComisionYaLiquidada(admin, data![0] as Record<string, unknown>, u);
    } catch {
      /* best-effort: el libro ya quedó consistente, esto es visibilidad */
    }
  }
  // VISIBILIDAD (caza 07-28): anular un pago de un crédito NO activo (finalizado/
  // renovado) baja pagado_acum sin reabrir el crédito → el saldo que queda impago no
  // lo cobra nadie y una renovación pudo otorgarse sobre ese pago. La reconciliación
  // (pagado_acum==Σpagos, sin sobre-cobro) NO lo detecta (ambos bajan).
  // Antes esto solo emitía un evento de Sentry: EFÍMERO y fuera del circuito del
  // negocio (nadie del equipo lo mira) → el write-off quedaba sin dueño. Ahora
  // además se ABRE UNA DISCREPANCIA (0109), que es la cola de triage que el admin
  // ya usa y que el panel del empalme muestra hasta que alguien la resuelve/acepta.
  // Best-effort en ambos canales: nunca rompe la anulación (el libro ya cambió).
  if (ok) {
    try {
      const prestamoId = data![0].prestamo_id as string;
      const { data: pre } = await admin
        .from("prestamos")
        .select("estado, cuota_diaria, total_dias, pagado_acum")
        .eq("id", prestamoId)
        .maybeSingle();
      const p = pre as { estado?: string; cuota_diaria?: number; total_dias?: number; pagado_acum?: number } | null;
      const estado = p?.estado;
      if (estado && estado !== "activo") {
        reportarError("anulacion.credito-no-activo", new Error(`Anulación de pago en crédito ${estado} (write-off silencioso, revisar renovación)`), {
          pagoId, prestamoId, estado, anuladoPor: u.id,
        });
        // Saldo que queda impago y que ya NADIE va a cobrar (el crédito no está
        // en ninguna ruta): es la magnitud del write-off que hay que revisar.
        const saldo = Math.max(
          0,
          Math.round(Number(p?.cuota_diaria ?? 0) * Number(p?.total_dias ?? 0)) - Math.round(Number(p?.pagado_acum ?? 0)),
        );
        await upsertDiscrepanciaDb(admin, {
          creditoId: prestamoId,
          estado: "abierto",
          tipo: "anulacion-credito-no-activo",
          montoDiferencia: saldo,
          nota:
            `Se anuló un pago de un crédito ${estado}. Queda un saldo de $${saldo.toLocaleString("es-UY")} ` +
            `que ninguna ruta cobra (el crédito no está activo). Revisar si la renovación se otorgó sobre ese pago.`,
          adminId: u.id,
          ahoraIso: new Date().toISOString(),
        });
      }
    } catch {
      /* la visibilidad es best-effort: el libro ya quedó consistente */
    }
  }
  return ok;
}

// ── (quien registró) Deshacer dentro de 1 hora ──────────────────────────────
//  Ventana de AUTO-CORRECCIÓN: quien registró el pago puede deshacerlo sin
//  aprobación mientras no pase 1 h. Nunca borra el libro: lo marca anulado (con
//  traza de quién/cuándo). Pasada la hora, hay que ir por la anulación normal.
const VENTANA_DESHACER_MS = 60 * 60 * 1000; // 1 hora

export async function deshacerPagoAction(input: { pagoId: string }): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return { ok: false, error: "Sesión no válida." };
  // Kill switch: deshacer muta el libro (baja pagado_acum) → congelar en un freeze.
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;

  // Traigo los datos de control con service_role (necesito registrado_por/_en,
  // que el RLS del cobrador no siempre deja leer de pagos de otros). La AUTORIZACIÓN
  // va ABAJO (solo quien lo registró) antes de cualquier escritura.
  const admin = createSupabaseAdmin();
  const { data: pago } = await admin
    .from("pagos")
    .select("id, registrado_por, registrado_en, anulado, origen")
    .eq("id", input.pagoId)
    .maybeSingle();
  if (!pago) return { ok: false, error: "No se encontró el pago." };
  if (pago.anulado) return { ok: false, error: "Ese pago ya estaba anulado." };
  // Los asientos de import/reconciliación llevan el registrado_por del cobrador
  // real pero NO son un cobro suyo de hace un rato: deshacerlos rompe el espejo
  // con Disapp. Solo se deshace trabajo hecho EN LA APP (origen null).
  if ((pago.origen as string | null) != null)
    return { ok: false, error: "Ese es un registro de oficina (migración): no se deshace desde acá." };

  // Autorización: SOLO quien lo registró, y SOLO dentro de la ventana de 1 h.
  if (pago.registrado_por !== u.id)
    return { ok: false, error: "Solo quien registró el pago puede deshacerlo. Pedí una anulación." };
  const registradoEn = new Date(pago.registrado_en as string).getTime();
  if (!Number.isFinite(registradoEn) || Date.now() - registradoEn > VENTANA_DESHACER_MS)
    return { ok: false, error: "Pasó más de 1 hora: ya no se puede deshacer. Pedí una anulación." };

  // CUSTODIA: si ese día YA rindió, el recaudado quedó CONGELADO en la rendición
  // (y el efectivo ya se entregó al supervisor). Deshacer ahora deja la rendición
  // histórica diciendo que cobró algo que en el libro no existe → descuadre mudo
  // entre libro/rendición/cierre de zona, y el cliente vuelve a figurar impago
  // (se le cobraría dos veces). Pasada la rendición, solo anulación con doble registro.
  const pagoDia = toIso(hoyUY(new Date(pago.registrado_en as string)));
  const { data: rend } = await admin
    .from("rendiciones")
    .select("id")
    .eq("cobrador_id", u.id)
    .eq("fecha", pagoDia)
    .maybeSingle();
  if (rend)
    return {
      ok: false,
      error: "Ya cerraste la jornada de ese día y entregaste el efectivo. Pedí una anulación para corregirlo.",
    };

  const ok = await flipAnulado(input.pagoId, u, "Deshecho por quien lo registró (dentro de 1 h)");
  if (!ok) return { ok: false, error: "No se pudo deshacer el pago." };

  const db = await createSupabaseServer();
  const resumen = await getPagoResumen(db, input.pagoId);
  await registrarAuditoria(db, {
    actorId: u.id,
    actorNombre: u.nombre,
    accion: "Deshizo un pago (dentro de 1 h)",
    entidad: "pago",
    entidadId: input.pagoId,
    detalle: resumen ? `${resumen.clienteNombre}` : "",
  });
  if (resumen) revalidatePath(`/admin/clientes/${resumen.clienteId}`);
  revalidatePath("/cobrador");
  return { ok: true };
}

// ── (admin) Anular directo ───────────────────────────────────────────────
export async function anularPagoDirectoAction(input: {
  pagoId: string;
  motivo: string;
}): Promise<Resultado> {
  const ctx = await actorYUsuario();
  if (!ctx) return { ok: false, error: "Sesión no válida." };
  if (!puedeAnularPagoDirecto(ctx.actor))
    return { ok: false, error: "Solo el administrador anula pagos directo." };
  const bloqueo = await bloqueoSoloLectura(); // kill switch: anular muta el libro
  if (bloqueo) return bloqueo;
  const motivo = (input.motivo ?? "").trim();
  if (motivo.length < 3) return { ok: false, error: "Escribí el motivo de la anulación." };

  const db = await createSupabaseServer();
  const resumen = await getPagoResumen(db, input.pagoId);
  if (!resumen) return { ok: false, error: "No se encontró el pago." };
  if (resumen.anulado) return { ok: false, error: "Ese pago ya estaba anulado." };

  const ok = await flipAnulado(input.pagoId, ctx.u, motivo);
  if (!ok) return { ok: false, error: "No se pudo anular el pago." };

  await registrarAuditoria(db, {
    actorId: ctx.u.id,
    actorNombre: ctx.u.nombre,
    accion: "Anuló un pago (directo)",
    entidad: "pago",
    entidadId: input.pagoId,
    detalle: `${resumen.clienteNombre} · ${motivo}`,
  });
  revalidatePath(`/admin/clientes/${resumen.clienteId}`);
  return { ok: true };
}

// ── (supervisor / cobrador) Solicitar anulación ──────────────────────────
//  Supervisor: pagos de SU zona. Cobrador (decisión 08-05): SOLO pagos que él
//  mismo registró en la app — es la salida para corregir un cobro de un día
//  anterior, con el aval de un gestor (doble registro). Nadie anula solo.
export async function solicitarAnulacionAction(input: {
  pagoId: string;
  motivo: string;
}): Promise<Resultado> {
  const ctx = await actorYUsuario();
  if (!ctx) return { ok: false, error: "Sesión no válida." };
  // Tope de 300: el insert va con service_role y sin cap un motivo de megabytes
  // quedaba entero en la bandeja del gestor / motivo_anulacion / auditoría.
  const motivo = (input.motivo ?? "").trim().slice(0, 300);
  if (motivo.length < 3) return { ok: false, error: "Escribí el motivo de la solicitud." };

  const db = await createSupabaseServer();
  const zona = await getZonaDePago(db, input.pagoId);
  let autorizado = puedeSolicitarAnulacion(ctx.actor, zona);
  if (!autorizado && ctx.u.rol === "cobrador") {
    // registrado_por se lee con service_role (el RLS del cobrador no siempre lo
    // deja ver); la AUTORIZACIÓN es puramente "el pago es MÍO y nació en la app"
    // (un import/ajuste no lo corrige el cobrador: eso es de la oficina).
    const { data: pago } = await createSupabaseAdmin()
      .from("pagos")
      .select("registrado_por, origen")
      .eq("id", input.pagoId)
      .maybeSingle();
    autorizado =
      puedeSolicitarAnulacionCobrador(ctx.actor, (pago?.registrado_por as string | null) ?? null) &&
      (pago?.origen as string | null) == null;
  }
  if (!autorizado)
    return {
      ok: false,
      error: "Solo podés pedir corregir pagos tuyos (o de tu zona, si sos supervisor).",
    };

  const resumen = await getPagoResumen(db, input.pagoId);
  if (!resumen) return { ok: false, error: "No se encontró el pago." };
  if (resumen.anulado) return { ok: false, error: "Ese pago ya estaba anulado." };
  // Chequeo de duplicado con service_role: el RLS de la tabla no deja LEER al
  // cobrador, y con `db` el chequeo daría "no hay" aunque hubiera una pendiente
  // (el unique igual la frenaría, pero con un error genérico).
  if (await getSolicitudPendienteDePago(createSupabaseAdmin(), input.pagoId))
    return { ok: false, error: "Ya hay una solicitud pendiente para ese pago." };

  // Insert con service_role: el RLS de la tabla es de gestores y el cobrador
  // quedaría afuera — la autorización real ya pasó ARRIBA (y queda auditada).
  const { error } = await createSupabaseAdmin().from("solicitudes_anulacion").insert({
    pago_id: input.pagoId,
    motivo,
    solicitado_por: ctx.u.id,
    solicitado_por_nombre: ctx.u.nombre,
  });
  if (error) return { ok: false, error: "No se pudo registrar la solicitud. Probá de nuevo." };

  await registrarAuditoria(db, {
    actorId: ctx.u.id,
    actorNombre: ctx.u.nombre,
    accion: "Solicitó anular un pago",
    entidad: "pago",
    entidadId: input.pagoId,
    detalle: `${resumen.clienteNombre} · ${motivo}`,
  });
  revalidatePath(`/admin/clientes/${resumen.clienteId}`);
  revalidatePath("/admin/anulaciones");
  revalidatePath("/cobrador");
  return { ok: true };
}

// ── (2ª persona) Confirmar la anulación pedida ───────────────────────────
export async function confirmarAnulacionAction(input: { solicitudId: string }): Promise<Resultado> {
  const ctx = await actorYUsuario();
  if (!ctx) return { ok: false, error: "Sesión no válida." };
  // Kill switch: confirmar la anulación muta el libro (baja pagado_acum) → congelar.
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;

  const db = await createSupabaseServer();
  const sol = await getSolicitud(db, input.solicitudId);
  if (!sol) return { ok: false, error: "No se encontró la solicitud." };
  if (sol.estado !== "pendiente") return { ok: false, error: "Esa solicitud ya fue resuelta." };

  // Doble registro: la confirma OTRA persona gestora, no la que la pidió.
  if (!puedeConfirmarAnulacion(ctx.actor, sol.solicitadoPor ?? ""))
    return { ok: false, error: "La anulación la confirma otra persona, no quien la pidió." };

  // Aislamiento de zona: además de ser otra persona, quien confirma debe tener
  // autoridad sobre la zona del pago (admin o supervisor de esa zona). Evita que
  // un supervisor confirme anulaciones de dinero de otra zona.
  const zonaPago = await getZonaDePago(db, sol.pagoId);
  const confirmadorAutorizado =
    ctx.actor.rol === "admin" || (ctx.actor.rol === "supervisor" && puedeVerZona(ctx.actor, zonaPago));
  if (!confirmadorAutorizado)
    return { ok: false, error: "Solo el admin o un supervisor de esa zona puede confirmar." };

  const resumen = await getPagoResumen(db, sol.pagoId);
  if (!resumen) return { ok: false, error: "No se encontró el pago." };
  if (resumen.anulado) {
    // Ya estaba anulado: cerrar la solicitud igual.
    await db.from("solicitudes_anulacion").update({
      estado: "confirmada",
      resuelto_por: ctx.u.id,
      resuelto_por_nombre: ctx.u.nombre,
      resuelto_en: new Date().toISOString(),
    }).eq("id", sol.id);
    return { ok: false, error: "Ese pago ya estaba anulado." };
  }

  const ok = await flipAnulado(sol.pagoId, ctx.u, `${sol.motivo} (pidió ${sol.solicitadoPorNombre ?? "—"})`);
  if (!ok) return { ok: false, error: "No se pudo anular el pago." };

  await db.from("solicitudes_anulacion").update({
    estado: "confirmada",
    resuelto_por: ctx.u.id,
    resuelto_por_nombre: ctx.u.nombre,
    resuelto_en: new Date().toISOString(),
  }).eq("id", sol.id);

  await registrarAuditoria(db, {
    actorId: ctx.u.id,
    actorNombre: ctx.u.nombre,
    accion: "Confirmó una anulación (doble registro)",
    entidad: "pago",
    entidadId: sol.pagoId,
    detalle: `${resumen.clienteNombre} · pidió ${sol.solicitadoPorNombre ?? "—"}`,
  });
  revalidatePath(`/admin/clientes/${resumen.clienteId}`);
  revalidatePath("/admin/anulaciones");
  return { ok: true };
}

// ── (gestor) Rechazar / cancelar la solicitud ────────────────────────────
export async function rechazarAnulacionAction(input: {
  solicitudId: string;
  motivo?: string;
}): Promise<Resultado> {
  const ctx = await actorYUsuario();
  if (!ctx || (ctx.actor.rol !== "admin" && ctx.actor.rol !== "supervisor"))
    return { ok: false, error: "Solo un gestor puede rechazar." };

  const db = await createSupabaseServer();
  const sol = await getSolicitud(db, input.solicitudId);
  if (!sol) return { ok: false, error: "No se encontró la solicitud." };
  if (sol.estado !== "pendiente") return { ok: false, error: "Esa solicitud ya fue resuelta." };

  // Puede rechazar: el admin, quien la pidió (cancela la suya) o un supervisor
  // de la zona del pago. No un supervisor ajeno a esa zona.
  const zonaPago = await getZonaDePago(db, sol.pagoId);
  const puedeRechazar =
    ctx.actor.rol === "admin" ||
    sol.solicitadoPor === ctx.u.id ||
    (ctx.actor.rol === "supervisor" && puedeVerZona(ctx.actor, zonaPago));
  if (!puedeRechazar)
    return { ok: false, error: "Solo el admin, quien la pidió o un supervisor de esa zona puede rechazar." };

  await db.from("solicitudes_anulacion").update({
    estado: "rechazada",
    resuelto_por: ctx.u.id,
    resuelto_por_nombre: ctx.u.nombre,
    resuelto_en: new Date().toISOString(),
    motivo_rechazo: (input.motivo ?? "").trim() || null,
  }).eq("id", sol.id);

  await registrarAuditoria(db, {
    actorId: ctx.u.id,
    actorNombre: ctx.u.nombre,
    accion: "Rechazó una solicitud de anulación",
    entidad: "pago",
    entidadId: sol.pagoId,
  });
  revalidatePath("/admin/anulaciones");
  return { ok: true };
}
