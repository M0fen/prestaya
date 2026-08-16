// ─────────────────────────────────────────────────────────────────────────
//  INFORME DEL DÍA del cobrador (pedido de Carlos, 08-13): el detalle uno por
//  uno de lo que hasta hoy solo existía como total. "Los pagos del día pueden ir
//  en informes para que ellos puedan revisar bien cómo llevan el día."
//
//  Dos listas, las dos del DÍA UY en curso (corte 03:00 UTC, como todo):
//   · PAGOS que este cobrador registró (custodia: pagos.registrado_por) —
//     con el nombre del cliente y la hora, para repasar la jornada cobro a cobro.
//   · COLOCACIONES que hizo (prestamos.creado_por): renovaciones y ventas, con
//     cuota — es la mitad "salida" de la caja, la que explica el descuento.
//
//  Se lee con ADMIN y scope explícito por cobrador (mismo criterio que
//  `recaudadoHoyDe` y `colocadoPorCobrador`): la RLS por-fila puede esconderle
//  un pago propio sobre un crédito reasignado, y esto es su rendición de cuentas.
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { hoyUY, diaUYInicioIso, diaUYFinIso } from "@/lib/fecha";
import { toIso } from "@/lib/format";
import { traerTodo } from "./paginado";

export interface PagoDelDia {
  id: string;
  clienteId: string | null;
  clienteNombre: string;
  monto: number;
  /** ISO del registro (para pintar la hora local). */
  registradoEn: string;
}

export interface ColocacionDelDia {
  prestamoId: string;
  clienteId: string;
  clienteNombre: string;
  monto: number;
  cuota: number;
  totalDias: number;
  /** true = renovación (trae linaje `renovado_de`); false = venta/primer crédito. */
  esRenovacion: boolean;
  creadoEn: string;
  /** Venta DESHECHA (deshacer del cobrador o cancelada por la oficina): se
   *  muestra tachada, no se suma. */
  cancelada?: boolean;
}

export interface InformeDia {
  pagos: PagoDelDia[];
  colocaciones: ColocacionDelDia[];
}

export async function getInformeDia(cobradorId: string, hoy: Date = new Date()): Promise<InformeDia> {
  const admin = createSupabaseAdmin();
  const desdeIso = diaUYInicioIso(toIso(hoyUY(hoy)));

  // Un solo día de UN cobrador no llega al corte de 1000 filas… hasta el día en
  // que llegue. `traerTodo` cuesta lo mismo y no deja la duda.
  const [pagos, colocaciones] = await Promise.all([
    traerTodo<{ id: string; monto: number; registrado_en: string; prestamo_id: string }>((d, h) =>
      admin
        .from("pagos")
        .select("id, monto, registrado_en, prestamo_id")
        .eq("registrado_por", cobradorId)
        .eq("anulado", false)
        .is("origen", null) // solo trabajo de la APP, no ajustes del empalme
        .gte("registrado_en", desdeIso)
        .order("id", { ascending: true })
        .range(d, h),
    ),
    traerTodo<{
      id: string;
      cliente_id: string;
      monto_prestado: number;
      cuota_diaria: number;
      total_dias: number;
      renovado_de: string | null;
      creado_en: string;
      estado: string;
    }>((d, h) =>
      admin
        .from("prestamos")
        .select("id, cliente_id, monto_prestado, cuota_diaria, total_dias, renovado_de, creado_en, estado")
        .eq("creado_por", cobradorId)
        .gte("creado_en", desdeIso)
        .order("id", { ascending: true })
        .range(d, h),
    ),
  ]);

  // Nombres: pagos → prestamos → clientes (los pagos no llevan cliente_id).
  const prestamoIds = [...new Set(pagos.map((p) => p.prestamo_id).filter(Boolean))];
  const clienteDePrestamo = new Map<string, string>();
  if (prestamoIds.length > 0) {
    const filas = await traerTodo<{ id: string; cliente_id: string }>((d, h) =>
      admin.from("prestamos").select("id, cliente_id").in("id", prestamoIds).order("id", { ascending: true }).range(d, h),
    );
    for (const f of filas) clienteDePrestamo.set(f.id, f.cliente_id);
  }
  const clienteIds = [
    ...new Set([...clienteDePrestamo.values(), ...colocaciones.map((c) => c.cliente_id)]),
  ];
  const nombreDe = new Map<string, string>();
  if (clienteIds.length > 0) {
    const { data: cls, error } = await admin.from("clientes").select("id, nombre").in("id", clienteIds);
    if (error) throw error;
    for (const c of cls ?? []) nombreDe.set(c.id as string, c.nombre as string);
  }

  return {
    // Más reciente arriba: es el orden en que el cobrador repasa "¿registré el de…?".
    pagos: pagos
      .map((p) => {
        const cid = clienteDePrestamo.get(p.prestamo_id) ?? null;
        return {
          id: p.id,
          clienteId: cid,
          clienteNombre: (cid && nombreDe.get(cid)) || "Cliente",
          monto: Math.round(Number(p.monto) || 0),
          registradoEn: p.registrado_en,
        };
      })
      .sort((a, b) => (a.registradoEn < b.registradoEn ? 1 : -1)),
    colocaciones: colocaciones
      .map((c) => ({
        prestamoId: c.id,
        clienteId: c.cliente_id,
        clienteNombre: nombreDe.get(c.cliente_id) ?? "Cliente",
        monto: Math.round(Number(c.monto_prestado) || 0),
        cuota: Math.round(Number(c.cuota_diaria) || 0),
        totalDias: Number(c.total_dias) || 0,
        esRenovacion: c.renovado_de != null,
        creadoEn: c.creado_en,
        cancelada: c.estado === "cancelado",
      }))
      .sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1)),
  };
}

// ── INFORME por RANGO para la OFICINA (queja del admin, 16-08) ─────────────
//  "Poder ver los pagos de días anteriores" y "las ventas del día y de días
//  anteriores": la lista pago a pago existía solo en la app del cobrador y solo
//  para HOY; en el panel había agregados anclados a hoy. Esta función es la
//  MISMA lectura, generalizada: rango de días UY + opcionalmente un cobrador,
//  acotada al alcance del gestor (los cobradorIds los pasa la página).

export interface PagoDelRango extends PagoDelDia {
  cobradorId: string | null;
  cobradorNombre: string;
}
export interface ColocacionDelRango extends ColocacionDelDia {
  cobradorId: string | null;
  cobradorNombre: string;
  /** Venta DESHECHA (estado cancelado): se muestra tachada, no se suma. */
  cancelada: boolean;
}
export interface InformeRango {
  pagos: PagoDelRango[];
  colocaciones: ColocacionDelRango[];
  totales: { pagos: number; recaudado: number; ventas: number; colocado: number };
}

/**
 * Pagos y colocaciones entre dos días UY (inclusive), de un cobrador o de todos
 * los del alcance. `cobradorIds` = null → sin recorte (admin); [] → nada.
 * Solo trabajo NATIVO de la app (pagos.origen null) — el import de Disapp no es
 * "un pago del día" de nadie. Cap defensivo: 62 días.
 */
export async function getInformeRango(input: {
  desdeYmd: string;
  hastaYmd: string;
  cobradorIds: string[] | null;
  cobradorId?: string | null;
}): Promise<InformeRango> {
  const admin = createSupabaseAdmin();
  const desdeIso = diaUYInicioIso(input.desdeYmd);
  const hastaIso = diaUYFinIso(input.hastaYmd);
  // Rango absurdo o vacío → vacío (la página valida; esto es la red).
  if (!(desdeIso < hastaIso)) return { pagos: [], colocaciones: [], totales: { pagos: 0, recaudado: 0, ventas: 0, colocado: 0 } };
  const soloDe = input.cobradorId
    ? [input.cobradorId]
    : input.cobradorIds; // null = todos
  if (soloDe && soloDe.length === 0) return { pagos: [], colocaciones: [], totales: { pagos: 0, recaudado: 0, ventas: 0, colocado: 0 } };

  const [pagos, colocaciones] = await Promise.all([
    traerTodo<{ id: string; monto: number; registrado_en: string; prestamo_id: string; registrado_por: string | null }>((d, h) => {
      let q = admin
        .from("pagos")
        .select("id, monto, registrado_en, prestamo_id, registrado_por")
        .eq("anulado", false)
        .is("origen", null)
        .gte("registrado_en", desdeIso)
        .lte("registrado_en", hastaIso);
      if (soloDe) q = q.in("registrado_por", soloDe);
      return q.order("id", { ascending: true }).range(d, h);
    }),
    traerTodo<{
      id: string; cliente_id: string; monto_prestado: number; cuota_diaria: number; total_dias: number;
      renovado_de: string | null; creado_en: string; creado_por: string | null; estado: string;
    }>((d, h) => {
      let q = admin
        .from("prestamos")
        .select("id, cliente_id, monto_prestado, cuota_diaria, total_dias, renovado_de, creado_en, creado_por, estado")
        .is("disapp_credit_id", null)
        .gte("creado_en", desdeIso)
        .lte("creado_en", hastaIso);
      if (soloDe) q = q.in("creado_por", soloDe);
      return q.order("id", { ascending: true }).range(d, h);
    }),
  ]);

  const prestamoIds = [...new Set(pagos.map((p) => p.prestamo_id).filter(Boolean))];
  const clienteDePrestamo = new Map<string, string>();
  if (prestamoIds.length > 0) {
    // .in() con miles de ids revienta la URL: en tandas de 200.
    for (let i = 0; i < prestamoIds.length; i += 200) {
      const tanda = prestamoIds.slice(i, i + 200);
      const { data, error } = await admin.from("prestamos").select("id, cliente_id").in("id", tanda);
      if (error) throw error;
      for (const f of data ?? []) clienteDePrestamo.set(f.id as string, f.cliente_id as string);
    }
  }
  const clienteIds = [...new Set([...clienteDePrestamo.values(), ...colocaciones.map((c) => c.cliente_id)])];
  const nombreDe = new Map<string, string>();
  for (let i = 0; i < clienteIds.length; i += 200) {
    const tanda = clienteIds.slice(i, i + 200);
    const { data, error } = await admin.from("clientes").select("id, nombre").in("id", tanda);
    if (error) throw error;
    for (const c of data ?? []) nombreDe.set(c.id as string, c.nombre as string);
  }
  const cobradorIds = [...new Set([...pagos.map((p) => p.registrado_por), ...colocaciones.map((c) => c.creado_por)].filter(Boolean) as string[])];
  const cobradorNombre = new Map<string, string>();
  if (cobradorIds.length > 0) {
    const { data, error } = await admin.from("usuarios").select("id, nombre").in("id", cobradorIds);
    if (error) throw error;
    for (const u of data ?? []) cobradorNombre.set(u.id as string, u.nombre as string);
  }

  const pagosOut: PagoDelRango[] = pagos
    .map((p) => {
      const cid = clienteDePrestamo.get(p.prestamo_id) ?? null;
      return {
        id: p.id,
        clienteId: cid,
        clienteNombre: (cid && nombreDe.get(cid)) || "Cliente",
        monto: Math.round(Number(p.monto) || 0),
        registradoEn: p.registrado_en,
        cobradorId: p.registrado_por,
        cobradorNombre: (p.registrado_por && cobradorNombre.get(p.registrado_por)) || "—",
      };
    })
    .sort((a, b) => (a.registradoEn < b.registradoEn ? 1 : -1));
  const colOut: ColocacionDelRango[] = colocaciones
    .map((c) => ({
      prestamoId: c.id,
      clienteId: c.cliente_id,
      clienteNombre: nombreDe.get(c.cliente_id) ?? "Cliente",
      monto: Math.round(Number(c.monto_prestado) || 0),
      cuota: Math.round(Number(c.cuota_diaria) || 0),
      totalDias: Number(c.total_dias) || 0,
      esRenovacion: c.renovado_de != null,
      creadoEn: c.creado_en,
      cobradorId: c.creado_por,
      cobradorNombre: (c.creado_por && cobradorNombre.get(c.creado_por)) || "—",
      cancelada: c.estado === "cancelado",
    }))
    .sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1));
  const vivas = colOut.filter((c) => !c.cancelada);
  return {
    pagos: pagosOut,
    colocaciones: colOut,
    totales: {
      pagos: pagosOut.length,
      recaudado: pagosOut.reduce((s, p) => s + p.monto, 0),
      ventas: vivas.length,
      colocado: vivas.reduce((s, c) => s + c.monto, 0),
    },
  };
}
