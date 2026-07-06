"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — el COBRADOR registra un GASTO de ruta (egreso a su nombre).
//  Corre con su sesión → el RLS de 0017 valida rol + que sea suyo. Estos gastos
//  aparecen en la Caja del admin y alimentan el "efectivo a entregar" al rendir.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import { registrarGastoRutaDb } from "@/lib/data/gastos";
import { registrarBitacora } from "@/lib/data/bitacora";

type Resultado = { ok: true } | { ok: false; error: string };

export async function agregarGastoRuta(input: {
  monto: number;
  categoria?: string | null;
  descripcion?: string | null;
}): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || usuario.rol !== "cobrador") {
    return { ok: false, error: "Solo un cobrador puede cargar gastos de ruta." };
  }
  const monto = Math.round(Number(input.monto) || 0);
  if (!(monto > 0)) return { ok: false, error: "El monto debe ser mayor a 0." };

  try {
    const db = await createSupabaseServer();
    const categoria = (input.categoria ?? "").trim().slice(0, 40) || "Gasto de ruta";
    await registrarGastoRutaDb(db, {
      cobradorId: usuario.id,
      monto,
      categoria,
      descripcion: (input.descripcion ?? "").trim().slice(0, 160) || null,
    });
    await registrarBitacora(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      rol: usuario.rol,
      accion: "gasto",
      monto,
      detalle: categoria,
    });
    revalidatePath("/cobrador");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo registrar el gasto. Probá de nuevo." };
  }
}
