"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — RIFA (admin). Configurar el banner de la rifa (mensaje,
//  premio, botón), subir la foto del premio, dirigirla a los mejores clientes y
//  encenderla/apagarla. Solo ADMIN. Queda en auditoría.
// ─────────────────────────────────────────────────────────────────────────
import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { guardarRifaDb, subirFotoRifa, getParticipacionesRifa, cerrarRifaDb, type ParticipanteRifa } from "@/lib/data/rifas";
import { esUuid } from "@/lib/idempotencia";
import { normalizarSegmento, esSegmentoTodos, type DefinicionSegmento } from "@/lib/segmentos";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";

type Resultado = { ok: true } | { ok: false; error: string };

/**
 * SORTEA la rifa: elige un ganador entre los participantes REALES (al azar del
 * servidor, garantiza que gane alguien) o el que el admin elija, la cierra y emite
 * el folio del comprobante del ganador. Idempotente (si ya está cerrada, no re-sortea).
 */
export async function sortearRifa(input: {
  rifaId: string;
  ganadorClienteId?: string | null;
}): Promise<{ ok: true; ganadorNombre: string; numero: number; folio: number | null } | { ok: false; error: string }> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return { ok: false, error: "Solo el administrador puede sortear la rifa." };
  if (!esUuid(input.rifaId)) return { ok: false, error: "Rifa inválida." };
  // Kill switch: sortear ADJUDICA un premio (gasto) y cierra la rifa. En freeze, no.
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;
  try {
    const db = await createSupabaseServer();
    const participantes = await getParticipacionesRifa(db, input.rifaId);
    if (participantes.length === 0) return { ok: false, error: "Todavía no hay participantes para sortear." };
    let ganador: ParticipanteRifa;
    if (input.ganadorClienteId) {
      const g = participantes.find((p) => p.clienteId === input.ganadorClienteId);
      if (!g) return { ok: false, error: "Ese cliente no está entre los participantes." };
      ganador = g;
    } else {
      ganador = participantes[randomInt(participantes.length)]; // azar del servidor
    }
    const folio = await cerrarRifaDb(db, input.rifaId, ganador.clienteId, ganador.numero);
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre,
      accion: "Sorteó la rifa", entidad: "promo", entidadId: input.rifaId,
      detalle: `Ganador: ${ganador.clienteNombre} (N.º ${ganador.numero})`,
    });
    revalidatePath("/admin/rifa");
    return { ok: true, ganadorNombre: ganador.clienteNombre, numero: ganador.numero, folio };
  } catch {
    return { ok: false, error: "No se pudo sortear. Probá de nuevo." };
  }
}

export async function guardarRifa(input: {
  id?: string | null;
  titulo: string;
  mensaje: string;
  premioTexto: string | null;
  botonTexto: string;
  soloMejores: boolean;
  /** Audiencia rica (0089). Si viene con reglas, MANDA sobre soloMejores. */
  segmentoDef?: DefinicionSegmento | null;
  activo: boolean;
  /** Foto del premio (data URL comprimido). Opcional: si no viene, no se toca. */
  fotoDataUrl?: string | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return { ok: false, error: "Solo el administrador puede configurar la rifa." };

  const titulo = (input.titulo ?? "").trim().slice(0, 80) || "Gran rifa";
  const mensaje = (input.mensaje ?? "").trim().slice(0, 400);
  const premioTexto = (input.premioTexto ?? "").trim().slice(0, 200) || null;
  const botonTexto = (input.botonTexto ?? "").trim().slice(0, 30) || "Ver premio";

  const defRaw = normalizarSegmento(input.segmentoDef ?? {});
  const segmentoDef = esSegmentoTodos(defRaw) ? null : defRaw;

  try {
    const db = await createSupabaseServer();
    const id = await guardarRifaDb(db, {
      id: input.id ?? null,
      titulo,
      mensaje,
      premioTexto,
      botonTexto,
      soloMejores: Boolean(input.soloMejores),
      segmentoDef,
      activo: Boolean(input.activo),
    });
    // Foto del premio (si el admin cargó una nueva).
    if (input.fotoDataUrl) {
      const foto = await subirFotoRifa(id, input.fotoDataUrl);
      if (!foto.ok) return { ok: false, error: foto.error };
    }
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Configuró la rifa",
      entidad: "promo",
      entidadId: id,
      detalle: `${titulo}${input.activo ? " (activa)" : " (apagada)"}`,
    });
    revalidatePath("/admin/rifa");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar la rifa. Probá de nuevo." };
  }
}
