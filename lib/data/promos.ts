// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — JUEGOS PROMOCIONALES (raspaditas + quiniela). Resiliente:
//  si 0021 no corrió, degrada a vacío. Promocional: sin dinero real (ver 0021).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { tablaFaltante } from "@/lib/data/errores";
import { contarPagosVigentesCliente } from "@/lib/data/estrellas";
import { raspaditasDisponibles, type PremioRaspa } from "@/lib/raspadita";

// ── Raspaditas ─────────────────────────────────────────────────────────────

export async function getPremiosRaspa(
  db: SupabaseClient,
  soloActivos = false,
): Promise<PremioRaspa[]> {
  try {
    let q = db.from("raspadita_premios").select("id, label, tipo, peso, activo").order("orden");
    if (soloActivos) q = q.eq("activo", true);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: (r as { id: string }).id,
      label: (r as { label: string }).label,
      tipo: (r as { tipo: PremioRaspa["tipo"] }).tipo,
      peso: Number((r as { peso: number }).peso),
      activo: (r as { activo: boolean }).activo,
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export async function contarJugadasRaspa(db: SupabaseClient, clienteId: string): Promise<number> {
  try {
    const { count, error } = await db
      .from("raspaditas_jugadas")
      .select("*", { count: "exact", head: true })
      .eq("cliente_id", clienteId);
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    if (tablaFaltante(e)) return 0;
    throw e;
  }
}

export interface EstadoRaspaCliente {
  disponibles: number;
  premios: PremioRaspa[];
}

/** Cuántas raspaditas puede jugar el cliente (una por pago) + catálogo activo. */
export async function getEstadoRaspaCliente(
  db: SupabaseClient,
  clienteId: string,
): Promise<EstadoRaspaCliente> {
  const [pagos, jugadas, premios] = await Promise.all([
    contarPagosVigentesCliente(db, clienteId),
    contarJugadasRaspa(db, clienteId),
    getPremiosRaspa(db, true),
  ]);
  // Si no hay premios activos (o falta la migración 0021), el juego no está
  // configurado: no ofrecemos raspaditas (evita el botón "raspar" que fallaría).
  const disponibles =
    premios.length > 0 ? raspaditasDisponibles(pagos, jugadas) : 0;
  return { disponibles, premios };
}

export async function registrarJugadaRaspa(
  db: SupabaseClient,
  input: { clienteId: string; premioId: string; premioLabel: string; premioTipo: string },
): Promise<void> {
  const { error } = await db.from("raspaditas_jugadas").insert({
    cliente_id: input.clienteId,
    premio_id: input.premioId,
    premio_label: input.premioLabel,
    premio_tipo: input.premioTipo,
  });
  if (error) throw error;
}

// Admin CRUD de premios.
export async function guardarPremioRaspaDb(
  db: SupabaseClient,
  input: { id?: string | null; label: string; tipo: string; peso: number; activo: boolean; orden: number },
): Promise<void> {
  const fila = { label: input.label, tipo: input.tipo, peso: input.peso, activo: input.activo, orden: input.orden };
  const { error } = input.id
    ? await db.from("raspadita_premios").update(fila).eq("id", input.id)
    : await db.from("raspadita_premios").insert(fila);
  if (error) throw error;
}

export async function borrarPremioRaspaDb(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("raspadita_premios").delete().eq("id", id);
  if (error) throw error;
}

// ── Quiniela ───────────────────────────────────────────────────────────────

export interface Quiniela {
  id: string;
  titulo: string;
  rangoMin: number;
  rangoMax: number;
  premioTexto: string;
  estado: "abierta" | "cerrada";
  numeroGanador: number | null;
  sorteoEn: string | null;
}

function mapQuiniela(r: Record<string, unknown>): Quiniela {
  return {
    id: r.id as string,
    titulo: r.titulo as string,
    rangoMin: Number(r.rango_min),
    rangoMax: Number(r.rango_max),
    premioTexto: r.premio_texto as string,
    estado: r.estado as Quiniela["estado"],
    numeroGanador: r.numero_ganador == null ? null : Number(r.numero_ganador),
    sorteoEn: (r.sorteo_en as string | null) ?? null,
  };
}

/** La quiniela ABIERTA más reciente (o null). */
export async function getQuinielaAbierta(db: SupabaseClient): Promise<Quiniela | null> {
  try {
    const { data, error } = await db
      .from("quinielas")
      .select("*")
      .eq("estado", "abierta")
      .order("creado_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? mapQuiniela(data) : null;
  } catch (e) {
    if (tablaFaltante(e)) return null;
    throw e;
  }
}

export async function getQuinielasAdmin(db: SupabaseClient): Promise<Quiniela[]> {
  try {
    const { data, error } = await db
      .from("quinielas")
      .select("*")
      .order("creado_en", { ascending: false })
      .limit(20);
    if (error) throw error;
    return (data ?? []).map(mapQuiniela);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export async function getParticipacionCliente(
  db: SupabaseClient,
  quinielaId: string,
  clienteId: string,
): Promise<number | null> {
  try {
    const { data, error } = await db
      .from("quiniela_participaciones")
      .select("numero")
      .eq("quiniela_id", quinielaId)
      .eq("cliente_id", clienteId)
      .maybeSingle();
    if (error) throw error;
    return data ? Number((data as { numero: number }).numero) : null;
  } catch (e) {
    if (tablaFaltante(e)) return null;
    throw e;
  }
}

export async function participarQuinielaDb(
  db: SupabaseClient,
  input: { quinielaId: string; clienteId: string; numero: number },
): Promise<void> {
  const { error } = await db.from("quiniela_participaciones").insert({
    quiniela_id: input.quinielaId,
    cliente_id: input.clienteId,
    numero: input.numero,
  });
  if (error) throw error;
}

export async function crearQuinielaDb(
  db: SupabaseClient,
  input: { titulo: string; rangoMin: number; rangoMax: number; premioTexto: string },
): Promise<void> {
  const { error } = await db.from("quinielas").insert({
    titulo: input.titulo,
    rango_min: input.rangoMin,
    rango_max: input.rangoMax,
    premio_texto: input.premioTexto,
    estado: "abierta",
  });
  if (error) throw error;
}

export async function cerrarQuinielaDb(
  db: SupabaseClient,
  id: string,
  numeroGanador: number,
): Promise<void> {
  const { error } = await db
    .from("quinielas")
    .update({ estado: "cerrada", numero_ganador: numeroGanador, sorteo_en: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export interface GanadorQuiniela {
  clienteId: string;
  clienteNombre: string;
  numero: number;
}

/** Participaciones de una quiniela con el nombre del cliente (para el admin). */
export async function getParticipaciones(
  db: SupabaseClient,
  quinielaId: string,
): Promise<GanadorQuiniela[]> {
  try {
    const { data, error } = await db
      .from("quiniela_participaciones")
      .select("cliente_id, numero")
      .eq("quiniela_id", quinielaId);
    if (error) throw error;
    const filas = data ?? [];
    const ids = [...new Set(filas.map((r) => (r as { cliente_id: string }).cliente_id))];
    const nombres = new Map<string, string>();
    if (ids.length > 0) {
      const { data: cs } = await db.from("clientes").select("id, nombre").in("id", ids);
      for (const c of cs ?? []) nombres.set((c as { id: string }).id, (c as { nombre: string }).nombre);
    }
    return filas.map((r) => {
      const row = r as { cliente_id: string; numero: number };
      return {
        clienteId: row.cliente_id,
        clienteNombre: nombres.get(row.cliente_id) ?? "—",
        numero: Number(row.numero),
      };
    });
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}
