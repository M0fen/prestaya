// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — INFORME "Pago Total de Ventas a Hoy" (Interés Variado).
//  Réplica de la captura 9 de Disapp. TODO DERIVADO del cartón: sin columnas de
//  dinero nuevas. Por crédito ACTIVO:
//    venta      = monto_prestado
//    total      = cuota × días (= cartón.totalAPagar; el interés ya va en la cuota)
//    interésPct = interes_pct del import si está; si no, (total−venta)/venta
//    abonos     = cartón.totalPagado
//    saldoPte   = cartón.falta   (= deuda a hoy)
//  La "Deuda Total a Hoy" = Σ saldoPte = el mismo "Capital en calle" del dashboard
//  (consistencia interna). El bruto $88,8M de "Ventas Crédito" de Disapp es
//  irreproducible desde el export → NO se usa como número principal.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularEstadosCarton } from "@/lib/cartones";
import { getActivosConPagos, pagosDeActivo } from "./activos";
import { hoyUY } from "@/lib/fecha";

export interface FilaInforme {
  id: string;
  refCredito: string | null;
  modalidad: string;
  vendedor: string | null;
  cliente: string;
  documento: string | null;
  venta: number;
  interesPct: number;
  total: number;
  saldoPte: number;
  abonos: number;
  fechaInicio: string;
  cuotas: number;
  deudaAHoy: number;
}

export interface InformeCartera {
  filas: FilaInforme[];
  totalVenta: number;
  totalRecaudado: number;
  deudaTotalAHoy: number;
  /** Interés proyectado si todos pagaran completo = Σ(total − venta). Etiquetado
   *  como PROYECCIÓN (no es interés ya cobrado — eso requeriría amortizar). */
  utilidadProyectada: number;
}

const N = (v: unknown) => Number(v);

export async function getInformeCartera(
  db: SupabaseClient,
  opts: { vendedorId?: string | null; q?: string | null } = {},
  hoy: Date = new Date(),
): Promise<InformeCartera> {
  // La RPC `app_cartera_activa` ya trae ref e interes_pct (0040) → sin 2ª consulta
  // (evita un fetch de ~2.700 filas bajo RLS que costaba segundos).
  const activos = await getActivosConPagos(db);
  const hoyCal = hoyUY(hoy);

  const termino = (opts.q ?? "").trim().toLowerCase();
  const filas: FilaInforme[] = [];
  let totalVenta = 0;
  let totalRecaudado = 0;
  let deudaTotalAHoy = 0;
  let utilidadProyectada = 0;

  for (const a of activos) {
    if (opts.vendedorId && a.cobrador_id !== opts.vendedorId) continue;

    const carton = calcularEstadosCarton(
      {
        cuota_diaria: N(a.cuota_diaria),
        total_dias: N(a.total_dias),
        fecha_inicio: a.fecha_inicio,
        frecuencia: a.frecuencia ?? "diario",
      },
      pagosDeActivo(a),
      hoyCal,
    );

    const venta = N(a.monto_prestado);
    const total = carton.totalAPagar;
    const abonos = carton.totalPagado;
    const saldoPte = carton.falta;
    const ref = a.disapp_credit_ref ?? null;
    const interesImport = a.interes_pct;
    const interesPct =
      interesImport != null ? N(interesImport) : venta > 0 ? ((total - venta) / venta) * 100 : 0;

    const fila: FilaInforme = {
      id: a.id,
      refCredito: ref,
      modalidad: a.frecuencia ?? "diario",
      vendedor: a.cobrador_nombre ?? null,
      cliente: a.cliente_nombre ?? "Cliente",
      documento: a.cliente_documento ?? null,
      venta,
      interesPct,
      total,
      saldoPte,
      abonos,
      fechaInicio: a.fecha_inicio,
      cuotas: N(a.total_dias),
      deudaAHoy: saldoPte,
    };

    if (termino) {
      const match =
        fila.cliente.toLowerCase().includes(termino) ||
        (fila.documento ?? "").toLowerCase().includes(termino) ||
        (fila.refCredito ?? "").toLowerCase().includes(termino);
      if (!match) continue;
    }

    filas.push(fila);
    totalVenta += venta;
    totalRecaudado += abonos;
    deudaTotalAHoy += saldoPte;
    utilidadProyectada += Math.max(0, total - venta);
  }

  // Orden: mayor deuda a hoy primero (los que más deben arriba).
  filas.sort((a, b) => b.deudaAHoy - a.deudaAHoy);

  return { filas, totalVenta, totalRecaudado, deudaTotalAHoy, utilidadProyectada };
}
