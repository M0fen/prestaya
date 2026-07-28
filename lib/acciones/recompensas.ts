"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — RECOMPENSAS del gaming (solo gestores). Crear, activar/
//  desactivar y borrar premios ligados a hitos de pago. Queda en la auditoría.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import {
  crearRecompensa,
  actualizarRecompensa,
  borrarRecompensa,
} from "@/lib/data/recompensas";
import { registrarAuditoria } from "@/lib/data/auditoria";
import type { HitoTipo } from "@/lib/recompensas";

type Resultado = { ok: true } | { ok: false; error: string };
const HITOS: HitoTipo[] = ["racha", "mes_al_dia", "credito_completo", "nivel"];

async function gestor() {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return null;
  return u;
}

export async function agregarRecompensa(input: {
  titulo: string;
  premio: string;
  hitoTipo: string;
  hitoValor: number;
  orden: number;
}): Promise<Resultado> {
  const u = await gestor();
  if (!u) return { ok: false, error: "No tenés permisos." };
  const titulo = (input.titulo ?? "").trim().slice(0, 60);
  const premio = (input.premio ?? "").trim().slice(0, 120);
  if (!titulo || !premio) return { ok: false, error: "Completá título y premio." };
  const hitoTipo = (HITOS.includes(input.hitoTipo as HitoTipo) ? input.hitoTipo : "racha") as HitoTipo;

  try {
    const db = await createSupabaseServer();
    await crearRecompensa(db, {
      titulo,
      premio,
      hitoTipo,
      hitoValor: Math.max(0, Math.round(Number(input.hitoValor) || 0)),
      orden: Math.round(Number(input.orden) || 0),
    });
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre,
      accion: "Creó recompensa", entidad: "gaming", detalle: `${titulo} → ${premio}`,
    });
    revalidatePath("/admin/juego");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
}

export async function alternarRecompensa(id: string, activo: boolean): Promise<Resultado> {
  const u = await gestor();
  if (!u) return { ok: false, error: "No tenés permisos." };
  try {
    const db = await createSupabaseServer();
    await actualizarRecompensa(db, id, { activo });
    revalidatePath("/admin/juego");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo actualizar." };
  }
}

export async function eliminarRecompensa(id: string): Promise<Resultado> {
  const u = await gestor();
  if (!u) return { ok: false, error: "No tenés permisos." };
  try {
    const db = await createSupabaseServer();
    await borrarRecompensa(db, id);
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre,
      accion: "Borró recompensa", entidad: "gaming", entidadId: id,
    });
    revalidatePath("/admin/juego");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo borrar." };
  }
}
