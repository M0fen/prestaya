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
  /** true = NO es un pedido: es un crédito que el cobrador YA colocó por encima
   *  del +20% (regla de Carlos, 06-09: automático, sólo se avisa). No se
   *  aprueba ni se rechaza; se mira. */
  hecho?: boolean;
}

/** La fila de auditoría de un "colocado por encima del +20%", ya parseada por
 *  `getColocadosSobreTecho`. Tipo estructural para no importar la capa de datos
 *  (este módulo también corre en el navegador). */
export interface ColocadoVivo {
  id: string;
  actorNombre: string;
  creadoIso: string;
  clienteNombre: string;
  monto: number;
  montoAnterior: number;
  tipo: "renovacion" | "venta";
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

/** De la cola completa (RLS ya aplicada) al resumen que viaja al navegador.
 *
 *  `hechos` (06-09): los créditos que un cobrador YA colocó por encima del +20%
 *  en las últimas 24 h. Entran a la MISMA franja porque es el único lugar del
 *  panel que se ve sin abrir nada; se distinguen con `hecho: true` (línea y
 *  botón distintos: no hay nada que aprobar). Sin ellos, con la regla nueva la
 *  franja quedaba en 0 para siempre y el "sólo debe notificar" de Carlos moría. */
export function aResumen(pendientes: SolicitudRenovacion[], hechos: ColocadoVivo[] = []): ResumenPedidosVivos {
  const vivos: PedidoVivo[] = [
    ...pendientes.map((s) => ({
      id: s.id,
      cliente: s.clienteNombre,
      cobrador: s.solicitadoPorNombre,
      monto: Math.round(s.monto),
      montoAnterior: Math.round(s.montoAnterior ?? 0),
      tipo: s.tipo,
      solicitadoEn: s.solicitadoEn,
    })),
    ...hechos.map((h) => ({
      id: h.id,
      cliente: h.clienteNombre,
      cobrador: h.actorNombre,
      monto: Math.round(h.monto),
      montoAnterior: Math.round(h.montoAnterior),
      tipo: h.tipo,
      solicitadoEn: h.creadoIso,
      hecho: true,
    })),
  ];
  // Del más nuevo al más viejo (la fuente ya viene así; se reordena por si cambia).
  const ord = vivos.sort((a, b) => (a.solicitadoEn < b.solicitadoEn ? 1 : a.solicitadoEn > b.solicitadoEn ? -1 : 0));
  return {
    total: ord.length,
    items: ord.slice(0, MAX_ITEMS),
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
  // HECHO: ya está colocado, la plata ya salió — la línea lo dice para que
  // nadie busque un botón de aprobar que no existe.
  if (p.hecho) {
    const queH = p.tipo === "venta" ? "vendió" : "renovó";
    return `${quien} ${queH} ${UYU(p.monto)} a ${p.cliente}${ref} — ya está hecho · ${hace(p.solicitadoEn, ahoraMs)}`;
  }
  const que = p.tipo === "venta" ? "vender" : "renovar";
  return `${quien} pide ${que} ${UYU(p.monto)} a ${p.cliente}${ref} · ${hace(p.solicitadoEn, ahoraMs)}`;
}

/** ¿Todo lo que hay en la franja son colocaciones YA hechas (nada que aprobar)? */
export function soloHechos(r: ResumenPedidosVivos): boolean {
  return r.total > 0 && r.items.length > 0 && r.items.every((p) => p.hecho === true);
}

/** Título de la franja: cuántos esperan y hace cuánto el más viejo. Con la
 *  regla del 06-09 conviven dos cosas: pedidos que ESPERAN (cola vieja, hoy 0)
 *  y colocaciones YA HECHAS por encima del +20%. Se cuentan por separado. */
export function tituloFranja(r: ResumenPedidosVivos, ahoraMs: number): string {
  if (r.total <= 0) return "";
  const hechos = r.items.filter((p) => p.hecho).length;
  // `items` es una ventana (MAX_ITEMS): si la franja es SOLO hechos, el total
  // entero son hechos; si es mixta, lo que no cabe en la ventana se cuenta como
  // pendiente (lo que urge más).
  const nHechos = soloHechos(r) ? r.total : hechos;
  const nPend = r.total - nHechos;
  const partes: string[] = [];
  if (nPend > 0) partes.push(nPend === 1 ? "1 pedido de la calle espera tu aprobación" : `${nPend} pedidos de la calle esperan tu aprobación`);
  if (nHechos > 0)
    partes.push(nHechos === 1 ? "1 crédito colocado por encima del +20%" : `${nHechos} créditos colocados por encima del +20%`);
  const n = partes.join(" · ");
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
