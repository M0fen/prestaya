"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — TOPE MENSUAL de gasto en premios (0130). Solo admin: es
//  una decisión de plata del dueño, no de operación.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { UYU } from "@/lib/format";

type Resultado = { ok: true } | { ok: false; error: string };

export async function setTopeMensualJuegos(tope: number): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return { ok: false, error: "Solo el administrador define el tope." };
  const valor = Math.max(0, Math.min(100_000_000, Math.round(Number(tope) || 0)));
  try {
    const db = await createSupabaseServer();
    const { error } = await db
      .from("presupuesto_juegos")
      .update({ tope_mensual: valor, actualizado_por: u.id, actualizado_en: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw error;
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Fijó el tope mensual de premios",
      entidad: "promo",
      detalle: valor > 0 ? UYU(valor) : "sin tope",
    });
    revalidatePath("/admin/promos");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar el tope. ¿Corriste la migración 0130?" };
  }
}
