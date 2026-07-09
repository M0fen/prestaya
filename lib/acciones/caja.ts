"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — registrar un movimiento de CAJA (solo gestores).
//  Gastos, desembolsos, aportes de capital, retiros. Los cobros NO van por acá
//  (viven en `pagos`). RLS de 0010 exige gestor + autor = uno mismo.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { registrarMovimientoCaja, type TipoMovimiento, type CuentaCaja } from "@/lib/data/caja";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { UYU } from "@/lib/format";

const TIPOS: TipoMovimiento[] = ["ingreso", "egreso", "desembolso", "retiro"];
type Resultado = { ok: true } | { ok: false; error: string };

export async function agregarMovimientoCaja(input: {
  tipo: string;
  monto: number;
  categoria?: string | null;
  descripcion?: string | null;
  cobradorId?: string | null;
  /** operativa (default) | capital. La vista de Capital fuerza 'capital'. */
  cuenta?: string;
  visible?: boolean;
}): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || !esGestor(usuario.rol)) {
    return { ok: false, error: "No tenés permisos." };
  }
  if (!TIPOS.includes(input.tipo as TipoMovimiento)) {
    return { ok: false, error: "Tipo de movimiento inválido." };
  }
  const cuenta: CuentaCaja = input.cuenta === "capital" ? "capital" : "operativa";
  // Los movimientos de CAPITAL (aportes/retiros del dueño) son sensibles → solo admin.
  if (cuenta === "capital" && usuario.rol !== "admin") {
    return { ok: false, error: "Solo el administrador registra capital." };
  }
  const monto = Math.round(Number(input.monto));
  if (!(monto > 0)) return { ok: false, error: "El monto debe ser mayor a 0." };

  try {
    const db = await createSupabaseServer();
    await registrarMovimientoCaja(db, {
      tipo: input.tipo as TipoMovimiento,
      monto,
      categoria: (input.categoria ?? "").trim().slice(0, 60) || null,
      descripcion: (input.descripcion ?? "").trim().slice(0, 200) || null,
      cobradorId: input.cobradorId || null,
      registradoPor: usuario.id,
      cuenta,
      visible: input.visible ?? true,
    });
    await registrarAuditoria(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      accion: cuenta === "capital" ? "Registró movimiento de capital" : "Registró movimiento de caja",
      entidad: "caja",
      detalle: `${input.tipo} ${UYU(monto)}${input.categoria ? ` · ${input.categoria}` : ""}`,
    });
    revalidatePath("/admin/caja");
    revalidatePath("/admin/capital");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo registrar. ¿Corriste la migración 0010?" };
  }
}
