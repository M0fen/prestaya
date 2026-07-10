"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — COMISIONES (solo gestores).
//   · setComisionPct: fija la tasa (%) de un cobrador.
//   · liquidarComision: paga la comisión del período → EGRESO en caja
//     (categoría "Comisión") + queda en la auditoría. Los cobros no se tocan.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { setComisionPctDb } from "@/lib/data/comisiones";
import { registrarMovimientoCaja } from "@/lib/data/caja";
import { registrarAuditoria } from "@/lib/data/auditoria";

type Resultado = { ok: true } | { ok: false; error: string };

export async function setComisionPct(cobradorId: string, pct: number): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol))
    return { ok: false, error: "Solo el administrador puede fijar comisiones." };
  if (!cobradorId) return { ok: false, error: "Cobrador inválido." };
  // Acota [0,100] con 2 decimales.
  const p = Math.max(0, Math.min(100, Math.round((Number(pct) || 0) * 100) / 100));

  try {
    const db = await createSupabaseServer();
    await setComisionPctDb(db, cobradorId, p);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Cambió comisión",
      entidad: "cobrador",
      entidadId: cobradorId,
      detalle: `Comisión fijada en ${p}%`,
    });
    revalidatePath("/admin/comisiones");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. ¿Corriste la migración 0014?" };
  }
}

export async function liquidarComision(input: {
  cobradorId: string;
  nombre: string;
  monto: number;
  periodo: string; // etiqueta legible (para la descripción)
  periodoKey: string; // clave canónica (candado idempotente)
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol))
    return { ok: false, error: "Solo el administrador puede liquidar comisiones." };
  const monto = Math.round(Number(input.monto) || 0);
  if (!(monto > 0)) return { ok: false, error: "La comisión es cero." };
  if (!input.periodoKey) return { ok: false, error: "Período inválido." };

  const db = await createSupabaseServer();

  // CANDADO: registrar la liquidación ANTES de tocar la caja. El unique
  // (cobrador, período) hace que un segundo intento (doble clic / ya liquidado)
  // falle con 23505 → nunca se paga dos veces la misma comisión.
  const { error: eLiq } = await db.from("comisiones_liquidadas").insert({
    cobrador_id: input.cobradorId,
    periodo_key: input.periodoKey,
    monto,
    liquidado_por: u.id,
    liquidado_por_nombre: u.nombre,
  });
  if (eLiq) {
    if ((eLiq as { code?: string }).code === "23505")
      return { ok: false, error: "Esa comisión ya se liquidó en este período." };
    return { ok: false, error: "No se pudo liquidar. ¿Corriste la migración 0049?" };
  }

  try {
    await registrarMovimientoCaja(db, {
      tipo: "egreso",
      monto,
      categoria: "Comisión",
      descripcion: `Comisión ${input.periodo} · ${input.nombre}`,
      cobradorId: input.cobradorId,
      registradoPor: u.id,
    });
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Liquidó comisión",
      entidad: "cobrador",
      entidadId: input.cobradorId,
      detalle: `${input.nombre}: $${monto.toLocaleString("es-UY")} (${input.periodo})`,
    });
    revalidatePath("/admin/comisiones");
    revalidatePath("/admin/caja");
    return { ok: true };
  } catch {
    // La caja falló DESPUÉS del candado → revertir para no dejar "liquidado"
    // sin el egreso (si no, quedaría marcado pagado sin haber salido de caja).
    await db
      .from("comisiones_liquidadas")
      .delete()
      .eq("cobrador_id", input.cobradorId)
      .eq("periodo_key", input.periodoKey);
    return { ok: false, error: "No se pudo registrar el egreso. ¿Corriste la migración 0010?" };
  }
}
