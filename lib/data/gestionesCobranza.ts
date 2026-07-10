// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — GESTIONES DE COBRANZA (mini-CRM). El compromiso de pago se
//  AUTO-VERIFICA contra el libro inmutable de pagos: no guardamos "cumplió",
//  lo DERIVAMOS (pagó ≥ lo prometido desde que lo prometió → cumplido; si venció
//  la fecha sin cubrirlo → incumplido). Todo scopeado por RLS (0055) + alcance.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { enLotes, type Alcance } from "./alcance";
import { tablaFaltante } from "./errores";

export type TipoGestion =
  | "visita"
  | "llamada"
  | "mensaje"
  | "compromiso"
  | "acuerdo"
  | "ilocalizable"
  | "otro";

export type EstadoCompromiso = "vigente" | "vence_hoy" | "cumplido" | "incumplido";

export interface Gestion {
  id: string;
  clienteId: string;
  gestorNombre: string | null;
  tipo: TipoGestion;
  resultado: string | null;
  montoCompromiso: number | null;
  fechaCompromiso: string | null; // 'YYYY-MM-DD'
  /** Estado del compromiso derivado del libro de pagos (null si no hubo promesa). */
  estadoCompromiso: EstadoCompromiso | null;
  /** Cobrado desde que se registró la gestión (para explicar el estado). */
  pagadoDesde: number;
  creadoEn: string;
}

export interface NuevaGestion {
  clienteId: string;
  prestamoId: string | null;
  gestorId: string;
  gestorNombre: string;
  tipo: TipoGestion;
  resultado: string | null;
  montoCompromiso: number | null;
  fechaCompromiso: string | null;
}

/** Fecha de hoy en Uruguay como 'YYYY-MM-DD' (en-CA da ese formato). */
function hoyStrUY(hoy: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(hoy);
}

/** Estado de un compromiso a partir de lo prometido y lo efectivamente pagado. */
function estadoDe(
  monto: number | null,
  fecha: string | null,
  pagadoDesde: number,
  hoyStr: string,
): EstadoCompromiso | null {
  if (monto == null || fecha == null) return null;
  if (pagadoDesde >= monto) return "cumplido";
  if (fecha < hoyStr) return "incumplido";
  if (fecha === hoyStr) return "vence_hoy";
  return "vigente";
}

/**
 * Suma, por cliente, lo pagado (libro inmutable, anulado=false) DESDE un instante.
 * Devuelve un ayudante `(clienteId, desdeIso) => monto` ya resuelto en memoria.
 * `clienteIds` acota; corre bajo RLS (el gestor solo ve lo suyo).
 */
async function pagosPorClienteDesde(
  db: SupabaseClient,
  clienteIds: string[],
  desdeIso: string,
): Promise<Map<string, { iso: string; monto: number }[]>> {
  const porCliente = new Map<string, { iso: string; monto: number }[]>();
  if (clienteIds.length === 0) return porCliente;

  // cliente → sus préstamos (cualquier estado: los pagos viven en el préstamo).
  const prestamoDeCliente = new Map<string, string>();
  const clientePorPrestamo = new Map<string, string>();
  for (const lote of enLotes(clienteIds)) {
    const { data, error } = await db.from("prestamos").select("id, cliente_id").in("cliente_id", lote);
    if (error) throw error;
    for (const p of data ?? []) {
      prestamoDeCliente.set(p.cliente_id as string, p.id as string);
      clientePorPrestamo.set(p.id as string, p.cliente_id as string);
    }
  }
  const prestamoIds = [...clientePorPrestamo.keys()];
  if (prestamoIds.length === 0) return porCliente;

  for (const lote of enLotes(prestamoIds)) {
    const { data, error } = await db
      .from("pagos")
      .select("prestamo_id, monto, registrado_en")
      .eq("anulado", false)
      .gte("registrado_en", desdeIso)
      .in("prestamo_id", lote);
    if (error) throw error;
    for (const r of data ?? []) {
      const cid = clientePorPrestamo.get(r.prestamo_id as string);
      if (!cid) continue;
      const arr = porCliente.get(cid) ?? [];
      arr.push({ iso: r.registrado_en as string, monto: Number(r.monto) });
      porCliente.set(cid, arr);
    }
  }
  return porCliente;
}

function sumaDesde(pagos: { iso: string; monto: number }[] | undefined, desdeIso: string): number {
  if (!pagos) return 0;
  let s = 0;
  for (const p of pagos) if (p.iso >= desdeIso) s += p.monto;
  return s;
}

/** Registra una gestión (append-only). RLS (0055) valida la zona en el insert. */
export async function registrarGestionDb(db: SupabaseClient, g: NuevaGestion): Promise<void> {
  const { error } = await db.from("gestiones_cobranza").insert({
    cliente_id: g.clienteId,
    prestamo_id: g.prestamoId,
    gestor_id: g.gestorId,
    gestor_nombre: g.gestorNombre,
    tipo: g.tipo,
    resultado: g.resultado,
    monto_compromiso: g.montoCompromiso,
    fecha_compromiso: g.fechaCompromiso,
  });
  if (error) throw error;
}

/** Timeline de gestiones de un cliente (más nuevo primero), con el compromiso
 *  auto-verificado contra los pagos. Para el modal de gestión. */
export async function getGestionesCliente(
  db: SupabaseClient,
  clienteId: string,
  hoy: Date = new Date(),
): Promise<Gestion[]> {
  const { data, error } = await db
    .from("gestiones_cobranza")
    .select("*")
    .eq("cliente_id", clienteId)
    .order("creado_en", { ascending: false });
  if (error) {
    if (tablaFaltante(error)) return []; // 0055 sin correr → degrada
    throw error;
  }
  const filas = data ?? [];
  if (filas.length === 0) return [];

  // Solo hace falta consultar pagos si hubo algún compromiso (para verificarlo).
  const compromisos = filas.filter((r) => r.monto_compromiso != null);
  let pagos: { iso: string; monto: number }[] | undefined;
  if (compromisos.length > 0) {
    const desde = compromisos.reduce(
      (min, r) => ((r.creado_en as string) < min ? (r.creado_en as string) : min),
      compromisos[0].creado_en as string,
    );
    const mapa = await pagosPorClienteDesde(db, [clienteId], desde);
    pagos = mapa.get(clienteId);
  }

  const hoyStr = hoyStrUY(hoy);
  return filas.map((r) => {
    const monto = r.monto_compromiso != null ? Number(r.monto_compromiso) : null;
    const pagadoDesde = monto != null ? sumaDesde(pagos, r.creado_en as string) : 0;
    return {
      id: r.id as string,
      clienteId: r.cliente_id as string,
      gestorNombre: (r.gestor_nombre as string | null) ?? null,
      tipo: r.tipo as TipoGestion,
      resultado: (r.resultado as string | null) ?? null,
      montoCompromiso: monto,
      fechaCompromiso: (r.fecha_compromiso as string | null) ?? null,
      estadoCompromiso: estadoDe(monto, (r.fecha_compromiso as string | null) ?? null, pagadoDesde, hoyStr),
      pagadoDesde,
      creadoEn: r.creado_en as string,
    };
  });
}

export interface EstadoGestionCliente {
  gestionadoHoy: boolean;
  ultimoTipo: TipoGestion | null;
  /** Compromiso ABIERTO más reciente (si hay), con su estado por fecha (liviano). */
  compromiso: { monto: number; fecha: string; estado: EstadoCompromiso } | null;
}

/** Estado de gestión por cliente para pintar chips en la lista de Mora. Liviano:
 *  el estado del compromiso acá se calcula por FECHA (vigente/vence hoy/incumplido);
 *  la verificación por pagos (cumplido) vive en el modal y en Mi jornada. */
export async function getEstadoGestionClientes(
  db: SupabaseClient,
  clienteIds: string[],
  hoy: Date = new Date(),
): Promise<Map<string, EstadoGestionCliente>> {
  const out = new Map<string, EstadoGestionCliente>();
  if (clienteIds.length === 0) return out;
  const hoyStr = hoyStrUY(hoy);
  const inicioHoy = `${hoyStr}T00:00:00-03:00`;

  const filasPorCliente = new Map<string, { tipo: TipoGestion; monto: number | null; fecha: string | null; creado: string }[]>();
  for (const lote of enLotes(clienteIds)) {
    const { data, error } = await db
      .from("gestiones_cobranza")
      .select("cliente_id, tipo, monto_compromiso, fecha_compromiso, creado_en")
      .in("cliente_id", lote)
      .order("creado_en", { ascending: false });
    if (error) {
      if (tablaFaltante(error)) return out; // 0055 sin correr → sin gestiones
      throw error;
    }
    for (const r of data ?? []) {
      const cid = r.cliente_id as string;
      const arr = filasPorCliente.get(cid) ?? [];
      arr.push({
        tipo: r.tipo as TipoGestion,
        monto: r.monto_compromiso != null ? Number(r.monto_compromiso) : null,
        fecha: (r.fecha_compromiso as string | null) ?? null,
        creado: r.creado_en as string,
      });
      filasPorCliente.set(cid, arr);
    }
  }

  for (const [cid, filas] of filasPorCliente) {
    const gestionadoHoy = filas.some((f) => f.creado >= inicioHoy);
    const ultimoTipo = filas[0]?.tipo ?? null;
    const comp = filas.find((f) => f.monto != null && f.fecha != null);
    let compromiso: EstadoGestionCliente["compromiso"] = null;
    if (comp && comp.monto != null && comp.fecha != null) {
      const estado: EstadoCompromiso =
        comp.fecha < hoyStr ? "incumplido" : comp.fecha === hoyStr ? "vence_hoy" : "vigente";
      compromiso = { monto: comp.monto, fecha: comp.fecha, estado };
    }
    out.set(cid, { gestionadoHoy, ultimoTipo, compromiso });
  }
  return out;
}

export interface CompromisoItem {
  clienteId: string;
  gestorNombre: string | null;
  monto: number;
  fecha: string;
  pagadoDesde: number;
  estado: EstadoCompromiso;
}

export interface ResumenCompromisos {
  venceHoy: CompromisoItem[];
  incumplidos: CompromisoItem[];
  cumplidosHoy: number;
  vigentes: number;
}

/** Compromisos abiertos de la zona, auto-verificados contra pagos. Para la
 *  Apertura de "Mi jornada": a quién reclamarle hoy y quién quedó mal. */
export async function getResumenCompromisos(
  db: SupabaseClient,
  alcance: Alcance,
  hoy: Date = new Date(),
): Promise<ResumenCompromisos> {
  const hoyStr = hoyStrUY(hoy);
  // Ventana: promesas de los últimos 30 días hacia adelante 14. Fuera de eso no
  // es "seguimiento del día".
  const desde = new Date(hoy.getTime() - 30 * 864e5);
  const hasta = new Date(hoy.getTime() + 14 * 864e5);
  const desdeStr = hoyStrUY(desde);
  const hastaStr = hoyStrUY(hasta);

  // Traemos los compromisos de la ventana. RLS ya acota a la zona; si hay alcance
  // no-global, además filtramos por clienteIds (en lotes) para no barrer de más.
  type Fila = { cliente_id: string; gestor_nombre: string | null; monto_compromiso: number; fecha_compromiso: string; creado_en: string };
  const filas: Fila[] = [];
  const correr = async (lote: string[] | null) => {
    let q = db
      .from("gestiones_cobranza")
      .select("cliente_id, gestor_nombre, monto_compromiso, fecha_compromiso, creado_en")
      .not("monto_compromiso", "is", null)
      .not("fecha_compromiso", "is", null)
      .gte("fecha_compromiso", desdeStr)
      .lte("fecha_compromiso", hastaStr)
      .order("creado_en", { ascending: false });
    if (lote) q = q.in("cliente_id", lote);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data ?? []) filas.push(r as unknown as Fila);
  };
  try {
    if (alcance.global) {
      await correr(null);
    } else {
      if (alcance.clienteIds.length === 0) return { venceHoy: [], incumplidos: [], cumplidosHoy: 0, vigentes: 0 };
      for (const lote of enLotes(alcance.clienteIds)) await correr(lote);
    }
  } catch (e) {
    if (tablaFaltante(e)) return { venceHoy: [], incumplidos: [], cumplidosHoy: 0, vigentes: 0 }; // 0055 sin correr
    throw e;
  }

  // El compromiso VIGENTE de cada cliente = el más reciente (supersede a los viejos).
  const ultimoPorCliente = new Map<string, Fila>();
  for (const f of filas) if (!ultimoPorCliente.has(f.cliente_id)) ultimoPorCliente.set(f.cliente_id, f);
  const compromisos = [...ultimoPorCliente.values()];
  if (compromisos.length === 0) return { venceHoy: [], incumplidos: [], cumplidosHoy: 0, vigentes: 0 };

  // Auto-verificación: pagos de esos clientes desde el compromiso más viejo.
  const minCreado = compromisos.reduce((m, f) => (f.creado_en < m ? f.creado_en : m), compromisos[0].creado_en);
  const pagos = await pagosPorClienteDesde(db, [...ultimoPorCliente.keys()], minCreado);

  const venceHoy: CompromisoItem[] = [];
  const incumplidos: CompromisoItem[] = [];
  let cumplidosHoy = 0;
  let vigentes = 0;
  for (const f of compromisos) {
    const pagadoDesde = sumaDesde(pagos.get(f.cliente_id), f.creado_en);
    const estado = estadoDe(f.monto_compromiso, f.fecha_compromiso, pagadoDesde, hoyStr)!;
    const item: CompromisoItem = {
      clienteId: f.cliente_id,
      gestorNombre: f.gestor_nombre,
      monto: Number(f.monto_compromiso),
      fecha: f.fecha_compromiso,
      pagadoDesde,
      estado,
    };
    if (estado === "cumplido") cumplidosHoy++;
    else if (estado === "vence_hoy") venceHoy.push(item);
    else if (estado === "incumplido") incumplidos.push(item);
    else vigentes++;
  }
  return { venceHoy, incumplidos, cumplidosHoy, vigentes };
}
