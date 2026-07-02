"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions del CHAT interno. Compartidas por el panel admin y la app
//  del cobrador. Corren con la sesión del usuario → el RLS de 0007 valida el
//  canal y que el autor sea uno mismo. Acá solo resolvemos el canal y validamos
//  el texto.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import {
  CANAL_GENERAL,
  enviarMensajeDb,
  marcarLeidoDb,
  canalCobrador,
  borrarMensajesCanal,
} from "@/lib/data/chat";
import { registrarAuditoria } from "@/lib/data/auditoria";
import type { AmbitoMensaje } from "@/types/db";

type Resultado = { ok: true } | { ok: false; error: string };

/** Traduce una clave de canal ('general' | 'cob:<id>') a ámbito + cobradorId. */
function parseCanal(key: string): { ambito: AmbitoMensaje; cobradorId: string | null } | null {
  if (key === CANAL_GENERAL) return { ambito: "general", cobradorId: null };
  if (key.startsWith("cob:")) {
    const id = key.slice(4);
    return id ? { ambito: "cobrador", cobradorId: id } : null;
  }
  return null;
}

export async function enviarMensaje(input: {
  canal: string;
  cuerpo: string;
}): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo) return { ok: false, error: "Sesión no válida." };

  const cuerpo = (input.cuerpo ?? "").trim();
  if (cuerpo.length === 0) return { ok: false, error: "Escribí un mensaje." };
  if (cuerpo.length > 2000) return { ok: false, error: "El mensaje es muy largo." };

  const canal = parseCanal(input.canal);
  if (!canal) return { ok: false, error: "Canal inválido." };

  // Un cobrador solo puede escribir en su propio hilo (además del general);
  // el RLS lo garantiza, pero forzamos el destino para que no falle en silencio.
  const cobradorId =
    canal.ambito === "cobrador" && !esGestor(usuario.rol) ? usuario.id : canal.cobradorId;

  try {
    const db = await createSupabaseServer();
    await enviarMensajeDb(db, {
      ambito: canal.ambito,
      cobradorId,
      autorId: usuario.id,
      cuerpo,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo enviar. Probá de nuevo." };
  }
}

/** Vacía (borra) todos los mensajes del canal activo. SOLO admin. Corre con
 *  service_role tras verificar el rol (evita depender de una política de delete
 *  en RLS). Acción destructiva e irreversible. */
export async function vaciarCanal(canal: string): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo) return { ok: false, error: "Sesión no válida." };
  if (usuario.rol !== "admin") return { ok: false, error: "Solo el administrador puede vaciar el chat." };

  const parsed = parseCanal(canal);
  if (!parsed) return { ok: false, error: "Canal inválido." };

  try {
    const db = createSupabaseAdmin();
    await borrarMensajesCanal(db, parsed.ambito, parsed.cobradorId);
    await registrarAuditoria(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      accion: "Vació canal de chat",
      entidad: "chat",
      entidadId: canal,
      detalle: `Borró los mensajes del canal "${canal}"`,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo vaciar el chat." };
  }
}

export async function marcarCanalLeido(canal: string): Promise<void> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo) return;
  const parsed = parseCanal(canal);
  if (!parsed) return;
  // Normaliza la clave del cobrador a la suya si no es gestor.
  const key =
    parsed.ambito === "cobrador" && !esGestor(usuario.rol)
      ? canalCobrador(usuario.id)
      : canal;
  const db = await createSupabaseServer();
  await marcarLeidoDb(db, usuario.id, key);
}
