// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — NÚCLEO puro del PLAN de una VENTA de tienda (P3b).
//  Client-safe: sin React, sin IO — se usa igual en la vitrina del cliente
//  (preview del plan) y en el servidor (alta real del crédito de venta), así
//  ambos muestran y guardan EXACTAMENTE lo mismo (el cliente paga lo que vio).
//
//  ⚠️ MANEJA DINERO: sin float. `precio` es el capital financiado (principal);
//  el interés se hornea en la CUOTA (igual que un préstamo normal: total a pagar
//  = cuota × cuotas, el interés va implícito en la cuota). Es la MISMA fórmula
//  que ya usaba la vitrina (round del precio con interés → ceil por cuota); acá
//  se centraliza para que no haya dos fórmulas divergentes.
// ─────────────────────────────────────────────────────────────────────────

/** Términos de un producto para armar el plan de venta. */
export interface TerminosProducto {
  /** Precio resuelto para el cliente (UYU, entero). Es el capital financiado. */
  precio: number;
  /** Interés total del producto (%). Se hornea en la cuota. */
  interesPct: number;
  /** Cantidad de cuotas del plan. */
  cuotas: number;
}

/** Plan de venta ya calculado (todo entero, sin float). */
export interface PlanVenta {
  /** Capital financiado = precio resuelto (lo que va a `monto_prestado`). */
  monto: number;
  /** Cuota por período (UYU, entero). El interés va incluido acá. */
  cuota: number;
  /** Cantidad de cuotas (= total_dias del crédito). */
  totalDias: number;
  /** Total que efectivamente cobrará el cobrador = cuota × totalDias. Es lo que
   *  debe mostrarse como "Total en cuotas" (coincide con el cartón: cuota×días). */
  totalACobrar: number;
}

/**
 * Calcula el plan de venta de un producto, opcionalmente con un plazo (cuotas)
 * distinto al del producto (el admin puede ajustar el plazo al convertir el lead).
 * Fórmula (idéntica a la vitrina, ver TiendaCliente):
 *   monto      = round(precio)                       (capital financiado)
 *   conInteres = round(precio × (1 + interes/100))   (total con interés)
 *   cuota      = ceil(conInteres / cuotas)            (se redondea HACIA ARRIBA)
 *   totalACobrar = cuota × cuotas                     (lo que se cobra de verdad)
 * El `ceil` puede hacer que el total cobrado supere `conInteres` por unos pocos
 * pesos (residuo de redondeo de la última cuota); por eso `totalACobrar` (no
 * `conInteres`) es la cifra honesta a mostrar y la que coincide con el cartón.
 */
export function calcularPlanVenta(t: TerminosProducto, plazoOverride?: number): PlanVenta {
  const precio = Math.max(0, Math.round(t.precio));
  const cuotas = Math.max(1, Math.round(plazoOverride ?? t.cuotas));
  const interes = Number.isFinite(t.interesPct) ? Math.max(0, t.interesPct) : 0;
  const monto = precio;
  const conInteres = Math.round(precio * (1 + interes / 100));
  const cuota = Math.ceil(conInteres / cuotas);
  return { monto, cuota, totalDias: cuotas, totalACobrar: cuota * cuotas };
}
