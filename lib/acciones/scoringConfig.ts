"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — ajustar el MODELO de scoring (SOLO admin). Normaliza los
//  pesos para que sumen 1 y valida el orden de los umbrales. Queda auditado.
//  Cambiar esto re-puntúa a todos (el score se calcula, no se guarda).
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { setConfigScoring } from "@/lib/data/scoringConfig";
import { registrarAuditoria } from "@/lib/data/auditoria";
import type { ConfigScoring } from "@/lib/scoring";

type Resultado = { ok: true } | { ok: false; error: string };

export async function guardarConfigScoring(input: {
  pesos: {
    cumplimiento: number;
    moraActual: number;
    experiencia: number;
    consistencia: number;
    antiguedad: number;
  };
  umbrales: { excelente: number; bueno: number; regular: number };
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol))
    return { ok: false, error: "Solo el administrador puede ajustar el scoring." };

  const p = input.pesos;
  const suma =
    (Number(p.cumplimiento) || 0) +
    (Number(p.moraActual) || 0) +
    (Number(p.experiencia) || 0) +
    (Number(p.consistencia) || 0) +
    (Number(p.antiguedad) || 0);
  if (!(suma > 0)) return { ok: false, error: "Los pesos no pueden ser todos cero." };
  const norm = (x: number) => Math.round(((Number(x) || 0) / suma) * 1000) / 1000;

  const cl = (x: number) => Math.max(0, Math.min(1000, Math.round(Number(x) || 0)));
  const excelente = cl(input.umbrales.excelente);
  const bueno = cl(input.umbrales.bueno);
  const regular = cl(input.umbrales.regular);
  if (!(excelente > bueno && bueno > regular))
    return { ok: false, error: "Los umbrales deben ir de mayor a menor: excelente > bueno > regular." };

  const cfg: ConfigScoring = {
    pesos: {
      cumplimiento: norm(p.cumplimiento),
      moraActual: norm(p.moraActual),
      experiencia: norm(p.experiencia),
      consistencia: norm(p.consistencia),
      antiguedad: norm(p.antiguedad),
    },
    umbrales: { excelente, bueno, regular },
  };

  try {
    const db = await createSupabaseServer();
    await setConfigScoring(db, cfg, u.id);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Ajustó el modelo de scoring",
      entidad: "scoring",
      detalle: `Umbrales ${excelente}/${bueno}/${regular} · pesos normalizados`,
    });
    revalidatePath("/admin/scoring");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
}
