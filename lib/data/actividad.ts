// ─────────────────────────────────────────────────────────────────────────
//  ACTIVIDAD — la bitácora unificada del panel de auditoría.
//
//  La tabla `auditoria` sola cuenta muy poco: las acciones que IMPORTAN
//  (cobros, deshechos, bases de caja, gastos, correcciones, colocaciones,
//  censos) viven en sus propias tablas. Acá se leen TODAS las fuentes en
//  paralelo y se funden en una sola línea de tiempo, con nombre humano,
//  monto y quién lo hizo. Solo trabajo NATIVO de la app: los asientos del
//  espejo Disapp (origen/disapp_id) no son "actividad" de nadie.
//
//  Cada fuente degrada a [] si falla o tarda (conTimeout): un tablero de
//  monitoreo jamás debe caerse porque una de sus patas está lenta.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { conTimeout } from "@/lib/timeout";
import { inicioDiaUYIso } from "@/lib/fecha";

export type TipoActividad =
  | "cobro"
  | "deshecho"
  | "correccion"
  | "caja"
  | "gasto"
  | "credito"
  | "censo"
  | "gestion";

export interface EventoActividad {
  id: string;
  tipo: TipoActividad;
  /** ISO del momento real del hecho (para ordenar y agrupar por día). */
  cuando: string;
  actorId: string | null;
  actor: string;
  /** Frase corta ya humana: "Cobró a NANCY ACOSTA", "Cargó la base de Yuli". */
  titulo: string;
  monto: number | null;
  detalle: string | null;
  /** true → merece el ojo del dueño (deshecho, anulación, rechazo). */
  alerta: boolean;
}

export interface ResumenHoy {
  cobros: number;
  cobrado: number;
  deshechos: number;
  bases: number;
  creditos: number;
  censos: number;
  /** Solicitudes esperando aval (correcciones + gastos). Acción pendiente. */
  pendientes: number;
}

const T_MS = 6000;

/** Nunca tirar por una fuente: sin datos es mejor que sin pantalla. */
async function segura<T>(p: PromiseLike<T>, vacio: T, etiqueta: string): Promise<T> {
  try {
    return await conTimeout(Promise.resolve(p), T_MS, etiqueta);
  } catch {
    return vacio;
  }
}

type Fila = Record<string, unknown>;
const nombreCliente = (r: Fila): string => {
  // PostgREST anida: prestamos(clientes(nombre)). Defensivo: si falta, "un cliente".
  const p = r.prestamos as { clientes?: { nombre?: string } | null } | null;
  return p?.clientes?.nombre || "un cliente";
};

/** Bitácora unificada desde `desdeIso` (hasta `hastaIso` si se pasa).
 *  Trae hasta ~500 hechos por fuente, ya ordenados del más nuevo al más viejo. */
export async function getActividad(
  db: SupabaseClient,
  desdeIso: string,
  hastaIso?: string,
): Promise<EventoActividad[]> {
  const CAP = 500;
  const rango = <Q extends { gte: (c: string, v: string) => Q; lt: (c: string, v: string) => Q }>(
    q: Q,
    col: string,
  ): Q => (hastaIso ? q.gte(col, desdeIso).lt(col, hastaIso) : q.gte(col, desdeIso));

  // Nombres del equipo, una sola vez (evita 7 joins).
  const usuariosQ = db.from("usuarios").select("id, nombre, apodo");

  const pagosQ = rango(
    db
      .from("pagos")
      .select(
        "id, monto, registrado_por, registrado_en, anulado, anulado_por, anulado_en, motivo_anulacion, prestamos(clientes(nombre))",
      )
      .is("origen", null),
    "registrado_en",
  )
    .order("registrado_en", { ascending: false })
    .limit(CAP);

  // Deshechos/anulados cuya ANULACIÓN cae en el rango (el cobro pudo ser antes).
  const anuladosQ = rango(
    db
      .from("pagos")
      .select(
        "id, monto, registrado_por, registrado_en, anulado_por, anulado_en, motivo_anulacion, prestamos(clientes(nombre))",
      )
      .is("origen", null)
      .eq("anulado", true),
    "anulado_en",
  )
    .order("anulado_en", { ascending: false })
    .limit(CAP);

  const aperturasQ = rango(
    db.from("aperturas_caja").select("id, cobrador_id, fecha, base, entregada_por, registrado_en"),
    "registrado_en",
  )
    .order("registrado_en", { ascending: false })
    .limit(CAP);

  const gastosQ = rango(
    db
      .from("solicitudes_gasto")
      .select(
        "id, cobrador_id, monto, categoria, descripcion, estado, solicitado_por, solicitado_por_nombre, solicitado_en, resuelto_por, resuelto_por_nombre, resuelto_en",
      ),
    "solicitado_en",
  )
    .order("solicitado_en", { ascending: false })
    .limit(CAP);

  const correccionesQ = rango(
    db
      .from("solicitudes_anulacion")
      .select(
        "id, motivo, estado, solicitado_por, solicitado_por_nombre, solicitado_en, resuelto_por, resuelto_por_nombre, resuelto_en, pagos(monto, prestamos(clientes(nombre)))",
      ),
    "solicitado_en",
  )
    .order("solicitado_en", { ascending: false })
    .limit(CAP);

  const creditosQ = rango(
    db
      .from("prestamos")
      .select("id, monto_prestado, creado_por, creado_en, producto_nombre, frecuencia, clientes(nombre)")
      .is("disapp_credit_id", null)
      .neq("estado", "cancelado"), // una venta deshecha no es "Colocó un crédito"
    "creado_en",
  )
    .order("creado_en", { ascending: false })
    .limit(CAP);

  const censosQ = rango(
    db.from("clientes").select("id, nombre, creado_por, creado_en").is("disapp_id", null),
    "creado_en",
  )
    .order("creado_en", { ascending: false })
    .limit(CAP);

  // "Deshizo un pago" ya sale (mejor contado) del libro de pagos → se filtra acá.
  const auditoriaQ = rango(db.from("auditoria").select("*"), "creado_en")
    .order("creado_en", { ascending: false })
    .limit(CAP);

  const [usuarios, pagos, anulados, aperturas, gastos, correcciones, creditos, censos, meta] =
    await Promise.all([
      segura(usuariosQ.then((r) => r.data ?? []), [], "actividad:usuarios"),
      segura(pagosQ.then((r) => r.data ?? []), [], "actividad:pagos"),
      segura(anuladosQ.then((r) => r.data ?? []), [], "actividad:anulados"),
      segura(aperturasQ.then((r) => r.data ?? []), [], "actividad:aperturas"),
      segura(gastosQ.then((r) => r.data ?? []), [], "actividad:gastos"),
      segura(correccionesQ.then((r) => r.data ?? []), [], "actividad:correcciones"),
      segura(creditosQ.then((r) => r.data ?? []), [], "actividad:creditos"),
      segura(censosQ.then((r) => r.data ?? []), [], "actividad:censos"),
      segura(auditoriaQ.then((r) => r.data ?? []), [], "actividad:auditoria"),
    ]);

  const quien = new Map<string, string>();
  for (const u of usuarios as Fila[]) {
    const n = (u.apodo as string | null) || (u.nombre as string);
    quien.set(u.id as string, n);
  }
  const nombreDe = (id: unknown): string => (id ? (quien.get(id as string) ?? "alguien del equipo") : "—");

  const eventos: EventoActividad[] = [];

  for (const r of pagos as Fila[]) {
    if (r.anulado) continue; // el cobro deshecho se cuenta como "deshecho", no dos veces
    eventos.push({
      id: `p-${r.id}`,
      tipo: "cobro",
      cuando: r.registrado_en as string,
      actorId: (r.registrado_por as string | null) ?? null,
      actor: nombreDe(r.registrado_por),
      titulo: `Cobró a ${nombreCliente(r)}`,
      monto: Number(r.monto),
      detalle: null,
      alerta: false,
    });
  }

  for (const r of anulados as Fila[]) {
    eventos.push({
      id: `a-${r.id}`,
      tipo: "deshecho",
      cuando: (r.anulado_en as string | null) ?? (r.registrado_en as string),
      actorId: (r.anulado_por as string | null) ?? null,
      actor: nombreDe(r.anulado_por),
      titulo: `Deshizo un cobro a ${nombreCliente(r)}`,
      monto: Number(r.monto),
      detalle: (r.motivo_anulacion as string | null) ?? null,
      alerta: true,
    });
  }

  for (const r of aperturas as Fila[]) {
    eventos.push({
      id: `b-${r.id}`,
      tipo: "caja",
      cuando: r.registrado_en as string,
      actorId: (r.entregada_por as string | null) ?? null,
      actor: nombreDe(r.entregada_por),
      titulo: `Cargó la base de ${nombreDe(r.cobrador_id)}`,
      monto: Number(r.base),
      detalle: null,
      alerta: false,
    });
  }

  for (const r of gastos as Fila[]) {
    eventos.push({
      id: `g-${r.id}`,
      tipo: "gasto",
      cuando: r.solicitado_en as string,
      actorId: (r.solicitado_por as string | null) ?? null,
      actor: (r.solicitado_por_nombre as string | null) || nombreDe(r.solicitado_por),
      titulo: `Pidió un gasto de ruta (${(r.categoria as string) || "varios"})`,
      monto: Number(r.monto),
      detalle: (r.descripcion as string | null) ?? null,
      alerta: false,
    });
    if (r.resuelto_en) {
      const aprobado = r.estado === "aprobada" || r.estado === "aprobado";
      eventos.push({
        id: `gr-${r.id}`,
        tipo: "gasto",
        cuando: r.resuelto_en as string,
        actorId: (r.resuelto_por as string | null) ?? null,
        actor: (r.resuelto_por_nombre as string | null) || nombreDe(r.resuelto_por),
        titulo: `${aprobado ? "Aprobó" : "Rechazó"} el gasto de ${(r.solicitado_por_nombre as string | null) || "un cobrador"}`,
        monto: Number(r.monto),
        detalle: (r.categoria as string | null) ?? null,
        alerta: !aprobado,
      });
    }
  }

  for (const r of correcciones as Fila[]) {
    const pago = r.pagos as { monto?: number; prestamos?: { clientes?: { nombre?: string } | null } | null } | null;
    const cli = pago?.prestamos?.clientes?.nombre || "un cliente";
    eventos.push({
      id: `c-${r.id}`,
      tipo: "correccion",
      cuando: r.solicitado_en as string,
      actorId: (r.solicitado_por as string | null) ?? null,
      actor: (r.solicitado_por_nombre as string | null) || nombreDe(r.solicitado_por),
      titulo: `Pidió corregir un cobro de ${cli}`,
      monto: pago?.monto != null ? Number(pago.monto) : null,
      detalle: (r.motivo as string | null) ?? null,
      alerta: false,
    });
    if (r.resuelto_en) {
      const aprobada = r.estado === "confirmada";
      eventos.push({
        id: `cr-${r.id}`,
        tipo: "correccion",
        cuando: r.resuelto_en as string,
        actorId: (r.resuelto_por as string | null) ?? null,
        actor: (r.resuelto_por_nombre as string | null) || nombreDe(r.resuelto_por),
        titulo: `${aprobada ? "Avaló" : "Rechazó"} la corrección de ${cli}`,
        monto: pago?.monto != null ? Number(pago.monto) : null,
        detalle: null,
        alerta: !aprobada,
      });
    }
  }

  for (const r of creditos as Fila[]) {
    const cli = (r.clientes as { nombre?: string } | null)?.nombre || "un cliente";
    const esVenta = !!r.producto_nombre;
    eventos.push({
      id: `k-${r.id}`,
      tipo: "credito",
      cuando: r.creado_en as string,
      actorId: (r.creado_por as string | null) ?? null,
      actor: nombreDe(r.creado_por),
      titulo: esVenta ? `Vendió ${r.producto_nombre as string} a ${cli}` : `Colocó un crédito a ${cli}`,
      monto: Number(r.monto_prestado),
      detalle: esVenta ? null : ((r.frecuencia as string | null) ?? null),
      alerta: false,
    });
  }

  for (const r of censos as Fila[]) {
    eventos.push({
      id: `n-${r.id}`,
      tipo: "censo",
      cuando: r.creado_en as string,
      actorId: (r.creado_por as string | null) ?? null,
      actor: nombreDe(r.creado_por),
      titulo: `Censó a ${r.nombre as string}`,
      monto: null,
      detalle: null,
      alerta: false,
    });
  }

  for (const r of meta as Fila[]) {
    const accion = r.accion as string;
    if (accion.startsWith("Deshizo un pago")) continue; // ya está, con monto, desde pagos
    eventos.push({
      id: `m-${r.id}`,
      tipo: "gestion",
      cuando: r.creado_en as string,
      actorId: (r.actor_id as string | null) ?? null,
      actor: (r.actor_nombre as string | null) || "—",
      titulo: accion,
      monto: null,
      detalle: (r.detalle as string | null) ?? null,
      alerta: false,
    });
  }

  eventos.sort((a, b) => (a.cuando < b.cuando ? 1 : a.cuando > b.cuando ? -1 : 0));
  return eventos;
}

/** Los números de HOY (independientes del filtro que esté mirando el dueño). */
export async function getResumenHoy(db: SupabaseClient): Promise<ResumenHoy> {
  const hoy = inicioDiaUYIso();
  const [pagos, bases, creditos, censos, pC, pG] = await Promise.all([
    segura(
      db
        .from("pagos")
        .select("monto, anulado")
        .is("origen", null)
        .gte("registrado_en", hoy)
        .limit(2000)
        .then((r) => r.data ?? []),
      [],
      "resumen:pagos",
    ),
    segura(
      db
        .from("aperturas_caja")
        .select("id", { count: "exact", head: true })
        .gte("registrado_en", hoy)
        .then((r) => r.count ?? 0),
      0,
      "resumen:bases",
    ),
    segura(
      db
        .from("prestamos")
        .select("id", { count: "exact", head: true })
        .is("disapp_credit_id", null)
        .neq("estado", "cancelado")
        .gte("creado_en", hoy)
        .then((r) => r.count ?? 0),
      0,
      "resumen:creditos",
    ),
    segura(
      db
        .from("clientes")
        .select("id", { count: "exact", head: true })
        .is("disapp_id", null)
        .gte("creado_en", hoy)
        .then((r) => r.count ?? 0),
      0,
      "resumen:censos",
    ),
    segura(
      db
        .from("solicitudes_anulacion")
        .select("id", { count: "exact", head: true })
        .eq("estado", "abierto")
        .then((r) => r.count ?? 0),
      0,
      "resumen:pend-correcciones",
    ),
    segura(
      db
        .from("solicitudes_gasto")
        .select("id", { count: "exact", head: true })
        .eq("estado", "pendiente")
        .then((r) => r.count ?? 0),
      0,
      "resumen:pend-gastos",
    ),
  ]);

  let cobros = 0;
  let cobrado = 0;
  let deshechos = 0;
  for (const p of pagos as Fila[]) {
    if (p.anulado) deshechos++;
    else {
      cobros++;
      cobrado += Number(p.monto);
    }
  }
  return { cobros, cobrado, deshechos, bases, creditos, censos, pendientes: pC + pG };
}
