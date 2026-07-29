"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — BASE DE CAJA (0105): el gestor fija con qué efectivo arranca
//  un cobrador el día. La RLS (0105) lo acota a su zona (admin = todos). No es
//  un pago (es efectivo bajo custodia que el cobrador devuelve al cerrar), así
//  que se puede corregir durante el día (upsert por cobrador+fecha). Auditado.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { esUuid } from "@/lib/idempotencia";
import { setAperturaDb } from "@/lib/data/aperturas";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { UYU } from "@/lib/format";

type Resultado = { ok: true } | { ok: false; error: string };

/** Fija (o corrige) la base de arranque de HOY de un cobrador. Solo gestor; la
 *  RLS acota al supervisor a su zona. Tope de $1.000.000 por prudencia. */
export async function setApertura(input: {
  cobradorId: string;
  base: number;
  nota?: string | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(input.cobradorId)) return { ok: false, error: "Cobrador inválido." };
  const base = Math.max(0, Math.min(1_000_000, Math.round(Number(input.base) || 0)));
  const nota = (input.nota ?? "").trim().slice(0, 200) || null;
  try {
    const db = await createSupabaseServer();
    await setAperturaDb(db, { cobradorId: input.cobradorId, base, entregadaPor: u.id, nota });
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Fijó la base de caja de un cobrador",
      entidad: "caja",
      entidadId: input.cobradorId,
      detalle: `Base ${UYU(base)}`,
    });
    revalidatePath("/admin/jornada");
    revalidatePath("/admin");
    revalidatePath("/cobrador");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo fijar la base. Probá de nuevo." };
  }
}
