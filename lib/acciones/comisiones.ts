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
import { setComisionPctDb, getComisionesPeriodo, rangoDePeriodoKey, rangosSeSolapan, rangoPgDePeriodo } from "@/lib/data/comisiones";
import { columnaFaltante } from "@/lib/data/errores";
import type { Periodo } from "@/lib/data/periodo";
import { registrarMovimientoCaja } from "@/lib/data/caja";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { crearReciboDb } from "@/lib/data/recibos";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { descontarComprasEmpleadoDb, revertirDescuentoComprasEmpleadoDb } from "@/lib/data/comprasEmpleado";
import { opIdDeterminista, esViolacionUnica } from "@/lib/idempotencia";

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
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
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
  // No liquidar sobre una base DEGRADADA: `recaudoPorRuta` devuelve null ante CUALQUIER
  // error de la RPC 0069 (incluido un blip transitorio), cayendo a la atribución por
  // `registrado_por` → el monto podría diferir del aprobado (un cobrador que tecleó
  // pagos de rutas ajenas cobraría de más) y el candado congelaría esa cifra. 0069
  // está viva; este guard solo frena el blip → el admin recarga y reintenta.
  if (!resumen.atribuidoPorRuta)
    return { ok: false, error: "No se pudo calcular la comisión por ruta. Recargá y reintentá." };
  const fila = resumen.filas.find((f) => f.cobradorId === input.cobradorId);
  const monto = Math.round(fila?.comision ?? 0);
  if (!fila || !(monto > 0)) return { ok: false, error: "La comisión es cero." };
  const nombre = fila.nombre;
  const periodoKey = resumen.periodoKey; // canónico (no el string del cliente)
  const periodoLabel = resumen.etiqueta;

  // GUARDIA ANTI-SOLAPAMIENTO (money-critical): el candado unique(cobrador, período)
  // solo frena la MISMA clave. Como día ⊂ semana ⊂ mes ⊂ año comparten recaudo,
  // liquidar 'dia:2026-07-10' y luego 'mes:2026-07' pagaría DOS VECES la comisión
  // del día 10. Acá rechazamos si el cobrador YA tiene liquidado un período cuyo
  // rango se cruza con el que se intenta (excluida la misma clave, que la maneja el
  // unique de abajo con su propio mensaje).
  const nuevoRango = { desde: resumen.desde, hasta: resumen.hasta };
  const { data: yaLiquidadas, error: eYa } = await db
    .from("comisiones_liquidadas")
    .select("periodo_key")
    .eq("cobrador_id", input.cobradorId);
  if (eYa) return { ok: false, error: "No se pudo verificar. Probá de nuevo." };
  for (const l of yaLiquidadas ?? []) {
    const key = l.periodo_key as string;
    if (key === periodoKey) continue; // misma clave → la maneja el candado unique
    const r = rangoDePeriodoKey(key);
    if (r && rangosSeSolapan(r, nuevoRango))
      return {
        ok: false,
        error: "Ese recaudo ya se comisionó en otra cadencia (día/semana/mes/año). Elegí una sola.",
      };
  }

  // CANDADO: registrar la liquidación ANTES de tocar la caja. Dos candados:
  //  · unique(cobrador, periodo_key) → frena el doble clic / misma clave (23505).
  //  · EXCLUDE de rango (0083) → cierra la CARRERA entre cadencias solapadas
  //    (día ⊂ mes) que la guardia JS de arriba no ve cuando corren a la vez (23P01).
  const filaLiq = {
    cobrador_id: input.cobradorId,
    periodo_key: periodoKey,
    monto,
    liquidado_por: u.id,
    liquidado_por_nombre: u.nombre,
  };
  const rangoPg = rangoPgDePeriodo(resumen.desde, resumen.hasta);
  let eLiq = (await db.from("comisiones_liquidadas").insert({ ...filaLiq, periodo_rango: rangoPg })).error;
  if (eLiq && columnaFaltante(eLiq)) {
    // 0083 aún no corrió (falta la columna periodo_rango) → degradar sin el rango:
    // la guardia JS de arriba sigue cubriendo el caso secuencial, sin romper la liquidación.
    eLiq = (await db.from("comisiones_liquidadas").insert(filaLiq)).error;
  }
  if (eLiq) {
    const code = (eLiq as { code?: string }).code;
    if (code === "23505")
      return { ok: false, error: "Esa comisión ya se liquidó en este período." };
    if (code === "23P01")
      return {
        ok: false,
        error: "Ese recaudo ya se comisionó en otra cadencia (día/semana/mes/año). Elegí una sola.",
      };
    return { ok: false, error: "No se pudo liquidar. Probá de nuevo." };
  }

  // op_id DETERMINISTA del egreso: estable por (comisión, cobrador, período). Si el
  // INSERT commitea pero se pierde la respuesta (timeout/504/red), el reintento
  // colisiona en el índice único op_id (0074) → NO hay segundo egreso. Sin esto, el
  // catch de abajo borraba el candado y el reintento pagaba la comisión DOS veces.
  const opIdEgreso = opIdDeterminista("comision", input.cobradorId, periodoKey);
  try {
    // REPAGO de compras del equipo (0113): antes del egreso, descontar las cuotas
    // del período de las compras a crédito del cobrador/supervisor, hasta el tope de
    // su comisión. Idempotente a nivel PERÍODO (0117). El egreso sale NETO.
    // CADENCIA: solo se descuenta en liquidaciones NO-diarias (semana/mes/año). Con
    // cadencia 'dia' se saldaría una cuota por día → rompería el cronograma pactado.
    const puedeDescontar = !periodoKey.startsWith("dia:");
    const descuento = puedeDescontar
      ? await descontarComprasEmpleadoDb(db, {
          empleadoId: input.cobradorId,
          periodoKey,
          tope: monto,
          creadoPor: u.id,
        })
      : 0;
    const montoNeto = Math.max(0, monto - descuento);
    const notaDesc = descuento > 0 ? ` (−$${descuento.toLocaleString("es-UY")} a compras del equipo)` : "";

    // Si la comisión se fue entera a repago (neto 0) no se registra egreso (monto>0).
    if (montoNeto > 0) {
      await registrarMovimientoCaja(db, {
        tipo: "egreso",
        monto: montoNeto,
        categoria: "Comisión",
        descripcion: `Comisión ${periodoLabel} · ${nombre}${notaDesc}`,
        cobradorId: input.cobradorId,
        registradoPor: u.id,
        opId: opIdEgreso,
      });
    }
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Liquidó comisión",
      entidad: "cobrador",
      entidadId: input.cobradorId,
      detalle: `${nombre}: $${monto.toLocaleString("es-UY")}${descuento > 0 ? ` (neto $${montoNeto.toLocaleString("es-UY")}${notaDesc})` : ""} (${periodoLabel})`,
    });

    // Emite el comprobante de pago de la comisión (numerado, con monto en letras).
    // Best-effort: si falta 0046 (recibos) NO rompe la liquidación, que ya cerró.
    // El recibo refleja el NETO efectivamente pagado + nota del descuento.
    let reciboNumero: number | undefined;
    if (montoNeto > 0) {
      try {
        const recibo = await crearReciboDb(db, {
          trabajadorId: input.cobradorId,
          trabajadorNombre: nombre,
          concepto: "Comisión",
          monto: montoNeto,
          periodo: periodoLabel,
          nota: descuento > 0 ? `Descuento por compras del equipo: $${descuento.toLocaleString("es-UY")}` : null,
          emitidoPor: u.id,
          emitidoPorNombre: u.nombre,
        });
        reciboNumero = recibo.numero;
      } catch {
        /* recibos (0046) no disponible → la comisión queda liquidada igual */
      }
    }

    revalidatePath("/admin/comisiones");
    revalidatePath("/admin/caja");
    revalidatePath("/admin/recibos");
    return { ok: true, reciboNumero };
  } catch (e) {
    // Colisión de op_id (23505): el egreso YA existe (un intento previo commiteó y se
    // perdió la respuesta) → la comisión está liquidada de verdad. Es un reintento
    // idempotente, NO un fallo: se conserva el candado y se devuelve OK.
    if (esViolacionUnica(e)) {
      // El intento fallido no llegó a auditar → dejar rastro ahora (best-effort, no
      // lanza) para no perder la trazabilidad de una comisión realmente pagada.
      await registrarAuditoria(db, {
        actorId: u.id,
        actorNombre: u.nombre,
        accion: "Liquidó comisión",
        entidad: "cobrador",
        entidadId: input.cobradorId,
        detalle: `${nombre}: $${monto.toLocaleString("es-UY")} (${periodoLabel})`,
      });
      revalidatePath("/admin/comisiones");
      revalidatePath("/admin/caja");
      return { ok: true };
    }
    reportarError("liquidarComision", e, { cobradorId: input.cobradorId, periodoKey });
    // Fallo REAL del egreso (no ambiguo) → revertir el candado para no dejar
    // "liquidado" sin egreso. El op_id determinista protege igual el reintento.
    // TAMBIÉN se revierte el DESCUENTO de compras del período (restaura saldo): si no,
    // el saldo del empleado quedaría bajado sin egreso (descuento huérfano). Así el
    // reintento recomputa desde cero. Best-effort (no lanza).
    await revertirDescuentoComprasEmpleadoDb(db, { empleadoId: input.cobradorId, periodoKey }).catch(() => {});
    await db
      .from("comisiones_liquidadas")
      .delete()
      .eq("cobrador_id", input.cobradorId)
      .eq("periodo_key", periodoKey);
    return { ok: false, error: "No se pudo registrar el egreso. Probá de nuevo." };
  }
}
