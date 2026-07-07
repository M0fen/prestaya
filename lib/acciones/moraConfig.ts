"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — guardar la POLÍTICA DE MORA (recargo por atraso). Solo
//  gestores. El recargo se calcula aparte (no toca el cartón). Queda auditado.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { setConfigMora } from "@/lib/data/moraConfig";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { describirMora, type ConfigMora, type ModoMora } from "@/lib/moraCargo";

type Resultado = { ok: true } | { ok: false; error: string };
const MODOS: ModoMora[] = ["off", "fijo", "pct"];

export async function guardarConfigMora(input: {
  modo: string;
  valor: number;
  cuotasGracia: number;
  topePct: number;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol))
    return { ok: false, error: "Solo el administrador puede cambiar la política de mora." };

  const modo = (MODOS.includes(input.modo as ModoMora) ? input.modo : "off") as ModoMora;
  const cfg: ConfigMora = {
    modo,
    valor: Math.max(0, Math.round((Number(input.valor) || 0) * 100) / 100),
    cuotasGracia: Math.max(0, Math.round(Number(input.cuotasGracia) || 0)),
    topePct: Math.max(0, Math.min(100, Math.round((Number(input.topePct) || 0) * 100) / 100)),
  };

  try {
    const db = await createSupabaseServer();
    await setConfigMora(db, cfg, u.id);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Cambió política de mora",
      entidad: "mora",
      detalle: describirMora(cfg),
    });
    revalidatePath("/admin/mora");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. ¿Corriste la migración 0016?" };
  }
}
