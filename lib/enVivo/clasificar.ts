// ─────────────────────────────────────────────────────────────────────────
//  EN VIVO — las reglas PURAS del tablero de presencia (sin base, sin React):
//  qué cuenta como "ahora", cómo se funden hechos y navegación en una sola
//  línea de tiempo, y cómo se dice "hace 3 min". Las usan el servidor
//  (lib/data/enVivo) y el tablero del navegador; testeadas en clasificar.test.ts.
// ─────────────────────────────────────────────────────────────────────────

/** Señal de vida de una persona, del más caliente al más frío. Solo se miden
 *  señales de HOY (día UY): lo de ayer no es presencia, es historia. */
export type EstadoPresencia = "ahora" | "reciente" | "hoy" | "sin_senal";

/** Con la última señal dentro de estos minutos, la persona "está" en la app. */
export const AHORA_MIN = 10;
/** Hasta acá "anduvo hace un rato"; más allá, solo "entró hoy". */
export const RECIENTE_MIN = 60;

export const ORDEN_ESTADO: Record<EstadoPresencia, number> = {
  ahora: 0,
  reciente: 1,
  hoy: 2,
  sin_senal: 3,
};

export function estadoPresencia(ultimaSenalIso: string | null, ahoraMs: number): EstadoPresencia {
  if (!ultimaSenalIso) return "sin_senal";
  const min = (ahoraMs - new Date(ultimaSenalIso).getTime()) / 60_000;
  if (min <= AHORA_MIN) return "ahora";
  if (min <= RECIENTE_MIN) return "reciente";
  return "hoy";
}

/** "recién" · "hace 3 min" · "hace 2 h" · "hace 3 d" · "nunca". */
export function hace(iso: string | null, ahoraMs: number): string {
  if (!iso) return "nunca";
  const min = Math.floor((ahoraMs - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** "hace 12 s" para el reloj del tablero (segundos, no minutos). */
export function haceSegundos(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return "recién";
  if (s < 60) return `hace ${s} s`;
  return hace(new Date(Date.now() - ms).toISOString(), Date.now());
}

export type ClaseFeed = "hecho" | "nav";

/** Un renglón de la línea de tiempo: un HECHO (cobró, colocó, censó, cargó base,
 *  deshizo, marcó no-pago…) o una NAVEGACIÓN (abrió una pantalla). */
export interface ItemFeed {
  id: string;
  clase: ClaseFeed;
  /** Para el ícono/filtro: cobro · deshecho · credito · censo · caja · gasto ·
   *  correccion · gestion · no_pago · candado · nav. */
  tipo: string;
  cuando: string; // ISO
  actorId: string | null;
  actor: string;
  rol: string | null;
  titulo: string;
  monto: number | null;
  detalle: string | null;
  /** true → merece el ojo (deshecho, rechazo, candado). */
  alerta: boolean;
}

/** Funde varias fuentes ya ordenadas o no, del más nuevo al más viejo, sin
 *  repetir ids, con tope. */
export function mezclarFeed(fuentes: ItemFeed[][], limite: number): ItemFeed[] {
  const vistos = new Set<string>();
  const todo: ItemFeed[] = [];
  for (const f of fuentes) {
    for (const it of f) {
      if (vistos.has(it.id)) continue;
      vistos.add(it.id);
      todo.push(it);
    }
  }
  todo.sort((a, b) => (a.cuando < b.cuando ? 1 : a.cuando > b.cuando ? -1 : 0));
  return todo.slice(0, limite);
}

export interface PersonaVivo {
  id: string;
  nombre: string;
  rol: string;
  zona: string | null;
  estado: EstadoPresencia;
  /** Última señal de hoy (navegación o hecho), o null. */
  ultimaSenalIso: string | null;
  /** Última pantalla que abrió hoy (sección legible + path). */
  seccionActual: string | null;
  pathActual: string | null;
  vistasHoy: number;
  hechosHoy: number;
  cobrosHoy: number;
  cobradoHoy: number;
  ultimoHecho: { titulo: string; cuando: string; monto: number | null } | null;
}

export interface ResumenVivo {
  ahora: number;
  hoy: number; // con alguna señal hoy (incluye ahora y reciente)
  cobrando: number;
  cobrado: number;
  cobros: number;
  hechos: number;
  navegaciones: number;
  total: number; // personas con credenciales
}

export function resumenDe(personas: PersonaVivo[], feed: ItemFeed[]): ResumenVivo {
  let ahora = 0;
  let hoy = 0;
  let cobrando = 0;
  let cobrado = 0;
  let cobros = 0;
  for (const p of personas) {
    if (p.estado === "ahora") ahora++;
    if (p.estado !== "sin_senal") hoy++;
    if (p.cobrosHoy > 0) {
      cobrando++;
      cobrado += p.cobradoHoy;
      cobros += p.cobrosHoy;
    }
  }
  const hechos = feed.filter((f) => f.clase === "hecho").length;
  return {
    ahora,
    hoy,
    cobrando,
    cobrado,
    cobros,
    hechos,
    navegaciones: feed.length - hechos,
    total: personas.length,
  };
}

/** Orden del tablero: los que están ahora primero, después por última señal. */
export function ordenarPersonas(personas: PersonaVivo[]): PersonaVivo[] {
  return [...personas].sort((a, b) => {
    const d = ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado];
    if (d !== 0) return d;
    const sa = a.ultimaSenalIso ?? "";
    const sb = b.ultimaSenalIso ?? "";
    if (sa !== sb) return sa < sb ? 1 : -1;
    return a.nombre.localeCompare(b.nombre);
  });
}

export interface EnVivo {
  generadoEn: string;
  personas: PersonaVivo[];
  feed: ItemFeed[];
  resumen: ResumenVivo;
}
