// ─────────────────────────────────────────────────────────────────────────
//  Exportación de reportes a CSV (admin/supervisor).
//  GET /api/reportes/<tipo>?periodo=...  →  descarga un .csv (Excel-friendly).
//  tipos: cartera | caja | mora | comisiones.
//  Protegido por ROL en el servidor (un cobrador recibe 403). Corre como el
//  gestor logueado (RLS). Solo LECTURA: no muta nada.
// ─────────────────────────────────────────────────────────────────────────
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { filasACsv, conBom, type CeldaCsv } from "@/lib/reportes/csv";
import { getCarteraExport } from "@/lib/data/cartera";
import { getClientesExport, getPagosExport } from "@/lib/data/exportacion";
import { getResumenCaja, type PeriodoCaja } from "@/lib/data/caja";
import { getTableroMora } from "@/lib/data/mora";
import { getComisionesPeriodo } from "@/lib/data/comisiones";
import { normalizarPeriodo } from "@/lib/data/periodo";
import type { NivelRiesgo } from "@/types/alerta";

export const dynamic = "force-dynamic";

const TZ = "America/Montevideo";

/** Fecha de hoy (Uruguay) en "YYYY-MM-DD" para el nombre del archivo. */
const fechaHoyUY = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/** Instante ISO → "dd/mm/aaaa, HH:mm" en horario de Uruguay. */
const fechaHoraUY = (iso: string): string =>
  new Intl.DateTimeFormat("es-UY", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));

const NIVEL: Record<NivelRiesgo, string> = {
  critico: "Crítico",
  alto: "Alto",
  medio: "Medio",
  sano: "Sano",
};

function csvResponse(nombre: string, encabezados: string[], filas: CeldaCsv[][]): Response {
  const cuerpo = conBom(filasACsv(encabezados, filas));
  return new Response(cuerpo, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ tipo: string }> },
): Promise<Response> {
  // Puerta por rol en el servidor (defensa: el RLS igual limita, pero acá
  // cortamos de una a cualquiera que no sea gestor).
  const usuario = await getUsuarioActual();
  if (!usuario || !esGestor(usuario.rol)) {
    return new Response("No autorizado", { status: 403 });
  }

  const { tipo } = await ctx.params;
  const url = new URL(req.url);
  const db = await createSupabaseServer();
  const fecha = fechaHoyUY();

  if (tipo === "cartera") {
    const filas = await getCarteraExport(db);
    return csvResponse(
      `presta-ya_cartera_${fecha}.csv`,
      [
        "Cliente", "Documento", "Teléfono", "Cobrador", "Calificación", "Frecuencia",
        "Inicio", "Prestado", "Cuota", "Cuotas", "Total a pagar", "Pagado", "Saldo",
        "Avance %", "Días atrasados",
      ],
      filas.map((f) => [
        f.cliente, f.documento, f.telefono, f.cobrador, f.calificacion, f.frecuencia,
        f.inicio, f.montoPrestado, f.cuota, f.totalDias, f.totalAPagar, f.pagado, f.saldo,
        f.progresoPct, f.diasAtrasados,
      ]),
    );
  }

  if (tipo === "caja") {
    const periodo: PeriodoCaja = url.searchParams.get("periodo") === "mes" ? "mes" : "hoy";
    const r = await getResumenCaja(db, periodo, new Date(), { limiteLibro: 100000 });
    return csvResponse(
      `presta-ya_caja_${periodo}_${fecha}.csv`,
      ["Fecha y hora", "Tipo", "Concepto", "Movimiento", "Monto"],
      r.libro.map((l) => [
        fechaHoraUY(l.fechaIso),
        l.tipo === "cobro" ? "Cobro" : l.tipo,
        l.concepto,
        l.signo === 1 ? "Entra" : "Sale",
        l.monto,
      ]),
    );
  }

  if (tipo === "mora") {
    const tablero = await getTableroMora(db);
    return csvResponse(
      `presta-ya_mora_${fecha}.csv`,
      ["Cliente", "Teléfono", "Cobrador", "Nivel", "Cuotas atrasadas", "Deuda vencida", "Recargo sugerido"],
      tablero.enRiesgo.map((c) => [
        c.nombre,
        c.telefono ?? "",
        c.cobradorNombre ?? "",
        NIVEL[c.alerta.nivel],
        c.alerta.senales.atrasosTotales,
        c.alerta.senales.deudaVencida,
        c.recargoMora,
      ]),
    );
  }

  if (tipo === "comisiones") {
    const periodo = normalizarPeriodo(url.searchParams.get("periodo") ?? "mes");
    const r = await getComisionesPeriodo(db, periodo);
    return csvResponse(
      `presta-ya_comisiones_${periodo}_${fecha}.csv`,
      ["Cobrador", "Cobros", "Recaudado", "Comisión %", "Comisión $"],
      r.filas.map((f) => [f.nombre, f.cobros, f.recaudado, f.pct, f.comision]),
    );
  }

  if (tipo === "clientes") {
    const filas = await getClientesExport(db);
    return csvResponse(
      `presta-ya_clientes_${fecha}.csv`,
      ["Cliente", "Documento", "Teléfono", "Dirección", "Calificación", "Estado", "Origen", "Alta"],
      filas.map((f) => [
        f.nombre, f.documento, f.telefono, f.direccion, f.calificacion, f.estado, f.origen, f.alta,
      ]),
    );
  }

  if (tipo === "pagos") {
    const filas = await getPagosExport(db);
    return csvResponse(
      `presta-ya_pagos_${fecha}.csv`,
      ["Fecha y hora", "Cliente", "Documento", "Día", "Monto", "Anulado", "Cobrador"],
      filas.map((f) => [
        fechaHoraUY(f.fechaIso), f.cliente, f.documento, f.dia, f.monto, f.anulado ? "sí" : "no", f.cobrador,
      ]),
    );
  }

  return new Response("Reporte no encontrado", { status: 404 });
}
