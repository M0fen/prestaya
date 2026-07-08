// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — NÚCLEO PURO de permisos por ZONA (Fase A).
//
//  Responde, sin tocar la base ni la red: dado un ACTOR (rol + zonas), ¿qué
//  zonas puede ver y qué acciones sensibles puede ejecutar? Es la fuente de
//  verdad que comparten el panel (UI), las Server Actions (guardas) y sirve de
//  espejo de las políticas RLS (0031). Vive AISLADO y TESTEADO a propósito:
//  un error acá abre o cierra de más el acceso a dinero de terceros.
//
//  Decisiones de política fijadas con Carlos/Mauricio:
//   1. Alta de cobrador  → el supervisor SOLICITA, el admin aprueba.
//   2. Anular pagos      → admin directo; supervisor con DOBLE REGISTRO
//                          (pide uno, confirma OTRA persona distinta).
//   3. Cobrador          → UNA sola zona.
//   4. Reasignar cliente → entre zonas = SOLO admin; el supervisor solo puede
//                          mover clientes entre SUS cobradores de la MISMA zona.
// ─────────────────────────────────────────────────────────────────────────
import type { Rol } from "@/types/db";

/** Usuario del sistema con lo mínimo para decidir alcance y permisos. */
export interface Actor {
  rol: Rol;
  usuarioId: string;
  /** Zona propia del cobrador (una sola). null/undefined en admin/supervisor. */
  zonaId?: string | null;
  /** Zonas que supervisa (solo rol supervisor). Vacío = sin zonas asignadas. */
  zonasSupervisadas?: string[];
}

/** Recurso etiquetable por zona (cliente/préstamo/pago con su zona derivada). */
export interface ConZona {
  /** Zona derivada del cobrador asignado. null = sin cobrador/sin zona. */
  zonaId: string | null;
}

/** Qué zonas alcanza a ver el actor. */
export type AlcanceZonas =
  | { tipo: "todas" }
  | { tipo: "algunas"; zonas: ReadonlySet<string> }
  | { tipo: "ninguna" };

/**
 * Regla de transición segura: un supervisor SIN zonas asignadas ve TODO.
 * Antes de configurar zonas, todos los clientes/cobradores tienen zona = null;
 * si restringiéramos de una, el supervisor quedaría ciego. Al asignarle su
 * primera zona, la restricción se activa. Este mismo criterio se replica en
 * la RLS (0031). Es un default de compatibilidad, no una laguna: apenas el
 * admin le pone una zona, deja de ver el resto.
 */
export const SUPERVISOR_SIN_ZONAS_VE_TODO = true;

const zonasDe = (actor: Actor): string[] =>
  (actor.zonasSupervisadas ?? []).filter((z): z is string => !!z);

/** Alcance de zonas del actor (admin = todas; cobrador = su zona; etc.). */
export function alcanceZonas(actor: Actor): AlcanceZonas {
  if (actor.rol === "admin") return { tipo: "todas" };

  if (actor.rol === "supervisor") {
    const zonas = zonasDe(actor);
    if (zonas.length === 0) {
      return SUPERVISOR_SIN_ZONAS_VE_TODO ? { tipo: "todas" } : { tipo: "ninguna" };
    }
    return { tipo: "algunas", zonas: new Set(zonas) };
  }

  // cobrador: alcanza SU zona (para tableros por zona). El detalle fino
  // "solo mis clientes asignados" lo resuelve la asignación, no la zona.
  if (actor.zonaId) return { tipo: "algunas", zonas: new Set([actor.zonaId]) };
  return { tipo: "ninguna" };
}

/**
 * ¿El actor puede ver un recurso cuya zona derivada es `zonaId`?
 * `zonaId === null` (recurso sin zona: cliente sin cobrador) solo lo ve el
 * admin, o el supervisor bajo el fallback "sin zonas ve todo".
 */
export function puedeVerZona(actor: Actor, zonaId: string | null): boolean {
  const alcance = alcanceZonas(actor);
  if (alcance.tipo === "todas") return true;
  if (alcance.tipo === "ninguna") return false;
  return zonaId != null && alcance.zonas.has(zonaId);
}

/** Filtra una lista de recursos etiquetados por zona a los que el actor ve. */
export function filtrarPorZona<T extends ConZona>(actor: Actor, items: readonly T[]): T[] {
  const alcance = alcanceZonas(actor);
  if (alcance.tipo === "todas") return [...items];
  if (alcance.tipo === "ninguna") return [];
  return items.filter((it) => it.zonaId != null && alcance.zonas.has(it.zonaId));
}

// ═════════════════════════════════════════════════════════════════════════
//  CAPACIDADES SENSIBLES (las 4 decisiones + derivadas)
// ═════════════════════════════════════════════════════════════════════════

const esAdmin = (a: Actor) => a.rol === "admin";
const esGestor = (a: Actor) => a.rol === "admin" || a.rol === "supervisor";

/** (1) Crear un cobrador de una: SOLO el admin. */
export function puedeCrearCobradorDirecto(actor: Actor): boolean {
  return esAdmin(actor);
}

/** (1) El supervisor no crea: SOLICITA el alta (el admin la aprueba). */
export function puedeSolicitarAltaCobrador(actor: Actor): boolean {
  return actor.rol === "supervisor";
}

/** (2) Anular un pago directo, sin confirmación: SOLO el admin. */
export function puedeAnularPagoDirecto(actor: Actor): boolean {
  return esAdmin(actor);
}

/**
 * (2) El supervisor puede PEDIR anular un pago de SU zona; queda pendiente de
 * confirmación por otra persona (doble registro). `zonaPago` = zona del pago.
 */
export function puedeSolicitarAnulacion(actor: Actor, zonaPago: string | null): boolean {
  if (actor.rol !== "supervisor") return false;
  return puedeVerZona(actor, zonaPago);
}

/**
 * (2) Doble registro: la anulación pedida por `solicitanteId` la CONFIRMA otra
 * persona gestora DISTINTA (no la misma que la pidió). El admin califica.
 */
export function puedeConfirmarAnulacion(actor: Actor, solicitanteId: string): boolean {
  if (!esGestor(actor)) return false;
  return actor.usuarioId !== solicitanteId;
}

/** (4) Reasignar un cliente CRUZANDO zonas: SOLO el admin. */
export function puedeReasignarEntreZonas(actor: Actor): boolean {
  return esAdmin(actor);
}

/**
 * (4) ¿Puede reasignar un cliente del cobrador de `zonaOrigen` al de `zonaDestino`?
 *  · admin: siempre (incluso cruzando zonas).
 *  · supervisor: solo DENTRO de una zona suya (origen == destino y la supervisa).
 *  · cobrador: nunca.
 */
export function puedeReasignarCliente(
  actor: Actor,
  zonaOrigen: string | null,
  zonaDestino: string | null,
): boolean {
  if (esAdmin(actor)) return true;
  if (actor.rol !== "supervisor") return false;
  const mismaZona = zonaOrigen != null && zonaOrigen === zonaDestino;
  return mismaZona && puedeVerZona(actor, zonaOrigen);
}

/**
 * ¿Puede ESCRIBIR (crear pago/préstamo/visita) sobre un recurso cuya zona
 * derivada es `zonaRecurso`? Espejo EXACTO de las políticas INSERT de la RLS
 * (migración 0035). Un gestor escribe si ve esa zona, o si el recurso aún no
 * tiene zona (cliente sin cobrador → transición). Aislamiento: un supervisor de
 * la Zona A NO puede escribir sobre un recurso de la Zona B. El cobrador no pasa
 * por acá: su permiso de escritura va por asignación, no por zona.
 */
export function puedeEscribirEnZona(actor: Actor, zonaRecurso: string | null): boolean {
  if (!esGestor(actor)) return false;
  return zonaRecurso === null || puedeVerZona(actor, zonaRecurso);
}

/** ¿Ve la cartera / reportes agregados? Los gestores sí; el cobrador no. */
export function puedeVerCartera(actor: Actor): boolean {
  return esGestor(actor);
}

/** ¿Puede administrar zonas y sus fronteras (crear/asignar/mover)? SOLO admin. */
export function puedeAdministrarZonas(actor: Actor): boolean {
  return esAdmin(actor);
}

// ── Ayudante para construir el Actor desde el usuario del sistema ─────────

/** Mapea el Usuario (+ zonas que supervisa) al Actor puro de este módulo. */
export function actorDesde(
  u: { rol: Rol; id: string; zona_id?: string | null },
  zonasSupervisadas: string[] = [],
): Actor {
  return {
    rol: u.rol,
    usuarioId: u.id,
    zonaId: u.zona_id ?? null,
    zonasSupervisadas,
  };
}
