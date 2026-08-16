"use server";
// ─────────────────────────────────────────────────────────────────────────
//  CANCELAR una venta MALA desde el PANEL (queja del admin, 16-08: "poder
//  eliminar ventas que se hagan malas").
//
//  Los créditos NUNCA se borran (P0403): se CANCELAN (estado "cancelado"). El
//  colocado del día, el arrastre de caja, el informe y la ficha ya excluyen ese
//  estado. La regla pura `puedeCancelarVentaPanel` (lib/creditoNuevo) es la
//  MISMA en la pantalla y acá: sin pagos vigentes (si hay, se ANULAN primero
//  uno por uno — el libro no se toca en silencio), nunca cartera importada,
//  tienda solo admin, supervisor solo en su alcance. Sin ventana de tiempo.
//
//  Efectos colaterales que SÍ se limpian (mapa de la auditoría 16-08):
//   · RENOVACIÓN: se reabre el crédito anterior (finalizado→activo) SOLO si lo
//     finalizó esta renovación (±5 min) y no tiene OTRA renovación activa —
//     por service_role, la única vía que puede "volver atrás" (0126), igual
//     que la compensación de crearRenovacion.
//   · SOLICITUD aprobada que generó este crédito → 'rechazada' con motivo
//     ("la oficina canceló: NO entregues la plata") — Mis pedidos del cobrador
//     deja de decir "entregale la plata".
//   · TIENDA: stock +1 si se controla, y el lead 'convertida' → 'descartada'.
//   · Día ya RENDIDO por el cobrador: se permite, y la auditoría deja escrito
//     cuánto debe devolver (aparece en su base de mañana por el arrastre).
//  Auditoría siempre, con el motivo (obligatorio, ≥5 caracteres).
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { alcanceDelActor } from "@/lib/data/alcance";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { reportarError } from "@/lib/observabilidad";
import { esUuid } from "@/lib/idempotencia";
import { puedeCancelarVentaPanel } from "@/lib/creditoNuevo";
import { UYU } from "@/lib/format";

export type ResultadoCancelar =
  | { ok: true; yaEstaba: boolean; reabrio: boolean; avisos: string[] }
  | { ok: false; error: string };

/** Lo que la ficha necesita para pintar el botón con la verdad (misma regla). */
export async function estadoCancelable(prestamoId: string): Promise<
  | { ok: true; pagosVigentes: number; pagadoVigente: number; esRenovacion: boolean; origen: string | null; puede: boolean; motivo: string | null }
  | { ok: false; error: string }
> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "Sin permisos." };
  if (!esUuid(prestamoId)) return { ok: false, error: "Crédito inválido." };
  const admin = createSupabaseAdmin();
  const { data: p, error } = await admin
    .from("prestamos")
    .select("id, cliente_id, estado, origen, renovado_de")
    .eq("id", prestamoId)
    .maybeSingle();
  if (error || !p) return { ok: false, error: "No se encontró el crédito." };
  const { count, error: e2 } = await admin
    .from("pagos")
    .select("*", { count: "exact", head: true })
    .eq("prestamo_id", prestamoId)
    .eq("anulado", false);
  if (e2) return { ok: false, error: "No pudimos leer los pagos." };
  const { data: sum } = await admin.from("pagos").select("monto").eq("prestamo_id", prestamoId).eq("anulado", false);
  const pagado = (sum ?? []).reduce((s, r) => s + Math.round(Number(r.monto) || 0), 0);
  const alcance = await alcanceDelActor();
  const enAlcance = alcance.global || alcance.clienteIds.includes(p.cliente_id as string);
  const v = puedeCancelarVentaPanel(
    { estado: p.estado as string, origen: (p.origen as string | null) ?? null, renovadoDe: (p.renovado_de as string | null) ?? null, pagosVigentes: count ?? 0, pagadoVigente: pagado },
    { rol: u.rol, enAlcance },
  );
  return {
    ok: true,
    pagosVigentes: count ?? 0,
    pagadoVigente: pagado,
    esRenovacion: p.renovado_de != null,
    origen: (p.origen as string | null) ?? null,
    puede: v.ok,
    motivo: v.ok ? null : v.motivo,
  };
}

export async function cancelarVentaPanel(input: {
  prestamoId: string;
  motivo: string;
}): Promise<ResultadoCancelar> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "Sin permisos." };
  if (!esUuid(input.prestamoId)) return { ok: false, error: "Crédito inválido." };
  const motivo = (input.motivo ?? "").toString().trim().slice(0, 300);
  if (motivo.length < 5) return { ok: false, error: "Escribí el motivo (al menos 5 letras): queda en la auditoría." };
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;

  try {
    const admin = createSupabaseAdmin();
    const db = await createSupabaseServer();
    const { data: p, error } = await admin
      .from("prestamos")
      .select("id, cliente_id, cobrador_id, creado_por, creado_en, estado, origen, renovado_de, monto_prestado, producto_id, producto_nombre")
      .eq("id", input.prestamoId)
      .maybeSingle();
    if (error) throw error;
    if (!p) return { ok: false, error: "No se encontró el crédito." };

    // Pagos vigentes SE RE-CUENTAN acá (no confiar en la pantalla): la cola
    // offline de un cobrador puede haber subido uno hace un segundo.
    const { data: pagos, error: e2 } = await admin
      .from("pagos")
      .select("monto")
      .eq("prestamo_id", p.id)
      .eq("anulado", false);
    if (e2) throw e2;
    const pagosVigentes = (pagos ?? []).length;
    const pagadoVigente = (pagos ?? []).reduce((s, r) => s + Math.round(Number(r.monto) || 0), 0);

    const alcance = await alcanceDelActor();
    const enAlcance = alcance.global || alcance.clienteIds.includes(p.cliente_id as string);
    const v = puedeCancelarVentaPanel(
      { estado: p.estado as string, origen: (p.origen as string | null) ?? null, renovadoDe: (p.renovado_de as string | null) ?? null, pagosVigentes, pagadoVigente },
      { rol: u.rol, enAlcance },
    );
    if (!v.ok) return { ok: false, error: v.motivo };
    if (v.yaEstaba) return { ok: true, yaEstaba: true, reabrio: false, avisos: [] };

    const avisos: string[] = [];
    const monto = Math.round(Number(p.monto_prestado) || 0);

    // 1) El crédito → cancelado. Con la sesión del GESTOR (RLS + trigger 0126
    //    valen como cinturón: activo→cancelado está permitido al gestor). El
    //    .eq("estado","activo") es el candado de carrera: si otro lo canceló o
    //    finalizó entre la lectura y acá, 0 filas → se relee y se decide.
    const { data: upd, error: e3 } = await db
      .from("prestamos")
      .update({ estado: "cancelado" })
      .eq("id", p.id)
      .eq("estado", "activo")
      .select("id");
    if (e3) throw e3;
    if (!upd || upd.length === 0) {
      const { data: re } = await admin.from("prestamos").select("estado").eq("id", p.id).maybeSingle();
      if (re?.estado === "cancelado") return { ok: true, yaEstaba: true, reabrio: false, avisos: [] };
      return { ok: false, error: `El crédito cambió de estado mientras tanto (${re?.estado ?? "?"}). Recargá la ficha.` };
    }

    // 2) RENOVACIÓN: reabrir el anterior SOLO si lo finalizó esta renovación
    //    (finalizado_en dentro de ±5 min de creado_en) y no tiene otra
    //    renovación activa. Por service_role (0126: solo la vía de confianza
    //    puede volver atrás — mismo patrón que la compensación).
    let reabrio = false;
    if (p.renovado_de) {
      const { data: ant } = await admin
        .from("prestamos")
        .select("id, estado, finalizado_en, monto_prestado")
        .eq("id", p.renovado_de as string)
        .maybeSingle();
      const { count: otras } = await admin
        .from("prestamos")
        .select("*", { count: "exact", head: true })
        .eq("renovado_de", p.renovado_de as string)
        .eq("estado", "activo");
      const dt = ant?.finalizado_en && p.creado_en ? Math.abs(new Date(ant.finalizado_en as string).getTime() - new Date(p.creado_en as string).getTime()) : Infinity;
      if (ant && ant.estado === "finalizado" && dt <= 5 * 60_000 && (otras ?? 0) === 0) {
        const { error: e4 } = await admin.from("prestamos").update({ estado: "activo", finalizado_en: null }).eq("id", ant.id).eq("estado", "finalizado");
        if (e4) reportarError("cancelarVentaPanel.reabrir", e4, { prestamoId: p.id, anterior: ant.id });
        else { reabrio = true; avisos.push(`Se reabrió el crédito anterior de ${UYU(Math.round(Number(ant.monto_prestado) || 0))} (quedó activo, saldado: se puede volver a renovar bien).`); }
      } else if (ant) {
        avisos.push("El crédito anterior NO se reabrió (no lo finalizó esta renovación, o ya tiene otra renovación activa). Revisalo en la ficha.");
      }
    }

    // 3) SOLICITUD aprobada que generó este crédito → rechazada con el motivo:
    //    Mis pedidos del cobrador deja de decir "entregale la plata".
    try {
      const { data: sol } = await admin
        .from("solicitudes_renovacion")
        .update({ estado: "rechazada", motivo_rechazo: `La oficina CANCELÓ ese crédito (${UYU(monto)}): NO entregues la plata. ${motivo}`.slice(0, 300), resuelto_por: u.id, resuelto_en: new Date().toISOString() })
        .eq("prestamo_nuevo_id", p.id)
        .eq("estado", "aprobada")
        .select("id");
      if (sol && sol.length > 0) avisos.push("El pedido aprobado del cobrador quedó rechazado con el aviso de NO entregar la plata.");
    } catch (e) {
      reportarError("cancelarVentaPanel.solicitud", e, { prestamoId: p.id });
    }

    // 4) TIENDA: stock +1 si se controla, y el lead convertido → descartado.
    if (p.origen === "tienda") {
      try {
        if (p.producto_id) {
          const { data: prod } = await admin.from("productos").select("stock").eq("id", p.producto_id as string).maybeSingle();
          if (prod && prod.stock != null) {
            await admin.from("productos").update({ stock: Number(prod.stock) + 1 }).eq("id", p.producto_id as string);
            avisos.push("Se devolvió 1 unidad al stock del producto.");
          }
        }
        await admin
          .from("solicitudes_producto")
          .update({ estado: "descartada", nota: `Venta cancelada por la oficina: ${motivo}`.slice(0, 300), resuelto_por: u.id, resuelto_en: new Date().toISOString() })
          .eq("prestamo_id", p.id)
          .eq("estado", "convertida");
      } catch (e) {
        reportarError("cancelarVentaPanel.tienda", e, { prestamoId: p.id });
      }
    }

    // 5) ¿El cobrador YA rindió ese día? El acta congeló el colocado: se permite,
    //    pero queda escrito cuánto debe devolver (su base de mañana lo va a
    //    reflejar por el arrastre).
    try {
      const creado = new Date(p.creado_en as string);
      const ymd = new Date(creado.getTime() - 3 * 3600_000).toISOString().slice(0, 10); // día UY (corte 03:00Z)
      const { count: rend } = await admin
        .from("rendiciones")
        .select("*", { count: "exact", head: true })
        .eq("cobrador_id", (p.creado_por ?? p.cobrador_id) as string)
        .eq("fecha", ymd);
      if ((rend ?? 0) > 0) avisos.push(`Ese día ya estaba rendido: el cobrador debe devolver ${UYU(monto)} (le va a aparecer en la base de mañana).`);
    } catch { /* informativo */ }

    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: reabrio ? "Canceló una renovación y reabrió el crédito anterior" : "Canceló una venta desde el panel",
      entidad: "prestamo",
      entidadId: p.id,
      detalle: `${UYU(monto)}${p.producto_nombre ? ` · ${p.producto_nombre}` : ""} · motivo: ${motivo}${avisos.length ? ` · ${avisos.join(" ")}` : ""}`.slice(0, 500),
    });
    revalidatePath(`/admin/clientes/${p.cliente_id as string}`);
    revalidatePath("/admin/movimientos");
    revalidatePath("/admin");
    return { ok: true, yaEstaba: false, reabrio, avisos };
  } catch (e) {
    reportarError("cancelarVentaPanel", e, { prestamoId: input.prestamoId });
    return { ok: false, error: "No se pudo cancelar. Probá de nuevo." };
  }
}
