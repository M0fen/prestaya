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
import { hoyUY, diaUYInicioIso } from "@/lib/fecha";
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
    }>((d, h) =>
      admin
        .from("prestamos")
        .select("id, cliente_id, monto_prestado, cuota_diaria, total_dias, renovado_de, creado_en")
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
      }))
      .sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1)),
  };
}
