"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — MOROSIDAD (gestores). Marcar/quitar la marca de moroso y
//  registrar notas de mora (motivos/acuerdos). Todo auditado. Degrada con aviso
//  si falta la migración 0027.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import {
  marcarMorosoDb,
  desmarcarMorosoDb,
  agregarNotaMoraDb,
  type TipoNotaMora,
} from "@/lib/data/morosidad";
import { registrarAuditoria } from "@/lib/data/auditoria";

type Resultado = { ok: true } | { ok: false; error: string };

const ERR_MIGRACION = "No se pudo guardar. ¿Corriste la migración 0027?";

export async function marcarMoroso(clienteId: string, motivo: string): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  const m = (motivo ?? "").trim().slice(0, 300);
  if (!m) return { ok: false, error: "Contá el motivo (por qué es moroso)." };
  try {
    const db = await createSupabaseServer();
    await marcarMorosoDb(db, clienteId, m, u.id);
    // Deja el motivo también en la bitácora de mora (historial).
    await agregarNotaMoraDb(db, {
      clienteId,
      tipo: "motivo",
      texto: `Marcado como moroso: ${m}`,
      autorId: u.id,
      autorNombre: u.nombre,
    }).catch(() => {});
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Marcó moroso",
      entidad: "cliente",
      entidadId: clienteId,
      detalle: m,
    });
    revalidatePath(`/admin/clientes/${clienteId}`);
    revalidatePath("/admin/mora");
    return { ok: true };
  } catch {
    return { ok: false, error: ERR_MIGRACION };
  }
}

export async function desmarcarMoroso(clienteId: string): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  try {
    const db = await createSupabaseServer();
    await desmarcarMorosoDb(db, clienteId);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Quitó marca de moroso",
      entidad: "cliente",
      entidadId: clienteId,
    });
    revalidatePath(`/admin/clientes/${clienteId}`);
    revalidatePath("/admin/mora");
    return { ok: true };
  } catch {
    return { ok: false, error: ERR_MIGRACION };
  }
}

export async function agregarNotaMora(
  clienteId: string,
  tipo: TipoNotaMora,
  texto: string,
): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  const t = (texto ?? "").trim().slice(0, 500);
  if (!t) return { ok: false, error: "Escribí la nota." };
  const tipoOk: TipoNotaMora = tipo === "motivo" || tipo === "acuerdo" ? tipo : "nota";
  try {
    const db = await createSupabaseServer();
    await agregarNotaMoraDb(db, { clienteId, tipo: tipoOk, texto: t, autorId: u.id, autorNombre: u.nombre });
    revalidatePath(`/admin/clientes/${clienteId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: ERR_MIGRACION };
  }
}
