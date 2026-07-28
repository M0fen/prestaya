"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — emitir RECIBO a un trabajador (solo ADMIN). Comprobante
//  interno de pago (no factura fiscal). Queda numerado + en auditoría.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { crearReciboDb, type Recibo } from "@/lib/data/recibos";

export type ResultadoRecibo = { ok: true; recibo: Recibo } | { ok: false; error: string };

export async function emitirRecibo(input: {
  trabajadorId: string | null;
  trabajadorNombre: string;
  concepto: string;
  monto: number;
  periodo?: string | null;
  nota?: string | null;
}): Promise<ResultadoRecibo> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return { ok: false, error: "Solo el administrador emite recibos." };

  const trabajadorNombre = (input.trabajadorNombre ?? "").trim().slice(0, 120);
  const concepto = (input.concepto ?? "").trim().slice(0, 80);
  const monto = Math.round((Number(input.monto) || 0) * 100) / 100;
  if (!trabajadorNombre) return { ok: false, error: "Elegí el trabajador." };
  if (!concepto) return { ok: false, error: "Poné el concepto (comisión, sueldo…)." };
  if (!(monto > 0)) return { ok: false, error: "El monto debe ser mayor a 0." };

  try {
    const db = await createSupabaseServer();
    const recibo = await crearReciboDb(db, {
      trabajadorId: input.trabajadorId ?? null,
      trabajadorNombre,
      concepto,
      monto,
      periodo: (input.periodo ?? "").trim().slice(0, 120) || null,
      nota: (input.nota ?? "").trim().slice(0, 300) || null,
      emitidoPor: u.id,
      emitidoPorNombre: u.nombre,
    });
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Emitió un recibo a un trabajador",
      entidad: "recibo",
      entidadId: recibo.id,
      detalle: `#${recibo.numero} · ${trabajadorNombre} · ${concepto} · ${monto}`,
    });
    revalidatePath("/admin/recibos");
    return { ok: true, recibo };
  } catch {
    return { ok: false, error: "No se pudo emitir el recibo. Probá de nuevo." };
  }
}
