"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — COMISIONES (solo gestores).
//   · setComisionPct: fija la tasa (%) de un cobrador.
//   · liquidarComision: paga la comisión del período → EGRESO en caja
//     (categoría "Comisión") + queda en la auditoría. Los cobros no se tocan.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { reportarError } from "@/lib/observabilidad";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { setComisionPctDb, getComisionesPeriodo } from "@/lib/data/comisiones";
import type { Periodo } from "@/lib/data/periodo";
import { registrarMovimientoCaja } from "@/lib/data/caja";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { crearReciboDb } from "@/lib/data/recibos";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";

type Resultado = { ok: true } | { ok: false; error: string };
type ResultadoLiquidar = { ok: true; reciboNumero?: number } | { ok: false; error: string };

export async function setComisionPct(cobradorId: string, pct: number): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol))
    return { ok: false, error: "Solo el administrador puede fijar comisiones." };
  if (!cobradorId) return { ok: false, error: "Cobrador inválido." };
  // Acota [0,100] con 2 decimales.
  const p = Math.max(0, Math.min(100, Math.round((Number(pct) || 0) * 100) / 100));

  try {
    const db = await createSupabaseServer();
    await setComisionPctDb(db, cobradorId, p);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Cambió comisión",
      entidad: "cobrador",
      entidadId: cobradorId,
      detalle: `Comisión fijada en ${p}%`,
    });
    revalidatePath("/admin/comisiones");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. ¿Corriste la migración 0014?" };
  }
}

const PERIODOS: Periodo[] = ["dia", "semana", "mes", "anio"];

export async function liquidarComision(input: {
  cobradorId: string;
  /** Clave canónica del período (mes:2026-07). El monto y la clave se RECOMPUTAN
   *  en el servidor; el cliente no envía ni el monto ni una clave arbitraria. */
  periodoKey: string;
}): Promise<ResultadoLiquidar> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol))
    return { ok: false, error: "Solo el administrador puede liquidar comisiones." };
  // Kill switch (modo solo-lectura): liquidar comisión SACA plata de la caja → se
  // congela durante un freeze de emergencia.
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;
  if (!input.cobradorId || !input.periodoKey) return { ok: false, error: "Datos inválidos." };

  const db = await createSupabaseServer();

  // RECOMPUTAR el monto y la clave SERVER-SIDE (jamás confiar en el cliente): si el
  // navegador eligiera la clave, el candado unique(cobrador, periodo_key) se evadiría
  // con un string distinto ("mes:2026-07 " con un espacio → otra fila → DOBLE egreso),
  // y el monto saldría por lo que enviara el cliente. Se deriva el período de la clave
  // y se recalcula la comisión autoritativa (recaudo del período × pct, dueño de ruta).
  const periodo = (input.periodoKey.split(":")[0] ?? "") as Periodo;
  if (!PERIODOS.includes(periodo)) return { ok: false, error: "Período inválido." };
  const resumen = await getComisionesPeriodo(db, periodo);
  if (resumen.periodoKey !== input.periodoKey)
    return { ok: false, error: "El período cambió. Recargá la página y volvé a intentar." };
  const fila = resumen.filas.find((f) => f.cobradorId === input.cobradorId);
  const monto = Math.round(fila?.comision ?? 0);
  if (!fila || !(monto > 0)) return { ok: false, error: "La comisión es cero." };
  const nombre = fila.nombre;
  const periodoKey = resumen.periodoKey; // canónico (no el string del cliente)
  const periodoLabel = resumen.etiqueta;

  // CANDADO: registrar la liquidación ANTES de tocar la caja. El unique
  // (cobrador, período) hace que un segundo intento (doble clic / ya liquidado)
  // falle con 23505 → nunca se paga dos veces la misma comisión.
  const { error: eLiq } = await db.from("comisiones_liquidadas").insert({
    cobrador_id: input.cobradorId,
    periodo_key: periodoKey,
    monto,
    liquidado_por: u.id,
    liquidado_por_nombre: u.nombre,
  });
  if (eLiq) {
    if ((eLiq as { code?: string }).code === "23505")
      return { ok: false, error: "Esa comisión ya se liquidó en este período." };
    return { ok: false, error: "No se pudo liquidar. ¿Corriste la migración 0049?" };
  }

  try {
    await registrarMovimientoCaja(db, {
      tipo: "egreso",
      monto,
      categoria: "Comisión",
      descripcion: `Comisión ${periodoLabel} · ${nombre}`,
      cobradorId: input.cobradorId,
      registradoPor: u.id,
    });
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Liquidó comisión",
      entidad: "cobrador",
      entidadId: input.cobradorId,
      detalle: `${nombre}: $${monto.toLocaleString("es-UY")} (${periodoLabel})`,
    });

    // Emite el comprobante de pago de la comisión (numerado, con monto en letras).
    // Best-effort: si falta 0046 (recibos) NO rompe la liquidación, que ya cerró.
    let reciboNumero: number | undefined;
    try {
      const recibo = await crearReciboDb(db, {
        trabajadorId: input.cobradorId,
        trabajadorNombre: nombre,
        concepto: "Comisión",
        monto,
        periodo: periodoLabel,
        nota: null,
        emitidoPor: u.id,
        emitidoPorNombre: u.nombre,
      });
      reciboNumero = recibo.numero;
    } catch {
      /* recibos (0046) no disponible → la comisión queda liquidada igual */
    }

    revalidatePath("/admin/comisiones");
    revalidatePath("/admin/caja");
    revalidatePath("/admin/recibos");
    return { ok: true, reciboNumero };
  } catch (e) {
    reportarError("liquidarComision", e, { cobradorId: input.cobradorId, periodoKey });
    // La caja falló DESPUÉS del candado → revertir para no dejar "liquidado"
    // sin el egreso (si no, quedaría marcado pagado sin haber salido de caja).
    await db
      .from("comisiones_liquidadas")
      .delete()
      .eq("cobrador_id", input.cobradorId)
      .eq("periodo_key", periodoKey);
    return { ok: false, error: "No se pudo registrar el egreso. ¿Corriste la migración 0010?" };
  }
}
