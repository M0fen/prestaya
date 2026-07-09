// ─────────────────────────────────────────────────────────────────────────
//  Exportación de reportes a CSV (admin/supervisor).
//  GET /api/reportes/<tipo>?periodo=...  →  descarga un .csv (Excel-friendly).
//  tipos: cartera | caja | mora | comisiones.
//  Protegido por ROL en el servidor (un cobrador recibe 403). Corre como el
//  gestor logueado (RLS). Solo LECTURA: no muta nada.
// ─────────────────────────────────────────────────────────────────────────
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { filasACsv, conBom, type CeldaCsv } from "@/lib/reportes/csv";
import { getCarteraExport } from "@/lib/data/cartera";
import { getClientesExport, getPagosExport } from "@/lib/data/exportacion";
import { getResumenCaja, getResumenCajaRango, type PeriodoCaja } from "@/lib/data/caja";
import { getTableroMora } from "@/lib/data/mora";
import { getRecaudos } from "@/lib/data/recaudos";
import { getInformeCartera } from "@/lib/data/informeCartera";
import { diaUYInicioIso, diaUYFinIso } from "@/lib/fecha";
import { getComisionesPeriodo } from "@/lib/data/comisiones";
import { normalizarPeriodo } from "@/lib/data/periodo";
import { reporteTipo as reporteTipoSchema } from "@/lib/validacion/esquemas";
import { permitir } from "@/lib/seguridad/rateLimit";
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
  // Puerta por rol en el servidor: los reportes/exportaciones son SOLO del dueño
  // (contienen la operación completa y datos financieros). Supervisor → 403.
  const usuario = await getUsuarioActual();
  if (!usuario || !esAdmin(usuario.rol)) {
    return new Response("No autorizado", { status: 403 });
  }

  // Rate limit por usuario (los reportes son consultas pesadas).
  if (!(await permitir("reportes", usuario.id))) {
    return new Response("Demasiadas descargas. Probá en un minuto.", { status: 429 });
  }

  const { tipo } = await ctx.params;
  // Solo tipos conocidos; cualquier otra cosa se corta acá (400).
  if (!reporteTipoSchema.safeParse(tipo).success) {
    return new Response("Reporte no encontrado", { status: 400 });
  }
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
    // Rango explícito Desde/Hasta si viene; si no, el periodo hoy/mes (compat).
    const ymd = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const desdeYmd = ymd(url.searchParams.get("desde"));
    const hastaYmd = ymd(url.searchParams.get("hasta"));
    let r;
    let sufijo: string;
    if (desdeYmd && hastaYmd) {
      r = await getResumenCajaRango(
        db,
        { desde: diaUYInicioIso(desdeYmd), hasta: diaUYFinIso(hastaYmd) },
        { limiteLibro: 100000 },
      );
      sufijo = `${desdeYmd}_${hastaYmd}`;
    } else {
      const periodo: PeriodoCaja = url.searchParams.get("periodo") === "mes" ? "mes" : "hoy";
      r = await getResumenCaja(db, periodo, new Date(), { limiteLibro: 100000 });
      sufijo = `${periodo}_${fecha}`;
    }
    return csvResponse(
      `presta-ya_caja_${sufijo}.csv`,
      ["Fecha y hora", "Tipo", "Concepto", "Visible", "Movimiento", "Monto"],
      r.libro.map((l) => [
        fechaHoraUY(l.fechaIso),
        l.tipo === "cobro" ? "Cobro" : l.tipo,
        l.concepto,
        l.visible ? "Sí" : "No",
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

  if (tipo === "recaudos") {
    const ymd = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fechaHoyUY());
    const desdeYmd = ymd(url.searchParams.get("desde"));
    const hastaYmd = ymd(url.searchParams.get("hasta"));
    const vendedorId = url.searchParams.get("vendedor");
    const r = await getRecaudos(db, {
      desde: diaUYInicioIso(desdeYmd),
      hasta: diaUYFinIso(hastaYmd),
      vendedorId,
      q: url.searchParams.get("q"),
    });
    return csvResponse(
      `presta-ya_recaudos_${desdeYmd}_${hastaYmd}.csv`,
      ["Ref Crédito", "Vendedor", "Cliente", "Documento", "Total Crédito", "Fecha Pago", "Recaudo", "Saldo Pendiente"],
      r.filas.map((f) => [
        f.refCredito ?? "",
        f.cobradorNombre ?? "",
        f.clienteNombre,
        f.clienteDocumento ?? "",
        f.totalCredito,
        fechaHoraUY(f.fechaIso),
        f.monto,
        f.saldoPendiente == null ? "—" : f.saldoPendiente,
      ]),
    );
  }

  if (tipo === "informe-cartera") {
    const r = await getInformeCartera(db, {
      vendedorId: url.searchParams.get("vendedor"),
      q: url.searchParams.get("q"),
    });
    return csvResponse(
      `presta-ya_informe-cartera_${fecha}.csv`,
      ["Ref", "Modalidad", "Vendedor", "Cliente", "Documento", "Venta", "Interés %", "Total", "Saldo Pte", "Abonos", "Inicio", "Cuotas", "Deuda a Hoy"],
      r.filas.map((f) => [
        f.refCredito ?? "",
        f.modalidad,
        f.vendedor ?? "",
        f.cliente,
        f.documento ?? "",
        Math.round(f.venta),
        f.interesPct.toFixed(1),
        Math.round(f.total),
        Math.round(f.saldoPte),
        Math.round(f.abonos),
        f.fechaInicio,
        f.cuotas,
        Math.round(f.deudaAHoy),
      ]),
    );
  }

  return new Response("Reporte no encontrado", { status: 404 });
}
