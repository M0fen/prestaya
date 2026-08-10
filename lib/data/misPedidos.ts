// ─────────────────────────────────────────────────────────────────────────
//  TODO LO QUE EL COBRADOR PIDIÓ Y ESTÁ ESPERANDO, EN UN SOLO LUGAR.
//
//  El problema que resuelve, medido: la app tiene TRES circuitos de "yo pido,
//  la oficina resuelve" —renovación sobre el tope, gasto de ruta, corrección de
//  un cobro— y los tres eran MUDOS del lado del que pide. El que resuelve sí
//  tiene su badge en el panel; el cobrador, en la calle, no tenía nada.
//
//  Lo que costó:
//   · 06-08 Edward pidió renovar a JORGE ($16.000). La oficina la aprobó el 08-08
//     y él nunca se enteró: la volvió a colocar el 09-08. Dos créditos, un préstamo.
//   · 09-08 tres cobradores (Yuli, Daniela, Fernando) pidieron renovaciones por
//     $48.000 que YA habían colocado el día anterior y que la oficina ya había
//     registrado en el sistema viejo. Los pedidos quedaron "pendientes" para
//     siempre, y aprobarlos habría duplicado los tres créditos.
//
//  La regla de este módulo: **un pedido nunca desaparece en silencio**. Se ve
//  mientras espera (con cuánto hace), se ve cuando lo aprueban (con qué hacer) y
//  se ve cuando lo rechazan (con el motivo). Un aviso que no dice qué hacer no es
//  un aviso, es ruido.
//
//  Se lee con el cliente ADMIN y scope EXPLÍCITO por cobrador: las tres tablas de
//  solicitudes tienen RLS de gestor, así que con la sesión del cobrador vería cero
//  filas — justo las suyas. Misma justificación que `recaudadoHoyDe` y `colocado`.
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { tablaFaltante } from "./errores";

export type TipoPedido = "renovacion" | "gasto" | "correccion";
export type EstadoPedido = "pendiente" | "aprobado" | "rechazado";

export interface Pedido {
  id: string;
  tipo: TipoPedido;
  estado: EstadoPedido;
  /** Qué pidió, en una línea: "Renovar a JORGE RODRÍGUEZ", "Nafta". */
  titulo: string;
  monto: number;
  /** Qué tiene que HACER ahora. Es lo que convierte el aviso en algo útil. */
  queHacer: string;
  /** Motivo del rechazo, si lo hay (texto de la oficina). */
  motivo: string | null;
  /** A dónde lleva el toque (ficha del cliente, normalmente). */
  href: string | null;
  pedidoIso: string;
  resueltoIso: string | null;
  /** Horas desde que se pidió: alimenta el "hace 2 días" y el orden. */
  horasEsperando: number;
}

/** Cuántos días para atrás se muestran los pedidos YA resueltos. */
const DIAS_RESUELTOS = 4;

const horasDesde = (iso: string | null, ahora: number): number =>
  iso ? Math.max(0, (ahora - new Date(iso).getTime()) / 3_600_000) : 0;

/**
 * Todos los pedidos vivos o recién resueltos de este cobrador.
 *
 * Orden deliberado: primero lo que le pide una ACCIÓN con plata (una renovación
 * aprobada que todavía no entregó), después lo que está esperando —y dentro de
 * eso, lo MÁS VIEJO arriba, porque un pedido de hace dos días es un problema y
 * uno de hace diez minutos no—, y al final lo resuelto, como constancia.
 *
 * Degrada a vacío si alguna migración no corrió: esto es un aviso, nunca puede
 * tumbar la pantalla con la que el cobrador sale a trabajar.
 */
export async function getMisPedidos(cobradorId: string, ahora: Date = new Date()): Promise<Pedido[]> {
  const t = ahora.getTime();
  const desde = new Date(t - DIAS_RESUELTOS * 24 * 3_600_000).toISOString();
  const [renov, gastos, corr] = await Promise.all([
    pedidosRenovacion(cobradorId, desde, t),
    pedidosGasto(cobradorId, desde, t),
    pedidosCorreccion(cobradorId, desde, t),
  ]);

  const peso = (p: Pedido) =>
    p.estado === "aprobado" && p.tipo === "renovacion" ? 0 : p.estado === "pendiente" ? 1 : 2;
  return [...renov, ...gastos, ...corr].sort(
    (a, b) => peso(a) - peso(b) || b.horasEsperando - a.horasEsperando,
  );
}

/** Cuántos piden atención AHORA (para el contador del encabezado). */
export function pedidosQuePidenAccion(pedidos: Pedido[]): number {
  return pedidos.filter((p) => p.estado !== "rechazado").length;
}

// ── RENOVACIONES sobre el tope ─────────────────────────────────────────────
async function pedidosRenovacion(cobradorId: string, desde: string, t: number): Promise<Pedido[]> {
  try {
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from("solicitudes_renovacion")
      .select("id, cliente_id, monto, estado, solicitado_en, resuelto_en, motivo_rechazo")
      .eq("solicitado_por", cobradorId)
      .order("solicitado_en", { ascending: false });
    if (error) throw error;
    // Las PENDIENTES se muestran siempre (no importa la antigüedad: justamente,
    // cuanto más vieja, más urgente). Las resueltas, solo las recientes.
    const filas = (data ?? []).filter(
      (r) => r.estado === "pendiente" || String(r.resuelto_en ?? "") >= desde,
    );
    if (filas.length === 0) return [];
    const ids = [...new Set(filas.map((r) => r.cliente_id as string))];
    const { data: cls } = await admin.from("clientes").select("id, nombre").in("id", ids);
    const nombre = new Map((cls ?? []).map((c) => [c.id as string, c.nombre as string]));

    return filas.map((r) => {
      const quien = nombre.get(r.cliente_id as string) ?? "un cliente";
      const monto = Math.round(Number(r.monto) || 0);
      const estado: EstadoPedido =
        r.estado === "aprobada" ? "aprobado" : r.estado === "rechazada" ? "rechazado" : "pendiente";
      return {
        id: r.id as string,
        tipo: "renovacion" as const,
        estado,
        titulo: `Renovar a ${quien}`,
        monto,
        queHacer:
          estado === "aprobado"
            ? "Entregale la plata. El crédito ya está corriendo y el capital ya se descontó de tu caja."
            : estado === "rechazado"
              ? "No se hizo. Si el cliente la necesita, renovalo por el mismo monto que tenía: eso sale al instante."
              : "NO le entregues la plata todavía. Si no puede esperar, renovalo por el mismo monto que tenía: eso sale solo, sin permiso.",
        motivo: (r.motivo_rechazo as string | null) ?? null,
        href: `/cobrador/cliente/${r.cliente_id as string}`,
        pedidoIso: r.solicitado_en as string,
        resueltoIso: (r.resuelto_en as string | null) ?? null,
        horasEsperando: horasDesde(r.solicitado_en as string, t),
      };
    });
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

// ── GASTOS de ruta ─────────────────────────────────────────────────────────
async function pedidosGasto(cobradorId: string, desde: string, t: number): Promise<Pedido[]> {
  try {
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from("solicitudes_gasto")
      .select("id, monto, categoria, descripcion, estado, solicitado_en, resuelto_en, motivo_rechazo")
      .eq("cobrador_id", cobradorId)
      .gte("solicitado_en", desde)
      .order("solicitado_en", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => {
      const estado: EstadoPedido =
        r.estado === "aprobada" ? "aprobado" : r.estado === "rechazada" ? "rechazado" : "pendiente";
      const que = ((r.categoria as string | null) || (r.descripcion as string | null) || "Gasto de ruta").trim();
      return {
        id: r.id as string,
        tipo: "gasto" as const,
        estado,
        titulo: que.charAt(0).toUpperCase() + que.slice(1),
        monto: Math.round(Number(r.monto) || 0),
        queHacer:
          estado === "aprobado"
            ? "Aprobado: ya está descontado de lo que tenés que entregar en el cierre."
            : estado === "rechazado"
              ? "No se aprobó: ese dinero SÍ te lo van a pedir en el cierre."
              : "Todavía no está aprobado: por ahora te lo van a pedir igual en el cierre.",
        motivo: (r.motivo_rechazo as string | null) ?? null,
        href: null,
        pedidoIso: r.solicitado_en as string,
        resueltoIso: (r.resuelto_en as string | null) ?? null,
        horasEsperando: horasDesde(r.solicitado_en as string, t),
      };
    });
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

// ── CORRECCIONES de un cobro (anulación con aval) ──────────────────────────
async function pedidosCorreccion(cobradorId: string, desde: string, t: number): Promise<Pedido[]> {
  try {
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from("solicitudes_anulacion")
      .select("id, pago_id, motivo, estado, solicitado_en, resuelto_en, motivo_rechazo")
      .eq("solicitado_por", cobradorId)
      .order("solicitado_en", { ascending: false });
    if (error) throw error;
    const filas = (data ?? []).filter(
      (r) => r.estado === "pendiente" || String(r.resuelto_en ?? "") >= desde,
    );
    if (filas.length === 0) return [];
    // El monto y el cliente salen del pago: sin eso el aviso diría "corrección"
    // a secas y el cobrador no sabría de cuál de sus cobros le están hablando.
    const pagoIds = [...new Set(filas.map((r) => r.pago_id as string))];
    const { data: pagos } = await admin
      .from("pagos")
      .select("id, monto, prestamo_id")
      .in("id", pagoIds);
    const pagoDe = new Map((pagos ?? []).map((p) => [p.id as string, p]));
    const prestamoIds = [...new Set((pagos ?? []).map((p) => p.prestamo_id as string))];
    const { data: pres } = await admin
      .from("prestamos")
      .select("id, cliente_id")
      .in("id", prestamoIds);
    const clienteDe = new Map((pres ?? []).map((p) => [p.id as string, p.cliente_id as string]));
    const clienteIds = [...new Set([...clienteDe.values()])];
    const { data: cls } = await admin.from("clientes").select("id, nombre").in("id", clienteIds);
    const nombre = new Map((cls ?? []).map((c) => [c.id as string, c.nombre as string]));

    return filas.map((r) => {
      const pago = pagoDe.get(r.pago_id as string);
      const cli = pago ? clienteDe.get(pago.prestamo_id as string) : null;
      const quien = cli ? (nombre.get(cli) ?? "un cliente") : "un cliente";
      const estado: EstadoPedido =
        r.estado === "confirmada" ? "aprobado" : r.estado === "rechazada" ? "rechazado" : "pendiente";
      return {
        id: r.id as string,
        tipo: "correccion" as const,
        estado,
        titulo: `Corregir un cobro de ${quien}`,
        monto: Math.round(Number(pago?.monto ?? 0)),
        queHacer:
          estado === "aprobado"
            ? "Corregido: el cobro quedó anulado en el cartón del cliente."
            : estado === "rechazado"
              ? "No se anuló: el cobro sigue como estaba. Hablá con tu supervisor."
              : "Esperando el visto de la oficina. El cobro sigue contando hasta que lo anulen.",
        motivo: (r.motivo_rechazo as string | null) ?? null,
        href: cli ? `/cobrador/cliente/${cli}` : null,
        pedidoIso: r.solicitado_en as string,
        resueltoIso: (r.resuelto_en as string | null) ?? null,
        horasEsperando: horasDesde(r.solicitado_en as string, t),
      };
    });
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}
