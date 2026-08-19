// ─────────────────────────────────────────────────────────────────────────
//  PEDIDOS DE LA CALLE EN VIVO — reglas puras de la franja del panel.
//
//  Quejas repetidas del piloto (19-08): el cobrador pedía más del +20% y el
//  supervisor no se enteraba (la solicitud nacía muda, el push exige opt-in y
//  nadie lo activó). Regla de Carlos: "que en la pantalla del supervisor
//  aparezcan esas notificaciones de forma ágil SIN tener que activar nada".
//
//  Acá vive lo que se puede probar sin navegador: qué pedidos son NUEVOS
//  respecto de los ya vistos, cómo se escribe cada línea y cómo se resume la
//  cola. El componente (AvisoPedidosVivo) solo pinta y escucha.
// ─────────────────────────────────────────────────────────────────────────
import { UYU } from "@/lib/format";
import type { SolicitudRenovacion } from "@/lib/data/solicitudesRenovacion";

export interface PedidoVivo {
  id: string;
  cliente: string;
  /** Nombre del cobrador que lo pidió (null si el dato histórico no lo trae). */
  cobrador: string | null;
  monto: number;
  /** Monto del crédito anterior (0 si no se pudo leer). */
  montoAnterior: number;
  tipo: "renovacion" | "venta";
  /** ISO del momento en que entró el pedido. */
  solicitadoEn: string;
}

export interface ResumenPedidosVivos {
  total: number;
  /** Los más NUEVOS primero (máximo `MAX_ITEMS`). */
  items: PedidoVivo[];
  /** TODOS los ids pendientes (no solo los de `items`). Es lo que el navegador
   *  "conoce": si solo aprendiera los 5 visibles, al resolverse uno el 6.º (un
   *  pedido VIEJO) entraría a la ventana y sonaría como "🔔 Nuevo pedido". */
  ids: string[];
  /** ISO del pedido más VIEJO (el que más espera) o null si no hay. */
  masViejoEn: string | null;
}

export const MAX_ITEMS = 5;

/** De la cola completa (RLS ya aplicada) al resumen que viaja al navegador. */
export function aResumen(pendientes: SolicitudRenovacion[]): ResumenPedidosVivos {
  // `getSolicitudesPendientes` ya viene de la más nueva a la más vieja; se
  // reordena igual por si la fuente cambia — el más viejo es el que urge.
  const ord = [...pendientes].sort((a, b) => (a.solicitadoEn < b.solicitadoEn ? 1 : a.solicitadoEn > b.solicitadoEn ? -1 : 0));
  return {
    total: ord.length,
    items: ord.slice(0, MAX_ITEMS).map((s) => ({
      id: s.id,
      cliente: s.clienteNombre,
      cobrador: s.solicitadoPorNombre,
      monto: Math.round(s.monto),
      montoAnterior: Math.round(s.montoAnterior ?? 0),
      tipo: s.tipo,
      solicitadoEn: s.solicitadoEn,
    })),
    ids: ord.map((s) => s.id),
    masViejoEn: ord.length ? ord[ord.length - 1].solicitadoEn : null,
  };
}

/** Pedidos del resumen que NO estaban entre los conocidos: son los que merecen
 *  toast + vibración. Los que ya estaban (o se resolvieron) no molestan. */
export function pedidosNuevos(conocidos: ReadonlySet<string>, actual: ResumenPedidosVivos): PedidoVivo[] {
  return actual.items.filter((p) => !conocidos.has(p.id));
}

/** Porcentaje de aumento del pedido sobre el anterior (entero); null sin anterior. */
export function pctAumento(monto: number, anterior: number): number | null {
  if (!(anterior > 0)) return null;
  return Math.round(((monto - anterior) / anterior) * 100);
}

/** "recién" · "hace 5 min" · "hace 2 h" · "hace 1 día" — para leer de un vistazo. */
export function hace(iso: string, ahoraMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.floor((ahoraMs - t) / 60_000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

/** Línea de UN pedido: "Víctor pide $5.000 para MARIA PEREIRA (tenía $4.000, +25%) · hace 12 min". */
export function lineaPedido(p: PedidoVivo, ahoraMs: number): string {
  const quien = p.cobrador ? nombreCorto(p.cobrador) : "Un cobrador";
  const pct = pctAumento(p.monto, p.montoAnterior);
  const ref =
    p.montoAnterior > 0
      ? ` (tenía ${UYU(p.montoAnterior)}${pct !== null && pct > 0 ? `, +${pct}%` : ""})`
      : "";
  const que = p.tipo === "venta" ? "vender" : "renovar";
  return `${quien} pide ${que} ${UYU(p.monto)} a ${p.cliente}${ref} · ${hace(p.solicitadoEn, ahoraMs)}`;
}

/** Título de la franja: cuántos esperan y hace cuánto el más viejo. */
export function tituloFranja(r: ResumenPedidosVivos, ahoraMs: number): string {
  if (r.total <= 0) return "";
  const n = r.total === 1 ? "1 pedido de la calle espera tu aprobación" : `${r.total} pedidos de la calle esperan tu aprobación`;
  const viejo = r.masViejoEn ? hace(r.masViejoEn, ahoraMs) : "";
  // Con uno solo, el "hace" ya va en la línea del pedido: no se repite.
  return r.total > 1 && viejo ? `${n} · el más viejo ${viejo}` : n;
}

/** "Víctor Moralez" → "Víctor"; "MARIA JOSE PEREZ" → "Maria Jose" no: se deja
 *  el primer nombre tal cual lo cargaron, que es como se lo nombra en la zona. */
export function nombreCorto(nombre: string): string {
  const partes = nombre.trim().split(/\s+/);
  return partes[0] ?? nombre;
}
