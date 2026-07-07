// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — MOROSIDAD (0027). Marca persistente de moroso + notas de
//  mora (motivos/acuerdos) + lista de morosos (marcados o con castigos).
//  Uso interno (gestores). Degrada si 0027 aún no corrió.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante, columnaFaltante } from "./errores";

export type TipoNotaMora = "motivo" | "acuerdo" | "nota";

export interface EstadoMorosidad {
  moroso: boolean;
  motivo: string | null;
  desde: string | null;
  porNombre: string | null;
}

export interface NotaMora {
  id: string;
  tipo: TipoNotaMora;
  texto: string;
  autorNombre: string | null;
  creadoEn: string;
}

export interface MorosoItem {
  clienteId: string;
  nombre: string;
  telefono: string | null;
  marcado: boolean;
  motivo: string | null;
  desde: string | null;
  incobrables: number;
}

const SIN_MOROSIDAD: EstadoMorosidad = { moroso: false, motivo: null, desde: null, porNombre: null };

/** Estado de morosidad de un cliente (degrada a "no moroso" si falta 0027). */
export async function getMorosidadCliente(
  db: SupabaseClient,
  clienteId: string,
): Promise<EstadoMorosidad> {
  try {
    const { data, error } = await db
      .from("clientes")
      .select("moroso, moroso_motivo, moroso_desde, moroso_por")
      .eq("id", clienteId)
      .maybeSingle();
    if (error) throw error;
    let porNombre: string | null = null;
    if (data?.moroso_por) {
      const { data: u } = await db.from("usuarios").select("nombre").eq("id", data.moroso_por).maybeSingle();
      porNombre = (u?.nombre as string | null) ?? null;
    }
    return {
      moroso: Boolean(data?.moroso),
      motivo: (data?.moroso_motivo as string | null) ?? null,
      desde: (data?.moroso_desde as string | null) ?? null,
      porNombre,
    };
  } catch (e) {
    if (columnaFaltante(e)) return SIN_MOROSIDAD;
    throw e;
  }
}

/** Notas de mora (motivos/acuerdos) de un cliente, de la más nueva a la vieja. */
export async function getNotasMora(db: SupabaseClient, clienteId: string): Promise<NotaMora[]> {
  try {
    const { data, error } = await db
      .from("mora_notas")
      .select("id, tipo, texto, autor_nombre, creado_en")
      .eq("cliente_id", clienteId)
      .order("creado_en", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id as string,
      tipo: (r.tipo as TipoNotaMora) ?? "nota",
      texto: r.texto as string,
      autorNombre: (r.autor_nombre as string | null) ?? null,
      creadoEn: r.creado_en as string,
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export async function marcarMorosoDb(
  db: SupabaseClient,
  clienteId: string,
  motivo: string,
  porId: string,
): Promise<void> {
  const { error } = await db
    .from("clientes")
    .update({ moroso: true, moroso_motivo: motivo, moroso_desde: new Date().toISOString(), moroso_por: porId })
    .eq("id", clienteId);
  if (error) throw error;
}

export async function desmarcarMorosoDb(db: SupabaseClient, clienteId: string): Promise<void> {
  const { error } = await db
    .from("clientes")
    .update({ moroso: false, moroso_motivo: null, moroso_desde: null, moroso_por: null })
    .eq("id", clienteId);
  if (error) throw error;
}

export async function agregarNotaMoraDb(
  db: SupabaseClient,
  nota: { clienteId: string; tipo: TipoNotaMora; texto: string; autorId: string; autorNombre: string },
): Promise<void> {
  const { error } = await db.from("mora_notas").insert({
    cliente_id: nota.clienteId,
    tipo: nota.tipo,
    texto: nota.texto,
    autor_id: nota.autorId,
    autor_nombre: nota.autorNombre,
  });
  if (error) throw error;
}

/**
 * Lista de MOROSOS para el panel: marcados manualmente (lista negra) y/o con
 * créditos incobrables (castigos). Degrada si falta 0027 (usa solo incobrables).
 */
export async function getMorosos(db: SupabaseClient): Promise<MorosoItem[]> {
  const item = new Map<string, MorosoItem>();

  // 1) Marcados manualmente (si existe la columna).
  try {
    const { data, error } = await db
      .from("clientes")
      .select("id, nombre, telefono, moroso_motivo, moroso_desde")
      .eq("moroso", true);
    if (error) throw error;
    for (const c of data ?? []) {
      item.set(c.id as string, {
        clienteId: c.id as string,
        nombre: (c.nombre as string) ?? "Cliente",
        telefono: (c.telefono as string | null) ?? null,
        marcado: true,
        motivo: (c.moroso_motivo as string | null) ?? null,
        desde: (c.moroso_desde as string | null) ?? null,
        incobrables: 0,
      });
    }
  } catch (e) {
    if (!columnaFaltante(e)) throw e; // sin 0027: seguimos solo con incobrables
  }

  // 2) Con créditos incobrables (castigos), aunque no estén marcados.
  const { data: pres, error: ePres } = await db
    .from("prestamos")
    .select("cliente_id")
    .eq("estado", "incobrable");
  if (ePres) throw ePres;
  const conteo = new Map<string, number>();
  for (const p of pres ?? []) {
    const id = p.cliente_id as string;
    conteo.set(id, (conteo.get(id) ?? 0) + 1);
  }
  const faltantes = [...conteo.keys()].filter((id) => !item.has(id));
  if (faltantes.length > 0) {
    const { data: clis } = await db.from("clientes").select("id, nombre, telefono").in("id", faltantes);
    for (const c of clis ?? [])
      item.set(c.id as string, {
        clienteId: c.id as string,
        nombre: (c.nombre as string) ?? "Cliente",
        telefono: (c.telefono as string | null) ?? null,
        marcado: false,
        motivo: null,
        desde: null,
        incobrables: 0,
      });
  }
  for (const [id, n] of conteo) {
    const it = item.get(id);
    if (it) it.incobrables = n;
  }

  // Marcados primero, luego por cantidad de incobrables.
  return [...item.values()].sort(
    (a, b) => Number(b.marcado) - Number(a.marcado) || b.incobrables - a.incobrables,
  );
}
