"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Registrar un pago DESDE EL PANEL (admin/supervisor): cobros que NO nacen en
//  la calle — el cliente paga en la oficina, por transferencia, o le entrega al
//  supervisor. Escribe en el libro inmutable `pagos` (nunca se edita/borra).
//
//  Decisiones de dinero:
//   · Permiso por ZONA: el supervisor solo puede registrar pagos de clientes de
//     su alcance (el admin, cualquiera). Se valida ANTES de tocar la base.
//   · `registrado_por` = el GESTOR que lo registró (no el cobrador): así NO le
//     infla el "recaudado" de campo ni le genera un faltante-fantasma en la
//     rendición. Igual entra al recaudo TOTAL del día y al cartón del cliente.
//   · Se imputa al primer día no cubierto (misma regla FIFO que el cobro del
//     cobrador). Monto redondeado a entero (nunca float para dinero).
//   · Queda en AUDITORÍA (quién, canal, cuánto, a quién).
// ─────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireGestor } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { alcanceDelActor } from "@/lib/data/alcance";
import { getClientePorId } from "@/lib/data/clientes";
import { getPrestamoActivoPorCliente, getPrestamosActivosPorCliente } from "@/lib/data/prestamos";
import { getPagosDePrestamo, registrarPago } from "@/lib/data/pagos";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { calcularEstadosCarton } from "@/lib/cartones";
import { hoyUY } from "@/lib/fecha";
import { reportarError } from "@/lib/observabilidad";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";

export const CANALES_PAGO: Record<string, string> = {
  efectivo: "Efectivo en oficina",
  transferencia: "Transferencia",
  supervisor: "Pago al supervisor",
};

export type ResultadoPagoPanel =
  | { ok: true; dia: number; monto: number }
  | { ok: false; error: string };

/** op_id DETERMINISTA (uuid v5-like) para idempotencia del pago de panel: dos
 *  registros del MISMO pago (préstamo+día+monto+canal) dentro del mismo MINUTO
 *  colisionan en el índice único `uniq_pagos_op` (0006) → no se duplica la plata
 *  ante doble-submit, retry tras timeout percibido, o dos gestores en paralelo.
 *  Un segundo pago legítimo cae en OTRO día (FIFO) → distinto op_id → se permite. */
function opIdDeterminista(...partes: (string | number)[]): string {
  const b = createHash("sha1").update(partes.join("|")).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // versión 5
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const x = b.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export async function registrarPagoPanel(input: {
  clienteId: string;
  prestamoId?: string | null;
  /** null/omitido → una cuota diaria. */
  monto?: number | null;
  canal?: string | null;
  /** Nonce de idempotencia generado por el cliente (uuid, estable por-envío):
   *  deduplica reintentos del MISMO submit sin descartar un 2º pago legítimo. */
  idempotencyKey?: string | null;
}): Promise<ResultadoPagoPanel> {
  // Puerta por rol (redirige si no es gestor). Va FUERA del try para no tragarse
  // el redirect como "error genérico".
  const usuario = await requireGestor();

  const clienteId = String(input.clienteId ?? "");
  if (!/^[0-9a-fA-F-]{36}$/.test(clienteId)) return { ok: false, error: "Cliente inválido." };
  const canalLabel = CANALES_PAGO[input.canal ?? "efectivo"] ?? CANALES_PAGO.efectivo;
  const montoPedido =
    input.monto == null ? null : Number.isFinite(input.monto) ? Math.round(input.monto) : NaN;
  if (montoPedido != null && (Number.isNaN(montoPedido) || montoPedido <= 0))
    return { ok: false, error: "El monto debe ser un número mayor a 0." };

  try {
    const bloqueo = await bloqueoSoloLectura(); // kill switch
    if (bloqueo) return bloqueo;
    // Permiso por zona: el supervisor solo su alcance.
    const alcance = await alcanceDelActor();
    if (!alcance.global && !alcance.clienteIds.includes(clienteId))
      return { ok: false, error: "Ese cliente no es de tu zona." };

    // El permiso ya se validó por alcance → se escribe con service_role (esquiva
    // el RLS por-fila, que además no deja al supervisor insertar pagos de terceros).
    const db = createSupabaseAdmin();
    const cliente = await getClientePorId(db, clienteId);
    if (!cliente) return { ok: false, error: "Cliente no encontrado." };

    const prestamo = input.prestamoId
      ? (await getPrestamosActivosPorCliente(db, clienteId)).find((p) => p.id === input.prestamoId) ?? null
      : await getPrestamoActivoPorCliente(db, clienteId);
    if (!prestamo) return { ok: false, error: "El cliente no tiene crédito activo." };

    // Imputar al primer día no cubierto (FIFO), o a hoy, o al primer futuro.
    const pagos = await getPagosDePrestamo(db, prestamo.id);
    const r = calcularEstadosCarton(prestamo, pagos, hoyUY());
    const objetivo =
      r.dias.find((d) => d.estado !== "futuro" && d.montoPagado < prestamo.cuota_diaria) ??
      r.dias.find((d) => d.esHoy) ??
      r.dias.find((d) => d.estado === "futuro");
    const dia = objetivo?.dia ?? Math.max(1, r.diaActual);

    const monto = montoPedido != null ? montoPedido : Math.round(prestamo.cuota_diaria);
    if (monto <= 0) return { ok: false, error: "El monto debe ser mayor a 0." };

    // Idempotencia: nonce del cliente (estable por-envío) si vino y es un uuid
    // válido; si no, fallback al hash determinista por minuto. El nonce cierra el
    // borde del minuto y NO descarta un 2º pago idéntico legítimo (nonce nuevo).
    const nonceOk = typeof input.idempotencyKey === "string" && /^[0-9a-fA-F-]{36}$/.test(input.idempotencyKey);
    const opId = nonceOk
      ? (input.idempotencyKey as string)
      : opIdDeterminista(prestamo.id, dia, monto, input.canal ?? "efectivo", Math.floor(Date.now() / 60000));
    try {
      await registrarPago(db, {
        prestamo_id: prestamo.id,
        dia_credito: dia,
        monto,
        registrado_por: usuario.id,
        gps_lat: null,
        gps_lng: null,
        registrado_en: null,
        op_id: opId,
      });
    } catch (e) {
      // El índice único frenó un duplicado (doble-submit/retry/dos gestores):
      // el pago ya quedó registrado → éxito idempotente, sin re-auditar.
      if ((e as { code?: string } | null)?.code !== "23505") throw e;
      return { ok: true, dia, monto };
    }

    await registrarAuditoria(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      accion: `Registró un pago desde el panel (${canalLabel})`,
      entidad: "pago",
      entidadId: prestamo.id,
      detalle: `${cliente.nombre} · $${monto.toLocaleString("es-UY")} · día ${dia}`,
    });

    revalidatePath(`/admin/clientes/${clienteId}`);
    return { ok: true, dia, monto };
  } catch (e) {
    reportarError("registrarPagoPanel", e, { clienteId });
    return { ok: false, error: "No pudimos registrar el pago. Probá de nuevo." };
  }
}
