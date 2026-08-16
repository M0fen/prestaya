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
import { revalidatePath } from "next/cache";
import { opIdDeterminista, esUuid } from "@/lib/idempotencia";
import { requireGestor } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { alcanceDelActor } from "@/lib/data/alcance";
import { getClientePorId } from "@/lib/data/clientes";
import { getPrestamoActivoPorCliente, getPrestamosActivosPorCliente } from "@/lib/data/prestamos";
import { getPagosDePrestamo, registrarPago, esSobrePago, esGemelo } from "@/lib/data/pagos";
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
  | { ok: false; error: string; gemelo?: boolean };

// op_id DETERMINISTA (uuid v5-like) para idempotencia del pago de panel: dos
// registros del MISMO pago (préstamo+día+monto+canal) dentro del mismo MINUTO
// colisionan en el índice único `uniq_pagos_op` (0006) → no se duplica la plata.
// Un 2º pago legítimo cae en OTRO día (FIFO) → distinto op_id → se permite. Se usa
// el núcleo compartido `opIdDeterminista` (antes había una copia local — deuda #13).

export async function registrarPagoPanel(input: {
  clienteId: string;
  prestamoId?: string | null;
  /** null/omitido → una cuota diaria. */
  monto?: number | null;
  canal?: string | null;
  /** Nonce de idempotencia generado por el cliente (uuid, estable por-envío):
   *  deduplica reintentos del MISMO submit sin descartar un 2º pago legítimo. */
  idempotencyKey?: string | null;
  /** El gestor CONFIRMÓ que el pago idéntico a minutos del anterior es real
   *  (espejo del "adelanto" del cobrador): salta el candado atómico 0147. */
  confirmarGemelo?: boolean;
}): Promise<ResultadoPagoPanel> {
  // Puerta por rol (redirige si no es gestor). Va FUERA del try para no tragarse
  // el redirect como "error genérico".
  const usuario = await requireGestor();

  const clienteId = String(input.clienteId ?? "");
  if (!esUuid(clienteId)) return { ok: false, error: "Cliente inválido." };
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
    // Tolerancia sub-peso (espejo del cartón): con cuota fraccionaria (351,04) un
    // día pagado COMPLETO queda en 351 (entero). Sin el −0,5 este día se re-elegiría
    // como objetivo para siempre → un 2º pago del mismo minuto reusaría día/monto y
    // colisionaría en el op_id determinista (23505 tratado como éxito) → una cuota
    // pagada en efectivo no entraría al libro. Con el −0,5 el objetivo avanza al día
    // siguiente (FIFO) → op_id distinto → el 2º pago se registra bien.
    const objetivo =
      r.dias.find((d) => d.estado !== "futuro" && d.montoPagado < prestamo.cuota_diaria - 0.5) ??
      r.dias.find((d) => d.esHoy) ??
      r.dias.find((d) => d.estado === "futuro");
    const dia = objetivo?.dia ?? Math.max(1, r.diaActual);

    const solicitado = montoPedido != null ? montoPedido : Math.round(prestamo.cuota_diaria);
    // Anti sobre-pago (igual que el cobro del cobrador): nunca registrar más de lo
    // que RESTA del crédito. `r.falta` es el saldo real recalculado del libro
    // inmutable. Sin esto, un pago de oficina podía dejar pagado_acum > total.
    // Redondeo tras el clamp: `r.falta` con cuota fraccionaria reintroduciría decimales.
    const monto = Math.round(Math.min(solicitado, r.falta));
    if (monto <= 0) {
      // Registrar un pago sobre un crédito YA saldado = posible doble-cobranza física.
      // Rastro durable para que la anomalía sea visible (antes se rechazaba en silencio).
      reportarError("pagoPanel.sobrepago.saldado", new Error("Pago sobre crédito ya saldado"), {
        clienteId, prestamoId: prestamo.id, solicitado,
      });
      return { ok: false, error: "Este crédito ya está saldado." };
    }

    // Idempotencia: nonce del cliente (estable por-envío) si vino y es un uuid
    // válido; si no, fallback al hash determinista por minuto. El nonce cierra el
    // borde del minuto y NO descarta un 2º pago idéntico legítimo (nonce nuevo).
    const nonceOk = esUuid(input.idempotencyKey);
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
        permitir_gemelo: !!input.confirmarGemelo,
      });
    } catch (e) {
      // El índice único frenó un duplicado (doble-submit/retry/dos gestores):
      // el pago ya quedó registrado → éxito idempotente, sin re-auditar.
      if ((e as { code?: string } | null)?.code === "23505") return { ok: true, dia, monto };
      // Candado atómico de gemelos (0147): el MISMO monto entró a este crédito
      // hace minutos. Puede ser doble-submit… o un 2º pago idéntico LEGÍTIMO
      // (transferencia + efectivo, dos cuotas juntas). Antes esto caía al catch
      // genérico "Probá de nuevo" — un reintento FÚTIL: rebota igual 10 minutos.
      // Ahora la oficina decide con un botón de confirmación (acta pre-lunes).
      if (esGemelo(e)) {
        return {
          ok: false,
          gemelo: true,
          error: `Hace unos minutos ya entró un pago de $${monto.toLocaleString("es-UY")} a este crédito. Si es OTRO pago real (transferencia + efectivo, dos cuotas), confirmalo; si fue el mismo, ya está registrado.`,
        };
      }
      // Sobre-pago rechazado bajo el candado (RPC 0079): otro pago concurrente saldó
      // el crédito primero → NO se registra (evita el sobre-cobro). Se avisa claro.
      if (esSobrePago(e)) {
        reportarError("pagoPanel.sobrepago.carrera", e, { clienteId, prestamoId: prestamo.id, monto });
        return { ok: false, error: "El crédito ya se saldó (entró otro pago primero). Recargá para ver el estado." };
      }
      throw e;
    }

    await registrarAuditoria(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      accion: `Registró un pago desde el panel (${canalLabel})`,
      entidad: "pago",
      entidadId: prestamo.id,
      // El bypass del candado deja rastro: quién confirmó que el gemelo era real.
      detalle: `${cliente.nombre} · $${monto.toLocaleString("es-UY")} · día ${dia}${input.confirmarGemelo ? " · 2º pago idéntico CONFIRMADO por el gestor" : ""}`,
    });

    revalidatePath(`/admin/clientes/${clienteId}`);
    return { ok: true, dia, monto };
  } catch (e) {
    reportarError("registrarPagoPanel", e, { clienteId });
    return { ok: false, error: "No pudimos registrar el pago. Probá de nuevo." };
  }
}
