"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — ALTA REAL del crédito de renovación (solo gestor).
//  Escribe dinero: finaliza el crédito saldado y crea el nuevo, arrastrando la
//  tasa (la cuota la calcula el servidor, ver lib/data/renovaciones.ts).
//  Corre con la sesión del gestor → el RLS exige app_es_gestor().
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor, esAdmin } from "@/lib/auth";
import { crearRenovacion, type ResultadoAlta } from "@/lib/data/renovaciones";
import {
  crearSolicitudDb,
  getSolicitudPorId,
  resolverSolicitudDb,
  cerrarSolicitudPendienteDeAnterior,
} from "@/lib/data/solicitudesRenovacion";
import { getPrestamoPorId } from "@/lib/data/prestamos";
import { evaluarRenovacion, techoRenovacion, RENOVACION_CAP_TOTAL } from "@/lib/renovacion";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { reportarError } from "@/lib/observabilidad";
import { UYU } from "@/lib/format";
import type { FrecuenciaPrestamo } from "@/types/db";

type ResultadoSimple = { ok: true } | { ok: false; error: string };

/** Resultado de renovar: `via` dice cómo se resolvió. */
export type ResultadoRenovar =
  | { ok: true; via: "auto" | "admin"; prestamoId: string; cuota: number }
  | { ok: true; via: "solicitud" }
  | { ok: false; error: string };

/**
 * Renovación cap-aware (una sola puerta):
 *  · DENTRO del tope (aumento ≤ 20% y ≤ $100.000) → se aprueba SOLA: crea el
 *    crédito al instante, sea admin o supervisor (renovación "automática").
 *  · FUERA del tope → requiere aprobación: el admin la crea directo (él ES el
 *    aprobador); el supervisor genera una SOLICITUD que el admin resuelve.
 *  El servidor decide con `evaluarRenovacion` (verdad del dinero); el preview
 *  del form es solo informativo.
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
  const admin = esAdmin(usuario.rol);

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
  const techoAbsoluto = techoRenovacion(ant.monto_prestado);
  if (monto > techoAbsoluto) {
    return {
      ok: false,
      error:
        ant.monto_prestado > RENOVACION_CAP_TOTAL
          ? `Este crédito se puede renovar hasta ${UYU(techoAbsoluto)} (lo que ya tenía). Renovar no sube un crédito que está por encima del tope.`
          : `El crédito no puede superar ${UYU(RENOVACION_CAP_TOTAL)}. Revisá el monto.`,
    };
  }

  // Lo que NO se puede aprobar solo va al ADMIN, nunca a un callejón sin salida
  // (decisión de Carlos, 06-08: "cuando no se puedan renovar así directamente, se
  // envía a admin para que apruebe"). Son dos casos: pasarse del tope del tramo
  // (20/15/10%) y pasarse del CAP de $100.000 — este último aparece con los
  // créditos heredados de Disapp que ya venían por encima, donde la alternativa
  // era rebajarle el capital al cliente. El admin ES el aprobador: da de alta
  // directo. Cualquier otro rol genera una SOLICITUD que él resuelve (0029).
  const necesitaAprobacion = evalu.superaCap || evalu.excedePct;
  if (necesitaAprobacion && !admin) {
    try {
      await crearSolicitudDb(db, {
        clienteId: input.clienteId,
        prestamoAnteriorId: input.prestamoAnteriorId,
        monto,
        totalDias,
        frecuencia: input.frecuencia,
        solicitadoPor: usuario.id,
        solicitadoPorNombre: usuario.nombre,
      });
      await registrarAuditoria(db, {
        actorId: usuario.id,
        actorNombre: usuario.nombre,
        accion: evalu.superaCap
          ? "Solicitó renovación (sobre el tope de $100.000)"
          : "Solicitó renovación (sobre el tope del tramo)",
        entidad: "cliente",
        entidadId: input.clienteId,
        detalle: `${UYU(monto)} × ${totalDias} (${input.frecuencia}) — espera aprobación del admin`,
      });
      revalidatePath("/admin/renovaciones");
      return { ok: true, via: "solicitud" };
    } catch (e) {
      if ((e as { code?: string } | null)?.code === "23505")
        return { ok: false, error: "Ya hay una solicitud pendiente para este crédito." };
      return { ok: false, error: "No se pudo enviar la solicitud. Probá de nuevo." };
    }
  }

  // Auto-aprobable, o ADMIN autorizando (tramo o CAP) — él es el aprobador.
  const res = await crearRenovacion(db, {
    clienteId: input.clienteId,
    prestamoAnteriorId: input.prestamoAnteriorId,
    monto,
    totalDias,
    frecuencia: input.frecuencia,
    creadoPor: usuario.id,
    // Solo cuando de verdad hace falta, no "porque es admin": con el techo
    // absoluto de arriba ya validado, esto no puede pasar del monto anterior.
    permitirSobreCap: admin && monto > RENOVACION_CAP_TOTAL,
  });
  if (!res.ok) return res;
  // Si este crédito tenía una SOLICITUD pendiente y se renovó por alta directa, se
  // cierra para que no quede huérfana apuntando a un crédito ya finalizado
  // (best-effort: el crédito ya está creado, esto es solo limpieza de la cola).
  try {
    if (res.prestamoId) await cerrarSolicitudPendienteDeAnterior(db, input.prestamoAnteriorId, res.prestamoId, usuario.id);
  } catch { /* no bloquea la renovación ya hecha */ }
  await registrarAuditoria(db, {
    actorId: usuario.id,
    actorNombre: usuario.nombre,
    accion: evalu.autoAprobable
      ? "Renovó crédito (auto, dentro del tope)"
      : evalu.superaCap
        ? "Renovó crédito (admin, POR ENCIMA del tope de $100.000)"
        : "Renovó crédito (admin, sobre el tope del tramo)",
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

// ── Flujo de APROBACIÓN (supervisor solicita → admin resuelve) ─────────────
// La CREACIÓN de solicitudes vive dentro de renovarCredito (supervisor sobre-tope),
// que pasa por todos los gates (CAP, tramo, saldado, kill-switch). No hay una acción
// `solicitarRenovacion` suelta (se removió: era código muerto con validación más débil
// que habría permitido solicitudes sobre-CAP imposibles de aprobar).

/** El ADMIN aprueba: crea el crédito de renovación y cierra la solicitud. */
export async function aprobarSolicitud(id: string): Promise<ResultadoAlta> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol))
    return { ok: false, error: "Solo el administrador aprueba renovaciones." };
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
    if (!ant || ant.estado !== "activo")
      return { ok: false, error: "El crédito anterior ya no está activo." };
    const techoAbsoluto = techoRenovacion(ant.monto_prestado);
    if (s.monto > techoAbsoluto)
      return {
        ok: false,
        error: `El monto pedido (${UYU(s.monto)}) no corresponde a este crédito: el máximo es ${UYU(techoAbsoluto)}. Rechazá la solicitud y que la vuelvan a pedir bien.`,
      };

    const res = await crearRenovacion(db, {
      clienteId: s.clienteId,
      prestamoAnteriorId: s.prestamoAnteriorId,
      monto: s.monto,
      totalDias: s.totalDias,
      frecuencia: s.frecuencia,
      creadoPor: u.id,
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
      await resolverSolicitudDb(db, id, { estado: "aprobada", resueltoPor: u.id, prestamoNuevoId: res.prestamoId });
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
    revalidatePath("/admin/renovaciones");
    revalidatePath("/admin/mora");
    revalidatePath("/admin");
    return res;
  } catch {
    return { ok: false, error: "No se pudo aprobar. Probá de nuevo." };
  }
}

/** El ADMIN rechaza una solicitud (con motivo opcional). */
export async function rechazarSolicitud(id: string, motivo: string): Promise<ResultadoSimple> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol))
    return { ok: false, error: "Solo el administrador resuelve renovaciones." };
  try {
    const db = await createSupabaseServer();
    await resolverSolicitudDb(db, id, {
      estado: "rechazada",
      resueltoPor: u.id,
      motivoRechazo: (motivo ?? "").trim().slice(0, 300) || null,
    });
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Rechazó renovación",
      entidad: "solicitud",
      entidadId: id,
      detalle: (motivo ?? "").slice(0, 120),
    });
    revalidatePath("/admin/renovaciones");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo rechazar." };
  }
}
