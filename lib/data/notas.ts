// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — NOTAS: por cliente (equipo) y personales (privadas).
//  Todo por RLS (ver 0007). Degrada a vacío si la migración no corrió (42P01).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotaCliente, NotaPersonal } from "@/types/db";
import { tablaFaltante } from "./errores";

export interface NotaClienteVista extends NotaCliente {
  autorNombre: string;
}

function mapNotaCliente(r: Record<string, unknown>): NotaCliente {
  return {
    id: r.id as string,
    cliente_id: r.cliente_id as string,
    autor_id: r.autor_id as string,
    cuerpo: r.cuerpo as string,
    creado_en: r.creado_en as string,
  };
}

function mapNotaPersonal(r: Record<string, unknown>): NotaPersonal {
  return {
    id: r.id as string,
    usuario_id: r.usuario_id as string,
    cuerpo: r.cuerpo as string,
    creado_en: r.creado_en as string,
    actualizado_en: r.actualizado_en as string,
  };
}

/** Notas de un cliente (equipo), de la más nueva a la más vieja, con autor. */
export async function getNotasCliente(
  db: SupabaseClient,
  clienteId: string,
): Promise<NotaClienteVista[]> {
  try {
    const { data, error } = await db
      .from("notas_cliente")
      .select("*")
      .eq("cliente_id", clienteId)
      .order("creado_en", { ascending: false });
    if (error) throw error;
    const notas = (data ?? []).map(mapNotaCliente);
    const autorIds = [...new Set(notas.map((n) => n.autor_id))];
    const nombres = new Map<string, string>();
    if (autorIds.length > 0) {
      const { data: us } = await db.from("usuarios").select("id, nombre").in("id", autorIds);
      for (const u of us ?? []) nombres.set(u.id as string, u.nombre as string);
    }
    return notas.map((n) => ({ ...n, autorNombre: nombres.get(n.autor_id) ?? "—" }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export async function crearNotaClienteDb(
  db: SupabaseClient,
  input: { clienteId: string; autorId: string; cuerpo: string },
): Promise<void> {
  const { error } = await db.from("notas_cliente").insert({
    cliente_id: input.clienteId,
    autor_id: input.autorId,
    cuerpo: input.cuerpo,
  });
  if (error) throw error;
}

export async function borrarNotaClienteDb(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("notas_cliente").delete().eq("id", id);
  if (error) throw error;
}

/** Notas personales del usuario logueado (RLS filtra por dueño). */
export async function getNotasPersonales(db: SupabaseClient): Promise<NotaPersonal[]> {
  try {
    const { data, error } = await db
      .from("notas_personales")
      .select("*")
      .order("creado_en", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapNotaPersonal);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export async function crearNotaPersonalDb(
  db: SupabaseClient,
  input: { usuarioId: string; cuerpo: string },
): Promise<void> {
  const { error } = await db.from("notas_personales").insert({
    usuario_id: input.usuarioId,
    cuerpo: input.cuerpo,
  });
  if (error) throw error;
}

export async function borrarNotaPersonalDb(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("notas_personales").delete().eq("id", id);
  if (error) throw error;
}
