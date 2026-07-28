"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — fijar la META de recaudo mensual (gestores). Es un objetivo,
//  no toca dinero. Queda auditado. Degrada con aviso si falta la migración 0025.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { setMetaMensual } from "@/lib/data/metaOperacion";
import { registrarAuditoria } from "@/lib/data/auditoria";

type Resultado = { ok: true } | { ok: false; error: string };

export async function guardarMetaMensual(meta: number): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  const m = Math.max(0, Math.round(Number(meta) || 0));

  try {
    const db = await createSupabaseServer();
    await setMetaMensual(db, m, u.id);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Fijó meta mensual",
      entidad: "operacion",
      detalle: `Meta de recaudo mensual: $${m.toLocaleString("es-UY")}`,
    });
    revalidatePath("/admin/cierre");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
}
