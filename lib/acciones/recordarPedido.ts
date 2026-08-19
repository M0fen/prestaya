"use server";
// ─────────────────────────────────────────────────────────────────────────
//  "Recordarle a mi supervisor" (quejas del piloto 19-08).
//
//  Un pedido de la calle (renovación/venta sobre el techo) podía quedar días
//  esperando sin que nadie lo viera: la solicitud nacía muda y el cobrador no
//  tenía cómo empujarla salvo por fuera de la app. Este botón manda el aviso
//  por TRES canales a la vez — para que al menos uno llegue aunque el push no
//  esté activado (0 suscripciones medidas en la base):
//   1. PUSH a los supervisores de la zona + admins (si tienen avisos activos).
//   2. MENSAJE en el canal de CHAT de la zona (toast realtime en el panel +
//      badge del chat: eso SÍ lo ve cualquiera que tenga el panel abierto).
//   3. Devuelve el link de WhatsApp del supervisor de la zona con el texto ya
//      armado, por si quiere empujarlo él mismo.
//  Anti-spam: un recordatorio por pedido cada 2 horas.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual } from "@/lib/auth";
import { esUuid } from "@/lib/idempotencia";
import { enviarMensajeDb } from "@/lib/data/chat";
import { avisarGestoresDeCobrador } from "@/lib/push/avisarGestores";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { reportarError } from "@/lib/observabilidad";
import { UYU } from "@/lib/format";
import { soloDigitos } from "@/lib/telefono";

const CADA_MS = 2 * 60 * 60 * 1000;

export type ResultadoRecordar =
  | { ok: true; avisados: number; chat: boolean; whatsapp: string | null; supervisorNombre: string | null }
  | { ok: false; error: string };

export async function recordarPedido(input: { solicitudId: string }): Promise<ResultadoRecordar> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || u.rol !== "cobrador") return { ok: false, error: "Esta acción es de la app del cobrador." };
  if (!esUuid(input.solicitudId)) return { ok: false, error: "Pedido inválido." };
  try {
    const admin = createSupabaseAdmin();
    const { data: s, error } = await admin
      .from("solicitudes_renovacion")
      .select("id, cliente_id, monto, tipo, estado, solicitado_por, solicitado_en, clientes(nombre)")
      .eq("id", input.solicitudId)
      .maybeSingle();
    if (error) throw error;
    if (!s || s.solicitado_por !== u.id) return { ok: false, error: "Ese pedido no es tuyo." };
    if (s.estado !== "pendiente") return { ok: false, error: "Ese pedido ya fue resuelto. Recargá para verlo." };

    // Anti-spam: último recordatorio de ESTE pedido en auditoría.
    const { data: ult } = await admin
      .from("auditoria")
      .select("creado_en")
      .eq("actor_id", u.id)
      .eq("entidad", "solicitud")
      .eq("entidad_id", s.id)
      .eq("accion", "Recordó un pedido al supervisor")
      .order("creado_en", { ascending: false })
      .limit(1);
    const ultMs = ult?.[0]?.creado_en ? new Date(ult[0].creado_en as string).getTime() : 0;
    if (Date.now() - ultMs < CADA_MS) {
      const faltan = Math.ceil((CADA_MS - (Date.now() - ultMs)) / 60_000);
      return { ok: false, error: `Ya le recordaste hace poco. Podés volver a hacerlo en ${faltan} min.` };
    }

    const clienteNombre = (s.clientes as { nombre?: string } | null)?.nombre ?? "un cliente";
    const monto = Math.round(Number(s.monto) || 0);
    const horas = Math.max(1, Math.round((Date.now() - new Date(s.solicitado_en as string).getTime()) / 3_600_000));
    const texto = `⏳ Recordatorio: ${u.nombre} espera hace ${horas} h la aprobación de ${s.tipo === "venta" ? "una venta" : "una renovación"} de ${UYU(monto)} para ${clienteNombre}. El cliente está esperando la plata.`;

    // 1) Push (si hay suscripciones).
    const avisados = await avisarGestoresDeCobrador(u.id, {
      titulo: "Pedido esperando tu aprobación",
      cuerpo: `${u.nombre}: ${UYU(monto)} para ${clienteNombre}, hace ${horas} h.`,
      url: "/admin/renovaciones",
      tag: `recordatorio-${s.id}`,
    });

    // 2) Chat de la zona (toast realtime + badge en el panel).
    let chat = false;
    try {
      const { data: yo } = await admin.from("usuarios").select("zona_id").eq("id", u.id).maybeSingle();
      const zonaId = (yo?.zona_id as string | null) ?? null;
      if (zonaId) {
        const db = await createSupabaseServer();
        await enviarMensajeDb(db, { ambito: "zona", cobradorId: null, zonaId, autorId: u.id, cuerpo: texto });
        chat = true;
      }
    } catch (e) {
      reportarError("recordarPedido.chat", e, { solicitudId: s.id });
    }

    // 3) WhatsApp del supervisor de la zona (el primero activo), con el texto armado.
    let whatsapp: string | null = null;
    let supervisorNombre: string | null = null;
    try {
      const { data: yo } = await admin.from("usuarios").select("zona_id").eq("id", u.id).maybeSingle();
      const zonaId = (yo?.zona_id as string | null) ?? null;
      if (zonaId) {
        const { data: sz } = await admin.from("supervisor_zonas").select("supervisor_id").eq("zona_id", zonaId);
        const ids = (sz ?? []).map((r) => r.supervisor_id as string);
        if (ids.length > 0) {
          const { data: sup } = await admin
            .from("usuarios")
            .select("nombre, telefono")
            .in("id", ids)
            .eq("activo", true)
            .not("telefono", "is", null)
            .limit(1)
            .maybeSingle();
          const tel = soloDigitos((sup?.telefono as string | null) ?? "");
          if (sup && tel.length >= 8) {
            supervisorNombre = sup.nombre as string;
            const intl = tel.startsWith("598") ? tel : `598${tel.replace(/^0/, "")}`;
            whatsapp = `https://wa.me/${intl}?text=${encodeURIComponent(texto + " Lo ves en Pedidos del panel.")}`;
          }
        }
      }
    } catch (e) {
      reportarError("recordarPedido.wa", e, { solicitudId: s.id });
    }

    await registrarAuditoria(admin, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Recordó un pedido al supervisor",
      entidad: "solicitud",
      entidadId: s.id,
      detalle: `${UYU(monto)} para ${clienteNombre} · hace ${horas} h · push ${avisados} · chat ${chat ? "sí" : "no"}`,
    });
    return { ok: true, avisados, chat, whatsapp, supervisorNombre };
  } catch (e) {
    reportarError("recordarPedido", e, { solicitudId: input.solicitudId });
    return { ok: false, error: "No se pudo mandar el recordatorio. Probá de nuevo." };
  }
}
