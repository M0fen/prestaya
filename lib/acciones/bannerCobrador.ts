"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — BANNER AL EQUIPO (admin/supervisor → cobradores, 0050).
//  Crear un aviso y apagarlo. Solo gestores (RLS lo refuerza). Con auditoría.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/data/auditoria";
import type { TemaBanner } from "@/lib/data/bannerCobrador";

type Resultado = { ok: true } | { ok: false; error: string };

const TEMAS: TemaBanner[] = ["azul", "verde", "ambar", "rojo"];
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Publica un banner para la app del cobrador. */
export async function crearBannerCobrador(input: {
  texto: string;
  tema: TemaBanner;
  /** Horas hasta que se apaga solo (0/undefined = sin vencimiento). */
  expiraEnHoras?: number;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  const texto = (input.texto ?? "").trim();
  if (texto.length < 3) return { ok: false, error: "Escribí el aviso (mínimo 3 caracteres)." };
  if (texto.length > 240) return { ok: false, error: "Máximo 240 caracteres." };
  const tema: TemaBanner = TEMAS.includes(input.tema) ? input.tema : "azul";
  const horas = Number(input.expiraEnHoras);
  const expira_en =
    Number.isFinite(horas) && horas > 0 ? new Date(Date.now() + horas * 3_600_000).toISOString() : null;
  try {
    const db = await createSupabaseServer();
    const { error } = await db
      .from("banner_cobrador")
      .insert({ texto, tema, activo: true, creado_por: u.id, expira_en });
    if (error) throw error;
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Publicó banner al equipo",
      entidad: "banner_cobrador",
      entidadId: null,
    });
    revalidatePath("/admin/chat");
    revalidatePath("/cobrador");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo publicar. ¿Corriste la migración 0050?" };
  }
}

/** Apaga (desactiva) un banner. */
export async function desactivarBannerCobrador(id: string): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!ES_UUID.test(id)) return { ok: false, error: "Banner inválido." };
  try {
    const db = await createSupabaseServer();
    const { error } = await db.from("banner_cobrador").update({ activo: false }).eq("id", id);
    if (error) throw error;
    revalidatePath("/admin/chat");
    revalidatePath("/cobrador");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo apagar." };
  }
}
