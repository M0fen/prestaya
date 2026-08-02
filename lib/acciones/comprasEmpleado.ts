"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Acciones de COMPRA DEL EQUIPO A CRÉDITO (0113). Autoservicio: el cobrador/
//  supervisor logueado compra para SÍ MISMO; la cuota se descuenta de su comisión.
//  Money-critical: kill-switch + idempotencia por nonce + precio server-side (RPC).
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { esUuid } from "@/lib/idempotencia";
import { crearCompraEmpleadoDb, cancelarCompraEmpleadoDb, type CompraEmpleado } from "@/lib/data/comprasEmpleado";

type ResultadoCompra = { ok: true; compra: CompraEmpleado } | { ok: false; error: string };
type Resultado = { ok: true } | { ok: false; error: string };

/**
 * El empleado logueado (cobrador/supervisor) compra un producto a crédito. La cuota
 * se descontará de su comisión al liquidarla. `opId` = nonce del cliente para que un
 * doble-tap / ACK perdido no genere dos compras.
 */
export async function comprarComoEmpleado(input: {
  productoId: string;
  cuotas: number;
  opId?: string;
}): Promise<ResultadoCompra> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return { ok: false, error: "Ingresá para comprar a crédito." };
  // Solo el equipo que cobra/supervisa (tiene comisión de dónde descontar).
  if (u.rol !== "cobrador" && u.rol !== "supervisor") {
    return { ok: false, error: "La compra a crédito del equipo es para cobradores y supervisores." };
  }
  // Kill switch: colocar una compra CREA deuda → congelar en modo solo-lectura.
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;
  if (!esUuid(input.productoId)) return { ok: false, error: "Producto inválido." };

  const cuotas = Math.max(1, Math.min(24, Math.round(Number(input.cuotas) || 1)));
  const opId = input.opId && esUuid(input.opId) ? input.opId : crypto.randomUUID();

  const db = await createSupabaseServer();
  const res = await crearCompraEmpleadoDb(db, {
    empleadoId: u.id,
    productoId: input.productoId,
    cuotas,
    opId,
    creadoPor: u.id,
  });
  if (!res.ok) return res;

  await registrarAuditoria(db, {
    actorId: u.id,
    actorNombre: u.nombre,
    accion: "Compró a crédito (equipo)",
    entidad: "producto",
    entidadId: res.compra.productoId ?? undefined,
    detalle: `${res.compra.productoNombre} · $${res.compra.total.toLocaleString("es-UY")} en ${res.compra.cuotas} cuotas de $${res.compra.cuotaMonto.toLocaleString("es-UY")} (descuento de comisión)`,
  });

  revalidatePath("/tienda");
  revalidatePath("/admin/tienda/equipo");
  return { ok: true, compra: res.compra };
}

/** Cancela una compra del equipo (admin): no se descuenta más. */
export async function cancelarCompraEmpleado(input: { id: string }): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !esAdmin(u.rol)) return { ok: false, error: "Solo el administrador cancela compras del equipo." };
  if (!esUuid(input.id)) return { ok: false, error: "Compra inválida." };
  try {
    // Cliente ADMIN (service_role): la escritura de cancelación es un UPDATE directo y
    // `compras_empleado` no tiene policy de UPDATE (RLS solo SELECT) → con el cliente
    // de sesión sería un no-op fantasma. La acción ya está gateada a admin arriba.
    const db = createSupabaseAdmin();
    const cancelada = await cancelarCompraEmpleadoDb(db, input.id);
    if (!cancelada) return { ok: false, error: "La compra no existe o ya no estaba activa." };
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre, accion: "Canceló compra del equipo",
      entidad: "producto", entidadId: input.id,
    });
    revalidatePath("/admin/tienda/equipo");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo cancelar. Probá de nuevo." };
  }
}
