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
import { requireGestor } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { alcanceDelActor } from "@/lib/data/alcance";
import { getClientePorId } from "@/lib/data/clientes";
import { getPrestamoActivoPorCliente, getPrestamosActivosPorCliente } from "@/lib/data/prestamos";
import { getPagosDePrestamo, registrarPago } from "@/lib/data/pagos";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { calcularEstadosCarton } from "@/lib/cartones";
import { hoyUY } from "@/lib/fecha";

export const CANALES_PAGO: Record<string, string> = {
  efectivo: "Efectivo en oficina",
  transferencia: "Transferencia",
  supervisor: "Pago al supervisor",
};

export type ResultadoPagoPanel =
  | { ok: true; dia: number; monto: number }
  | { ok: false; error: string };

export async function registrarPagoPanel(input: {
  clienteId: string;
  prestamoId?: string | null;
  /** null/omitido → una cuota diaria. */
  monto?: number | null;
  canal?: string | null;
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

    await registrarPago(db, {
      prestamo_id: prestamo.id,
      dia_credito: dia,
      monto,
      registrado_por: usuario.id,
      gps_lat: null,
      gps_lng: null,
      registrado_en: null,
      op_id: null,
    });

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
  } catch {
    return { ok: false, error: "No pudimos registrar el pago. Probá de nuevo." };
  }
}
