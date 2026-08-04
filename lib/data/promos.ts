// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — JUEGOS PROMOCIONALES (raspaditas + quiniela). Resiliente:
//  si 0021 no corrió, degrada a vacío. Promocional: sin dinero real (ver 0021).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DefinicionSegmento } from "@/lib/segmentos";
import { tablaFaltante, columnaFaltante } from "@/lib/data/errores";
import { contarPagosVigentesCliente } from "@/lib/data/estrellas";
import { raspaditasDisponibles, type PremioRaspa, type SegmentoRaspa } from "@/lib/raspadita";
import { getAjustesJuego } from "@/lib/data/juegoConfig";
import { traerTodo } from "@/lib/data/paginado";
import { enLotes } from "@/lib/data/alcance";

// ── Raspaditas: premios ────────────────────────────────────────────────────

export async function getPremiosRaspa(
  db: SupabaseClient,
  soloActivos = false,
): Promise<PremioRaspa[]> {
  const map = (r: Record<string, unknown>): PremioRaspa => ({
    id: r.id as string,
    label: r.label as string,
    tipo: r.tipo as PremioRaspa["tipo"],
    peso: Number(r.peso),
    activo: r.activo as boolean,
    segmentoId: (r.segmento_id as string | null | undefined) ?? null,
    // 0130: costo de lista. 0 (o ausente) = el dueño todavía no lo cargó.
    costo: Number(r.costo ?? 0),
  });
  try {
    let q = db
      .from("raspadita_premios")
      .select("id, label, tipo, peso, activo, segmento_id, costo")
      .order("orden");
    if (soloActivos) q = q.eq("activo", true);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => map(r as Record<string, unknown>));
  } catch (e) {
    // Defensivo: si falta `costo` (0130) o `segmento_id` (0042), reintentar con
    // el set mínimo de columnas — una migración pendiente no rompe la pantalla.
    if (columnaFaltante(e)) {
      try {
        let q = db
          .from("raspadita_premios")
          .select("id, label, tipo, peso, activo, segmento_id")
          .order("orden");
        if (soloActivos) q = q.eq("activo", true);
        const { data, error } = await q;
        if (error) throw error;
        return (data ?? []).map((r) => map(r as Record<string, unknown>));
      } catch (e2) {
        if (!columnaFaltante(e2)) throw e2;
      }
      let q = db.from("raspadita_premios").select("id, label, tipo, peso, activo").order("orden");
      if (soloActivos) q = q.eq("activo", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => map(r as Record<string, unknown>));
    }
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

// ── Raspaditas: TRAMOS de scoring (0042) ────────────────────────────────────

function mapSegmento(r: Record<string, unknown>): SegmentoRaspa {
  return {
    id: r.id as string,
    nombre: r.nombre as string,
    scoreMin: Number(r.score_min),
    scoreMax: Number(r.score_max),
    probGanar: Number(r.prob_ganar),
    esDefault: (r.es_default as boolean) ?? false,
    activo: (r.activo as boolean) ?? true,
    orden: Number(r.orden ?? 0),
  };
}

export async function getSegmentosRaspa(
  db: SupabaseClient,
  soloActivos = false,
): Promise<SegmentoRaspa[]> {
  try {
    let q = db
      .from("raspadita_segmentos")
      .select("id, nombre, score_min, score_max, prob_ganar, es_default, activo, orden")
      .order("orden");
    if (soloActivos) q = q.eq("activo", true);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => mapSegmento(r as Record<string, unknown>));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

export async function guardarSegmentoRaspaDb(
  db: SupabaseClient,
  input: {
    id?: string | null;
    nombre: string;
    scoreMin: number;
    scoreMax: number;
    probGanar: number;
    activo: boolean;
    orden: number;
  },
): Promise<void> {
  const fila = {
    nombre: input.nombre,
    score_min: input.scoreMin,
    score_max: input.scoreMax,
    prob_ganar: input.probGanar,
    activo: input.activo,
    orden: input.orden,
  };
  const { error } = input.id
    ? await db.from("raspadita_segmentos").update(fila).eq("id", input.id)
    : await db.from("raspadita_segmentos").insert(fila);
  if (error) throw error;
}

export async function borrarSegmentoRaspaDb(db: SupabaseClient, id: string): Promise<void> {
  // No se puede borrar el tramo "Los demás" (catch-all): dejaría clientes sin tramo.
  const { error } = await db.from("raspadita_segmentos").delete().eq("id", id).eq("es_default", false);
  if (error) throw error;
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

/** Créditos ya finalizados del cliente = ciclos completados (proxy de "renovaciones"
 *  para el gatillo 'renovacion'). Degrada a 0 si falta la tabla. */
export async function contarRenovacionesCliente(db: SupabaseClient, clienteId: string): Promise<number> {
  try {
    const { count, error } = await db
      .from("prestamos")
      .select("*", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .eq("estado", "finalizado")
      // Solo ciclos completados EN LA APP: los créditos importados del empalme
      // llevan disapp_credit_id. Sin este filtro, un cliente con 15 créditos
      // Disapp finalizados amanecía con 15 raspaditas (premios reales) por
      // historia que Presta Ya nunca vio.
      .is("disapp_credit_id", null);
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    if (tablaFaltante(e)) return 0;
    throw e;
  }
}

/** Raspaditas que el admin OTORGÓ a mano al cliente (suman a las ganadas, 0097).
 *  Degrada a 0 si falta la tabla (0097 sin correr). */
export async function contarOtorgadasCliente(db: SupabaseClient, clienteId: string): Promise<number> {
  try {
    const filas = await traerTodo<{ cantidad: number }>((d, h) =>
      db.from("raspaditas_otorgadas").select("cantidad").eq("cliente_id", clienteId)
        .order("id", { ascending: true }).range(d, h),
    );
    return filas.reduce((s, r) => s + Number(r.cantidad), 0);
  } catch (e) {
    if (tablaFaltante(e)) return 0;
    throw e;
  }
}

export interface EstadoRaspaCliente {
  disponibles: number;
  premios: PremioRaspa[];
  /** Total de raspaditas GANADAS por el cliente (base del gatillo + otorgadas).
   *  Es el CUPO que la jugada atómica re-chequea contra las jugadas hechas. */
  ganadas: number;
}

/** Cuántas raspaditas puede jugar el cliente + catálogo activo. El GATILLO lo
 *  define el admin (0097): 'pago' (una por cuota), 'renovacion' (una por crédito
 *  completado) o 'manual' (solo otorgadas). Las OTORGADAS a mano siempre suman. */
export async function getEstadoRaspaCliente(
  db: SupabaseClient,
  clienteId: string,
): Promise<EstadoRaspaCliente> {
  const ajustes = await getAjustesJuego(db);
  const baseGatillo =
    ajustes.raspaGatillo === "renovacion"
      ? contarRenovacionesCliente(db, clienteId)
      : ajustes.raspaGatillo === "manual"
        ? Promise.resolve(0)
        : contarPagosVigentesCliente(db, clienteId);
  const [base, otorgadas, jugadas, premios] = await Promise.all([
    baseGatillo,
    contarOtorgadasCliente(db, clienteId),
    contarJugadasRaspa(db, clienteId),
    getPremiosRaspa(db, true),
  ]);
  const ganadas = base + otorgadas;
  // Si no hay premios activos (o falta 0021), el juego no está configurado: no
  // ofrecemos raspaditas (evita el botón "raspar" que fallaría).
  const disponibles = premios.length > 0 ? raspaditasDisponibles(ganadas, jugadas, ajustes.raspaTope) : 0;
  return { disponibles, premios, ganadas };
}

export async function registrarJugadaRaspa(
  db: SupabaseClient,
  input: { clienteId: string; premioId: string | null; premioLabel: string; premioTipo: string },
): Promise<void> {
  const { error } = await db.from("raspaditas_jugadas").insert({
    cliente_id: input.clienteId,
    premio_id: input.premioId,
    premio_label: input.premioLabel,
    premio_tipo: input.premioTipo,
  });
  if (error) throw error;
}

export type ResultadoJugadaSegura =
  | { ok: true; folio: number | null; label?: string | null; tipo?: string | null }
  | { ok: false; sinCupo: boolean };

/**
 * Registra la jugada de forma ATÓMICA (RPC 0097 con advisory lock): re-chequea el
 * cupo (jugadas < ganadas) DENTRO de la transacción → dos jugadas concurrentes no
 * pueden farmear cupones. Devuelve el `folio` del comprobante (solo beneficios).
 * Si 0097 aún no corrió (42883/PGRST202), cae al insert plano (conducta previa).
 */
export async function registrarJugadaRaspaSeguro(
  db: SupabaseClient,
  input: { clienteId: string; premioId: string | null; premioLabel: string; premioTipo: string; ganadas: number },
): Promise<ResultadoJugadaSegura> {
  const params = {
    p_cliente: input.clienteId,
    p_premio_id: input.premioId,
    p_label: input.premioLabel,
    p_tipo: input.premioTipo,
    p_ganadas: input.ganadas,
  };
  const leerFolio = (data: unknown): number | null => {
    const row = Array.isArray(data) ? data[0] : data;
    const folio = (row as { folio?: number | null } | null)?.folio;
    return folio == null ? null : Number(folio);
  };
  // 0103: RPC pin-aware (entrega el PREMIO FIJADO pendiente FIFO, o el azar). Mismo
  // candado + re-cheque de cupo que 0097. Si 0103 no corrió, cae al RPC 0097.
  // 0106: el RPC devuelve el label/tipo REALMENTE entregado → el cliente ve lo que
  // quedó en la BD (antes veía el azar aunque se guardara el pin). Si falta 0106, el
  // RPC viejo no trae esas columnas → label/tipo null → se usa el del azar (previo).
  const pin = await db.rpc("registrar_jugada_raspa_pin", params);
  if (!pin.error) {
    const row = Array.isArray(pin.data) ? pin.data[0] : pin.data;
    return {
      ok: true,
      folio: leerFolio(pin.data),
      label: (row as { premio_label?: string | null } | null)?.premio_label ?? null,
      tipo: (row as { premio_tipo?: string | null } | null)?.premio_tipo ?? null,
    };
  }
  const pcode = (pin.error as { code?: string }).code;
  if (pcode === "P0001") return { ok: false, sinCupo: true }; // sin cupo (carrera)
  if (pcode !== "42883" && pcode !== "PGRST202") throw pin.error;

  // 0103 sin correr → RPC 0097 (que a su vez cae al insert plano si falta 0097).
  const rpc = await db.rpc("registrar_jugada_raspa_seguro", params);
  if (!rpc.error) return { ok: true, folio: leerFolio(rpc.data) };
  const code = (rpc.error as { code?: string }).code;
  if (code === "P0001") return { ok: false, sinCupo: true };
  if (code === "42883" || code === "PGRST202") {
    // 0097 sin correr → insert plano (sin folio ni candado; conducta previa).
    await registrarJugadaRaspa(db, input);
    return { ok: true, folio: null };
  }
  throw rpc.error;
}

// Admin CRUD de premios.
export async function guardarPremioRaspaDb(
  db: SupabaseClient,
  input: {
    id?: string | null;
    label: string;
    tipo: string;
    peso: number;
    activo: boolean;
    orden: number;
    /** Tramo al que pertenece (0042). Opcional para compat con bases sin 0042. */
    segmentoId?: string | null;
    /** Costo estimado del premio (0130). Sin esto no hay presupuesto posible. */
    costo?: number;
  },
): Promise<void> {
  const fila: Record<string, unknown> = {
    label: input.label,
    tipo: input.tipo,
    peso: input.peso,
    activo: input.activo,
    orden: input.orden,
  };
  if (input.segmentoId !== undefined) fila.segmento_id = input.segmentoId;
  if (input.costo !== undefined) fila.costo = input.costo;
  const guardar = async (f: Record<string, unknown>) =>
    input.id
      ? await db.from("raspadita_premios").update(f).eq("id", input.id)
      : await db.from("raspadita_premios").insert(f);
  const { error } = await guardar(fila);
  if (error) {
    // Sin 0130 la columna `costo` no existe: se guarda el resto igual en vez de
    // perder la edición del premio.
    if (columnaFaltante(error) && fila.costo !== undefined) {
      const { costo: _omitido, ...sinCosto } = fila;
      const r2 = await guardar(sinCosto);
      if (r2.error) throw r2.error;
      return;
    }
    throw error;
  }
}

export async function borrarPremioRaspaDb(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("raspadita_premios").delete().eq("id", id);
  if (error) throw error;
}

// ── Raspaditas: COMPROBANTE por folio (validar + canjear) ──────────────────
export interface ComprobanteRaspa {
  folio: number;
  clienteId: string;
  clienteNombre: string;
  premioLabel: string;
  premioTipo: string;
  jugadoEn: string;
  canjeadoEn: string | null;
  canjeadoPorNombre: string | null;
}

/** Busca el comprobante de un premio por su FOLIO (para que la oficina lo valide).
 *  null si no existe o si 0097 aún no agregó la columna. */
export async function getJugadaPorFolio(db: SupabaseClient, folio: number): Promise<ComprobanteRaspa | null> {
  try {
    const { data, error } = await db
      .from("raspaditas_jugadas")
      .select("folio, cliente_id, premio_label, premio_tipo, jugado_en, canjeado_en, canjeado_por")
      .eq("folio", folio)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const r = data as Record<string, unknown>;
    const clienteId = r.cliente_id as string;
    const canjPor = (r.canjeado_por as string | null) ?? null;
    const ids = [clienteId, ...(canjPor ? [canjPor] : [])];
    const nombres = new Map<string, string>();
    const { data: cs } = await db.from("clientes").select("id, nombre").in("id", ids);
    for (const c of cs ?? []) nombres.set((c as { id: string }).id, (c as { nombre: string }).nombre);
    let canjeadoPorNombre: string | null = null;
    if (canjPor) {
      const { data: us } = await db.from("usuarios").select("nombre").eq("id", canjPor).maybeSingle();
      canjeadoPorNombre = (us as { nombre?: string } | null)?.nombre ?? null;
    }
    return {
      folio: Number(r.folio),
      clienteId,
      clienteNombre: nombres.get(clienteId) ?? "—",
      premioLabel: (r.premio_label as string) ?? "—",
      premioTipo: (r.premio_tipo as string) ?? "nada",
      jugadoEn: r.jugado_en as string,
      canjeadoEn: (r.canjeado_en as string | null) ?? null,
      canjeadoPorNombre,
    };
  } catch (e) {
    if (tablaFaltante(e) || columnaFaltante(e)) return null;
    throw e;
  }
}

/** Marca un folio como CANJEADO (usado). Idempotente: si ya estaba, no re-marca.
 *  Devuelve el estado para que el admin sepa si lo acaba de canjear o ya estaba. */
export async function canjearFolioDb(
  db: SupabaseClient,
  folio: number,
  usuarioId: string,
): Promise<{ estado: "canjeado" | "ya-estaba" | "no-existe" }> {
  // Solo actualiza si NO estaba canjeado (candado idempotente por `is null`).
  const { data, error } = await db
    .from("raspaditas_jugadas")
    .update({ canjeado_en: new Date().toISOString(), canjeado_por: usuarioId })
    .eq("folio", folio)
    .is("canjeado_en", null)
    .select("folio");
  if (error) throw error;
  if (data && data.length > 0) return { estado: "canjeado" };
  // 0 filas: o no existe, o ya estaba canjeado. Distinguir.
  const { data: existe } = await db.from("raspaditas_jugadas").select("folio").eq("folio", folio).maybeSingle();
  return { estado: existe ? "ya-estaba" : "no-existe" };
}

/** El admin OTORGA N raspaditas a un cliente (suman a las ganadas). Inmutable.
 *  Con `premioId` (0103) FIJA qué premio le tocará al jugarla (en vez del azar). */
export async function otorgarRaspaditasDb(
  db: SupabaseClient,
  input: { clienteId: string; cantidad: number; motivo: string | null; otorgadoPor: string; premioId?: string | null },
): Promise<void> {
  const fila: Record<string, unknown> = {
    cliente_id: input.clienteId,
    cantidad: input.cantidad,
    motivo: input.motivo,
    otorgado_por: input.otorgadoPor,
  };
  if (input.premioId) fila.premio_id = input.premioId;
  let { error } = await db.from("raspaditas_otorgadas").insert(fila);
  // 0103 sin correr → otorgar SIN premio fijado (azar, conducta previa).
  if (error && input.premioId && columnaFaltante(error)) {
    delete fila.premio_id;
    ({ error } = await db.from("raspaditas_otorgadas").insert(fila));
  }
  if (error) throw error;
}

// ── Raspaditas: RESULTADOS para el admin (historial + agregados) ───────────
export interface JugadaRaspa {
  clienteId: string;
  clienteNombre: string;
  premioLabel: string;
  premioTipo: string;
  jugadoEn: string;
  folio: number | null;
}

export interface ResumenRaspaditas {
  totalJugadas: number;
  beneficios: number;
  nada: number;
  /** Cuántas veces cayó cada premio (para "qué premios cayeron"). */
  porPremio: { label: string; tipo: string; cantidad: number }[];
  /** Últimas jugadas con nombre del cliente (historial verificable). */
  recientes: JugadaRaspa[];
}

const RESUMEN_RASPA_VACIO: ResumenRaspaditas = {
  totalJugadas: 0, beneficios: 0, nada: 0, porPremio: [], recientes: [],
};

/**
 * Resumen de resultados de la raspadita para el admin: cuántas se jugaron, qué
 * premios cayeron y el historial reciente (con nombre del cliente). Degrada a
 * vacío si falta 0021. `limite` = cuántas jugadas recientes traer al detalle.
 */
export async function getResumenRaspaditas(
  db: SupabaseClient,
  limite = 40,
): Promise<ResumenRaspaditas> {
  try {
    // Todas las jugadas (filas chicas) paginadas con orden estable → agregados
    // exactos por encima de las 1000 filas de PostgREST. `folio` es de 0097: si aún
    // no existe la columna, se reintenta sin ella (compat).
    const cols = "id, cliente_id, premio_label, premio_tipo, jugado_en, folio";
    let filas: Record<string, unknown>[];
    try {
      filas = await traerTodo<Record<string, unknown>>((d, h) =>
        db.from("raspaditas_jugadas").select(cols).order("id", { ascending: true }).range(d, h),
      );
    } catch (e) {
      if (!columnaFaltante(e)) throw e;
      filas = await traerTodo<Record<string, unknown>>((d, h) =>
        db.from("raspaditas_jugadas").select("id, cliente_id, premio_label, premio_tipo, jugado_en")
          .order("id", { ascending: true }).range(d, h),
      );
    }
    if (filas.length === 0) return RESUMEN_RASPA_VACIO;

    const beneficios = filas.filter((r) => r.premio_tipo === "beneficio").length;
    // Agrupado por premio (label+tipo) → "qué premios cayeron".
    const porMap = new Map<string, { label: string; tipo: string; cantidad: number }>();
    for (const r of filas) {
      const label = (r.premio_label as string) ?? "—";
      const tipo = (r.premio_tipo as string) ?? "nada";
      const k = `${tipo}|${label}`;
      const cur = porMap.get(k) ?? { label, tipo, cantidad: 0 };
      cur.cantidad += 1;
      porMap.set(k, cur);
    }
    const porPremio = [...porMap.values()].sort((a, b) => b.cantidad - a.cantidad);

    // Recientes (por fecha desc) → solo se resuelven los nombres de esas N.
    const recientesRaw = [...filas]
      .sort((a, b) => String(b.jugado_en).localeCompare(String(a.jugado_en)))
      .slice(0, limite);
    const ids = [...new Set(recientesRaw.map((r) => r.cliente_id as string))];
    const nombres = new Map<string, string>();
    for (const lote of enLotes(ids)) {
      const { data: cs } = await db.from("clientes").select("id, nombre").in("id", lote);
      for (const c of cs ?? []) nombres.set((c as { id: string }).id, (c as { nombre: string }).nombre);
    }
    const recientes: JugadaRaspa[] = recientesRaw.map((r) => ({
      clienteId: r.cliente_id as string,
      clienteNombre: nombres.get(r.cliente_id as string) ?? "—",
      premioLabel: (r.premio_label as string) ?? "—",
      premioTipo: (r.premio_tipo as string) ?? "nada",
      jugadoEn: r.jugado_en as string,
      folio: r.folio == null ? null : Number(r.folio),
    }));

    return { totalJugadas: filas.length, beneficios, nada: filas.length - beneficios, porPremio, recientes };
  } catch (e) {
    if (tablaFaltante(e)) return RESUMEN_RASPA_VACIO;
    throw e;
  }
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
  /** cliente_ids que el admin forzó como ganadores (0090). [] si la col no existe. */
  ganadoresForzados: string[];
  /** Audiencia (0089): solo estos clientes participan/ven. null = todos los al día. */
  segmentoDef: DefinicionSegmento | null;
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
    ganadoresForzados: Array.isArray(r.ganadores_forzados) ? (r.ganadores_forzados as string[]) : [],
    segmentoDef: (r.segmento_def as DefinicionSegmento | null) ?? null,
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
  input: {
    titulo: string;
    rangoMin: number;
    rangoMax: number;
    premioTexto: string;
    segmentoDef?: DefinicionSegmento | null;
    /** Costo del premio (0130): lo que va a costar cuando salga el ganador. */
    costoPremio?: number;
  },
): Promise<void> {
  // Una sola quiniela ABIERTA a la vez: cerramos las abiertas antes de abrir la
  // nueva. El índice único parcial (0082) lo garantiza a nivel BD; si dos gestores
  // abren a la vez, el 2º insert choca 23505 → reintentamos una vez (cerrar+abrir).
  const base: Record<string, unknown> = {
    titulo: input.titulo,
    rango_min: input.rangoMin,
    rango_max: input.rangoMax,
    premio_texto: input.premioTexto,
    segmento_def: input.segmentoDef ?? null,
    estado: "abierta",
  };
  if (input.costoPremio !== undefined) base.costo_premio = input.costoPremio;
  for (let intento = 0; intento < 3; intento++) {
    await db.from("quinielas").update({ estado: "cerrada" }).eq("estado", "abierta");
    const fila = intento === 2 ? (({ costo_premio: _o, ...r }) => r)(base) : base; // sin 0130
    const { error } = await db.from("quinielas").insert(fila);
    if (!error) return;
    if ((error as { code?: string }).code === "23505" && intento === 0) continue;
    if (columnaFaltante(error) && intento < 2) continue; // reintenta sin costo_premio
    throw error;
  }
}

export async function cerrarQuinielaDb(
  db: SupabaseClient,
  id: string,
  numeroGanador: number,
  ganadoresForzados: string[] = [],
): Promise<void> {
  const { error } = await db
    .from("quinielas")
    .update({
      estado: "cerrada",
      numero_ganador: numeroGanador,
      ganadores_forzados: ganadoresForzados,
      sorteo_en: new Date().toISOString(),
    })
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
    // Paginado (traerTodo): una quiniela es GLOBAL y puede superar 1000
    // participaciones → sin paginar, PostgREST corta en 1000 (orden arbitrario) y
    // el sorteo omitiría ganadores + subcontaría participantes. Con .order estable.
    const filas = await traerTodo<{ cliente_id: string; numero: number }>((d, h) =>
      db
        .from("quiniela_participaciones")
        .select("cliente_id, numero")
        .eq("quiniela_id", quinielaId)
        .order("id", { ascending: true })
        .range(d, h),
    );
    const ids = [...new Set(filas.map((r) => r.cliente_id))];
    // Nombres por lotes: con cientos de participantes, un solo .in() supera el
    // largo de URL de PostgREST (~445 UUIDs falla). Lote de 150 (LOTE_IN), el
    // mismo umbral seguro que usa `enLotes` en el resto del panel.
    const nombres = new Map<string, string>();
    for (const lote of enLotes(ids)) {
      const { data: cs } = await db.from("clientes").select("id, nombre").in("id", lote);
      for (const c of cs ?? []) nombres.set((c as { id: string }).id, (c as { nombre: string }).nombre);
    }
    return filas.map((row) => ({
      clienteId: row.cliente_id,
      clienteNombre: nombres.get(row.cliente_id) ?? "—",
      numero: Number(row.numero),
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}
