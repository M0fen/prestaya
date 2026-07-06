"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions de la app del cobrador.
//   · relevarCliente  → censo (alta en calle, service_role, ver 0005).
//   · registrarPagoCobrador → cobro real en `pagos` (libro inmutable) con GPS
//     y evaluación de geo-cerca (anti-fuga). Vía RLS: el cobrador solo puede
//     cobrar a sus asignados.
//   · registrarNoPagoCobrador → visita ("no estaba", "no tenía", etc.).
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import {
  crearClienteCenso,
  getClientePorDocumento,
  getClientePorId,
} from "@/lib/data/clientes";
import { getPrestamoActivoPorCliente } from "@/lib/data/prestamos";
import { getPagosDePrestamo, registrarPago } from "@/lib/data/pagos";
import { crearVisita } from "@/lib/data/visitas";
import { registrarBitacora } from "@/lib/data/bitacora";
import { calcularEstadosCarton } from "@/lib/cartones";
import { evaluarZona } from "@/lib/geo";
import { hoyUY } from "@/lib/fecha";

// ── Censo ────────────────────────────────────────────────────────────────────
export type ResultadoCenso =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function relevarCliente(input: {
  nombre: string;
  documento?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  notas?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
}): Promise<ResultadoCenso> {
  try {
    const usuario = await getUsuarioActual();
    if (!usuario || !usuario.activo) {
      return { ok: false, error: "Tu sesión no es válida. Volvé a ingresar." };
    }

    const nombre = (input.nombre ?? "").trim();
    if (nombre.length < 2) return { ok: false, error: "Poné el nombre del cliente." };
    const documento = limpiar(input.documento);
    const telefono = limpiar(input.telefono);
    const direccion = limpiar(input.direccion);
    const notas = limpiar(input.notas)?.slice(0, 500) ?? null;
    const gps_lat = numeroValido(input.gpsLat);
    const gps_lng = numeroValido(input.gpsLng);

    const db = createSupabaseAdmin();

    if (documento) {
      const yaExiste = await getClientePorDocumento(db, documento);
      if (yaExiste)
        return { ok: false, error: `Ya hay un cliente con ese documento: ${yaExiste.nombre}.` };
    }

    const cliente = await crearClienteCenso(db, {
      nombre,
      documento,
      telefono,
      direccion,
      notas,
      gps_lat,
      gps_lng,
      creado_por: usuario.id,
    });

    const { error: errAsig } = await db.from("asignaciones").insert({
      cobrador_id: usuario.id,
      cliente_id: cliente.id,
      activo: true,
    });
    if (errAsig) throw errAsig;

    // Bitácora de campo (best-effort): alta de cliente en calle, con GPS.
    await registrarBitacora(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      rol: usuario.rol,
      accion: "censo",
      clienteId: cliente.id,
      detalle: nombre,
      gpsLat: gps_lat,
      gpsLng: gps_lng,
      gpsDenegado: gps_lat == null || gps_lng == null,
    });

    revalidatePath("/cobrador");
    return { ok: true, id: cliente.id };
  } catch {
    return { ok: false, error: "No pudimos guardar el cliente. Probá de nuevo en un rato." };
  }
}

// ── Cobro (pago real) ────────────────────────────────────────────────────────
export type ResultadoCobro =
  | { ok: true; dia: number; monto: number; enZona: boolean | null }
  | { ok: false; error: string };

export async function registrarPagoCobrador(input: {
  clienteId: string;
  monto?: number | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  registradoEn?: string | null;
  opId?: string | null;
}): Promise<ResultadoCobro> {
  try {
    const usuario = await getUsuarioActual();
    if (!usuario || !usuario.activo) return { ok: false, error: "Sesión no válida." };

    const db = await createSupabaseServer();
    const cliente = await getClientePorId(db, input.clienteId);
    if (!cliente) return { ok: false, error: "Cliente no encontrado." };
    const prestamo = await getPrestamoActivoPorCliente(db, cliente.id);
    if (!prestamo) return { ok: false, error: "El cliente no tiene crédito activo." };

    // Imputar al primer día no cubierto (o al día de hoy).
    const pagos = await getPagosDePrestamo(db, prestamo.id);
    const r = calcularEstadosCarton(prestamo, pagos, hoyUY());
    const objetivo =
      r.dias.find((d) => d.estado !== "futuro" && d.montoPagado < prestamo.cuota_diaria) ??
      r.dias.find((d) => d.esHoy) ??
      r.dias.find((d) => d.estado === "futuro");
    const dia = objetivo?.dia ?? Math.max(1, r.diaActual);

    const monto =
      input.monto && input.monto > 0 ? Math.round(input.monto) : prestamo.cuota_diaria;
    const gps_lat = numeroValido(input.gpsLat);
    const gps_lng = numeroValido(input.gpsLng);

    const zona = evaluarZona(
      { lat: gps_lat, lng: gps_lng },
      { lat: cliente.gps_lat, lng: cliente.gps_lng },
    );

    try {
      await registrarPago(db, {
        prestamo_id: prestamo.id,
        dia_credito: dia,
        monto,
        registrado_por: usuario.id,
        gps_lat,
        gps_lng,
        registrado_en: input.registradoEn ?? null,
        op_id: input.opId ?? null,
      });
    } catch (e) {
      // Reintento de una op ya guardada (flush cortado): idempotente → ok.
      if (!esDuplicado(e)) throw e;
    }

    // Bitácora de campo (best-effort): quién cobró, a quién, cuánto, dónde.
    await registrarBitacora(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      rol: usuario.rol,
      accion: "cobro",
      clienteId: cliente.id,
      prestamoId: prestamo.id,
      monto,
      gpsLat: gps_lat,
      gpsLng: gps_lng,
      gpsDenegado: gps_lat == null || gps_lng == null,
      enZona: zona ? zona.enZona : null,
      deviceTs: input.registradoEn ?? null,
    });

    revalidatePath("/cobrador");
    revalidatePath(`/cobrador/cliente/${cliente.id}`);
    return { ok: true, dia, monto, enZona: zona ? zona.enZona : null };
  } catch {
    return { ok: false, error: "No pudimos registrar el pago. Probá de nuevo." };
  }
}

// ── No pago (visita) ─────────────────────────────────────────────────────────
export const MOTIVOS_NOPAGO = [
  { id: "no_estaba", label: "No estaba", emoji: "🚪", resultado: "no_estaba" },
  { id: "no_tenia", label: "No tenía", emoji: "💸", resultado: "no_pago" },
  { id: "se_nego", label: "Se negó", emoji: "🙅", resultado: "no_pago" },
  { id: "reagendado", label: "Reagendado", emoji: "📅", resultado: "otro" },
] as const;

export type MotivoNoPago = (typeof MOTIVOS_NOPAGO)[number]["id"];

export async function registrarNoPagoCobrador(input: {
  clienteId: string;
  motivo: MotivoNoPago;
  gpsLat?: number | null;
  gpsLng?: number | null;
  registradoEn?: string | null;
  opId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const usuario = await getUsuarioActual();
    if (!usuario || !usuario.activo) return { ok: false, error: "Sesión no válida." };

    const db = await createSupabaseServer();
    const prestamo = await getPrestamoActivoPorCliente(db, input.clienteId);
    if (!prestamo) return { ok: false, error: "El cliente no tiene crédito activo." };

    const m = MOTIVOS_NOPAGO.find((x) => x.id === input.motivo) ?? MOTIVOS_NOPAGO[0];
    const gps_lat = numeroValido(input.gpsLat);
    const gps_lng = numeroValido(input.gpsLng);
    try {
      await crearVisita(db, {
        prestamo_id: prestamo.id,
        cobrador_id: usuario.id,
        resultado: m.resultado,
        motivo: m.label,
        gps_lat,
        gps_lng,
        registrado_en: input.registradoEn ?? null,
        op_id: input.opId ?? null,
      });
    } catch (e) {
      // Reintento de una op ya guardada (flush cortado): idempotente → ok.
      if (!esDuplicado(e)) throw e;
    }

    // Bitácora de campo (best-effort).
    await registrarBitacora(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      rol: usuario.rol,
      accion: "no_pago",
      clienteId: input.clienteId,
      prestamoId: prestamo.id,
      detalle: m.label,
      gpsLat: gps_lat,
      gpsLng: gps_lng,
      gpsDenegado: gps_lat == null || gps_lng == null,
      deviceTs: input.registradoEn ?? null,
    });

    revalidatePath("/cobrador");
    revalidatePath(`/cobrador/cliente/${input.clienteId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "No pudimos registrar. Probá de nuevo." };
  }
}

// ── Ver ficha (beacon de bitácora) ────────────────────────────────────────────
// Registra que el cobrador ABRIÓ la ficha de un cliente, con GPS. Prueba que
// estuvo físicamente ahí (o no) antes de cobrar. Best-effort, solo cobradores.
export async function registrarVerFicha(input: {
  clienteId: string;
  gpsLat?: number | null;
  gpsLng?: number | null;
  gpsDenegado?: boolean;
}): Promise<void> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || usuario.rol !== "cobrador") return;
  const db = await createSupabaseServer();
  await registrarBitacora(db, {
    actorId: usuario.id,
    actorNombre: usuario.nombre,
    rol: usuario.rol,
    accion: "ver_ficha",
    clienteId: input.clienteId,
    gpsLat: numeroValido(input.gpsLat),
    gpsLng: numeroValido(input.gpsLng),
    gpsDenegado: Boolean(input.gpsDenegado) || numeroValido(input.gpsLat) == null,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function limpiar(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function numeroValido(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** true si el error es una violación de índice único (op_id repetido, 0006).
 *  Significa que la op ya se guardó: el reintento es idempotente, no un fallo. */
function esDuplicado(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "23505";
}
