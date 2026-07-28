// ─────────────────────────────────────────────────────────────────────────
//  Núcleo PURO de AUDIENCIAS / SEGMENTOS (modelo unificado).
//  Un "segmento" define UN rango de personas por reglas combinables. La misma
//  definición la consumen anuncios, quiniela, rifa, tienda y push → el admin
//  define a QUIÉN una sola vez y lo canaliza a cualquier evento/información.
//
//  Aislado de la BD y de React: testeable. La capa de datos (lib/data/segmentos.ts)
//  guarda/lee la `DefinicionSegmento` como jsonb; las features filtran con
//  `clienteEnSegmento(cliente, def)`.
// ─────────────────────────────────────────────────────────────────────────
import type { Calificacion } from "@/types/db";

/** Estado del crédito del cliente HOY (derivado del cartón, no guardado). */
export type EstadoCreditoSegmento = "todos" | "al_dia" | "con_pendientes";

/**
 * Definición de un segmento. Cada dimensión es OPCIONAL: si está ausente/null,
 * NO filtra por ella. Un cliente entra si satisface TODAS las dimensiones
 * presentes (AND entre dimensiones; OR dentro de cada lista). `incluir`/`excluir`
 * son overrides por cliente individual: `excluir` SIEMPRE gana (seguridad).
 */
export interface DefinicionSegmento {
  /** Calificaciones admitidas (excelente/bueno/regular/riesgo/nuevo). null = cualquiera. */
  calificaciones?: Calificacion[] | null;
  /** zona_id admitidas. null = cualquier zona. */
  zonas?: string[] | null;
  /** cobrador_id admitidos. null = cualquier cobrador. */
  cobradores?: string[] | null;
  /** Estado del crédito requerido. Ausente = "todos". */
  estadoCredito?: EstadoCreditoSegmento;
  /** cliente_id que entran SIEMPRE (override sobre las reglas). */
  incluir?: string[] | null;
  /** cliente_id que quedan SIEMPRE fuera (gana sobre todo lo demás). */
  excluir?: string[] | null;
}

/** Los datos del cliente que el segmento evalúa (ya resueltos por la feature). */
export interface ClienteSegmentable {
  id: string;
  calificacion: Calificacion | null;
  /** Zona del cobrador asignado (o del cliente), null si no tiene. */
  zonaId: string | null;
  /** Cobrador asignado, null si no tiene. */
  cobradorId: string | null;
  /** ¿Está al día con su crédito HOY? (derivado del cartón). */
  alDia: boolean;
}

/** Un segmento "vacío" (sin dimensiones) matchea a TODOS: es el default seguro. */
export function esSegmentoTodos(def: DefinicionSegmento | null | undefined): boolean {
  if (!def) return true;
  return (
    !(def.calificaciones && def.calificaciones.length) &&
    !(def.zonas && def.zonas.length) &&
    !(def.cobradores && def.cobradores.length) &&
    (!def.estadoCredito || def.estadoCredito === "todos") &&
    !(def.incluir && def.incluir.length) &&
    !(def.excluir && def.excluir.length)
  );
}

/**
 * ¿El cliente pertenece al segmento? Regla:
 *  1. Si está en `excluir` → NO (la exclusión gana siempre).
 *  2. Si está en `incluir` → SÍ (override de las reglas).
 *  3. Si no, debe cumplir TODAS las dimensiones presentes (AND; OR dentro de listas).
 * Un segmento nulo o vacío devuelve true (le llega a todos) — default seguro para
 * no ocultar comunicación por accidente.
 */
export function clienteEnSegmento(
  cliente: ClienteSegmentable,
  def: DefinicionSegmento | null | undefined,
): boolean {
  if (!def) return true;

  // 1) Exclusión individual: gana sobre todo.
  if (def.excluir && def.excluir.includes(cliente.id)) return false;
  // 2) Inclusión individual: override de las reglas.
  if (def.incluir && def.incluir.includes(cliente.id)) return true;

  // 3) Reglas por dimensión (solo las presentes filtran).
  if (def.calificaciones && def.calificaciones.length > 0) {
    if (!cliente.calificacion || !def.calificaciones.includes(cliente.calificacion)) return false;
  }
  if (def.zonas && def.zonas.length > 0) {
    if (!cliente.zonaId || !def.zonas.includes(cliente.zonaId)) return false;
  }
  if (def.cobradores && def.cobradores.length > 0) {
    if (!cliente.cobradorId || !def.cobradores.includes(cliente.cobradorId)) return false;
  }
  if (def.estadoCredito === "al_dia" && !cliente.alDia) return false;
  if (def.estadoCredito === "con_pendientes" && cliente.alDia) return false;

  return true;
}

/** Resumen humano del segmento para mostrar en el admin ("Excelentes · Zona Centro"). */
export function describirSegmento(
  def: DefinicionSegmento | null | undefined,
  nombres?: { zonas?: Record<string, string>; cobradores?: Record<string, string> },
): string {
  if (esSegmentoTodos(def)) return "Todos los clientes";
  const partes: string[] = [];
  const d = def!;
  if (d.calificaciones && d.calificaciones.length) partes.push(d.calificaciones.map(cap).join(", "));
  if (d.zonas && d.zonas.length)
    partes.push("Zona " + d.zonas.map((z) => nombres?.zonas?.[z] ?? z.slice(0, 6)).join(", "));
  if (d.cobradores && d.cobradores.length)
    partes.push(d.cobradores.map((c) => nombres?.cobradores?.[c] ?? "cobrador").join(", "));
  if (d.estadoCredito === "al_dia") partes.push("Al día");
  if (d.estadoCredito === "con_pendientes") partes.push("Con pendientes");
  if (d.incluir && d.incluir.length) partes.push(`+${d.incluir.length} puntuales`);
  if (d.excluir && d.excluir.length) partes.push(`−${d.excluir.length} excluidos`);
  return partes.join(" · ") || "Todos los clientes";
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Normaliza/valida una definición cruda (de un form o jsonb) a algo seguro. */
export function normalizarSegmento(raw: unknown): DefinicionSegmento {
  const o = (raw ?? {}) as Record<string, unknown>;
  const CALIFS: Calificacion[] = ["nuevo", "excelente", "bueno", "regular", "riesgo"];
  const lista = (v: unknown): string[] | null => {
    if (!Array.isArray(v)) return null;
    const arr = v.filter((x): x is string => typeof x === "string" && x.length > 0);
    return arr.length ? [...new Set(arr)] : null;
  };
  const califs = Array.isArray(o.calificaciones)
    ? (o.calificaciones.filter((x): x is Calificacion => CALIFS.includes(x as Calificacion)))
    : null;
  const estado = o.estadoCredito;
  return {
    calificaciones: califs && califs.length ? [...new Set(califs)] : null,
    zonas: lista(o.zonas),
    cobradores: lista(o.cobradores),
    estadoCredito:
      estado === "al_dia" || estado === "con_pendientes" ? estado : "todos",
    incluir: lista(o.incluir),
    excluir: lista(o.excluir),
  };
}
