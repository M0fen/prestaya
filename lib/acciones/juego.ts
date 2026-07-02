"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — guardar los AJUSTES del gaming (solo gestores). Controla la
//  zona de juego que ven los clientes: encendido, juego del mes, meta, premio.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { actualizarAjustesJuego } from "@/lib/data/juegoConfig";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { JUEGOS } from "@/lib/juegos";
import type { AjustesJuego } from "@/lib/juegoAjustes";

type Resultado = { ok: true } | { ok: false; error: string };

export async function guardarAjustesJuego(input: AjustesJuego): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || !esGestor(usuario.rol)) {
    return { ok: false, error: "No tenés permisos." };
  }
  // Validación/saneo.
  const juegoActivo = JUEGOS[input.juegoActivo] ? input.juegoActivo : Object.keys(JUEGOS)[0];
  const metaRacha = Math.max(1, Math.min(60, Math.round(Number(input.metaRacha) || 10)));
  const limpio: AjustesJuego = {
    activo: Boolean(input.activo),
    juegoActivo,
    metaRacha,
    premioMeta: (input.premioMeta ?? "").trim().slice(0, 200) || "Beneficio en tu próximo crédito",
    mensajeBienvenida: (input.mensajeBienvenida ?? "").trim().slice(0, 200) || "¡Seguí así!",
    mostrarMisiones: Boolean(input.mostrarMisiones),
    temporadaActiva: Boolean(input.temporadaActiva),
    temporadaNombre: (input.temporadaNombre ?? "").trim().slice(0, 40),
    temporadaEmoji: (input.temporadaEmoji ?? "").trim().slice(0, 4) || "🏆",
    temporadaMeta: Math.max(1, Math.min(100, Math.round(Number(input.temporadaMeta) || 90))),
    temporadaPremio: (input.temporadaPremio ?? "").trim().slice(0, 120),
  };

  try {
    const db = await createSupabaseServer();
    await actualizarAjustesJuego(db, limpio);
    await registrarAuditoria(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      accion: "Cambió ajustes de gaming",
      entidad: "gaming",
      detalle: `Zona ${limpio.activo ? "activa" : "apagada"} · juego ${limpio.juegoActivo} · meta ${limpio.metaRacha}`,
    });
    revalidatePath("/admin/juego");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. ¿Corriste la migración 0009?" };
  }
}
