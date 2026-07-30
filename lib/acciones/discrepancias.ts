"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — TRIAGE de una discrepancia de dinero (0109). Solo ADMIN.
//  El admin marca una divergencia detectada como en_progreso/resuelto/aceptado
//  con una nota → deja de reclamar atención en el panel y queda la traza (quién,
//  cuándo, por qué). NO toca dinero (es una anotación), así que NO se congela con
//  el kill-switch: anotar es parte de investigar un freeze.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { esUuid } from "@/lib/idempotencia";
import { upsertDiscrepanciaDb, ESTADOS_DISCREPANCIA, type EstadoDiscrepancia } from "@/lib/data/discrepancias";
import { registrarAuditoria } from "@/lib/data/auditoria";

type Resultado = { ok: true } | { ok: false; error: string };

export async function resolverDiscrepancia(input: {
  creditoId: string;
  estado: string;
  nota?: string | null;
  /** Snapshot del hallazgo (para guardar al abrir el triage). */
  tipo?: string | null;
  montoDiferencia?: number | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(input.creditoId)) return { ok: false, error: "Crédito inválido." };
  if (!ESTADOS_DISCREPANCIA.includes(input.estado as EstadoDiscrepancia)) {
    return { ok: false, error: "Estado inválido." };
  }
  const nota = (input.nota ?? "").toString().trim().slice(0, 500) || null;
  try {
    const db = await createSupabaseServer();
    await upsertDiscrepanciaDb(db, {
      creditoId: input.creditoId,
      estado: input.estado as EstadoDiscrepancia,
      nota,
      tipo: input.tipo ?? null,
      montoDiferencia: typeof input.montoDiferencia === "number" ? Math.round(input.montoDiferencia) : null,
      adminId: u.id,
      ahoraIso: new Date().toISOString(),
    });
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: `Triage de discrepancia (${input.estado})`,
      entidad: "discrepancia",
      entidadId: input.creditoId,
      detalle: nota ? nota.slice(0, 200) : undefined,
    });
    revalidatePath("/admin/empalme");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar el triage. Probá de nuevo. (¿Falta correr la migración 0109?)" };
  }
}
