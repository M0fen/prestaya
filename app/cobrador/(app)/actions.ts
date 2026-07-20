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
import { MOTIVOS_NOPAGO, type MotivoNoPago } from "./motivos";
import {
  crearClienteCenso,
  getClientePorDocumento,
  getClientePorId,
} from "@/lib/data/clientes";
import {
  getPrestamoActivoPorCliente,
  getPrestamosActivosPorCliente,
} from "@/lib/data/prestamos";
import { getPagosDePrestamo, registrarPago } from "@/lib/data/pagos";
import { subirFotoCliente } from "@/lib/data/fotos";
import type { Prestamo } from "@/types/db";
import { crearVisita } from "@/lib/data/visitas";
import { registrarBitacora } from "@/lib/data/bitacora";
import { calcularEstadosCarton } from "@/lib/cartones";
import { evaluarZona } from "@/lib/geo";
import { hoyUY, sellarRegistroEn } from "@/lib/fecha";
import { validar, cobroSchema, noPagoSchema } from "@/lib/validacion/esquemas";
import { reportarError } from "@/lib/observabilidad";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";

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
  /** Precisión (accuracy, m) del fix GPS del ancla — para la bitácora anti-fuga. */
  gpsPrecision?: number | null;
  /** Foto del cliente (data URL comprimido). Anti cliente-fantasma. */
  fotoDataUrl?: string | null;
}): Promise<ResultadoCenso> {
  try {
    const usuario = await getUsuarioActual();
    if (!usuario || !usuario.activo) {
      return { ok: false, error: "Tu sesión no es válida. Volvé a ingresar." };
    }

    const nombre = (input.nombre ?? "").trim();
    if (nombre.length < 2) return { ok: false, error: "Poné el nombre del cliente." };
    // Foto OBLIGATORIA en el alta (anti cliente-fantasma). Se valida en el
    // servidor, no solo en el form (que es fácil de saltar).
    if (!input.fotoDataUrl) return { ok: false, error: "Sacale una foto al cliente para darlo de alta." };
    const documento = limpiar(input.documento);
    const telefono = limpiar(input.telefono);
    const direccion = limpiar(input.direccion);
    const notas = limpiar(input.notas)?.slice(0, 500) ?? null;
    const gpsCrudoLat = numeroValido(input.gpsLat);
    const gpsCrudoLng = numeroValido(input.gpsLng);
    // 0,0 es un fix ROTO en Uruguay (lat≈-34, lng≈-56): no se fija como ancla —
    // regiría la geo-cerca de TODOS los cobros futuros del cliente. El cliente ya lo
    // filtra; esto blinda el servidor.
    const anclaValida =
      gpsCrudoLat != null &&
      gpsCrudoLng != null &&
      !(Math.abs(gpsCrudoLat) < 0.5 && Math.abs(gpsCrudoLng) < 0.5);
    const gps_lat = anclaValida ? gpsCrudoLat : null;
    const gps_lng = anclaValida ? gpsCrudoLng : null;

    const db = createSupabaseAdmin();

    if (documento) {
      const yaExiste = await getClientePorDocumento(db, documento);
      // No se devuelve el NOMBRE: el chequeo lee cross-zona con service_role, así que
      // filtrar el nombre dejaría enumerar clientes de otra zona por documento (fuga PII).
      if (yaExiste) return { ok: false, error: "Ese documento ya está registrado." };
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

    // Sube la foto del alta. Si falla (bucket ausente, foto inválida), se hace
    // ROLLBACK del cliente recién creado: no debe quedar un alta SIN foto (la
    // regla es "alta con foto"). Como es un cliente nuevo sin pagos/créditos,
    // borrarlo es seguro.
    const foto = await subirFotoCliente(cliente.id, input.fotoDataUrl);
    if (!foto.ok) {
      await db.from("asignaciones").delete().eq("cliente_id", cliente.id);
      await db.from("clientes").delete().eq("id", cliente.id);
      return { ok: false, error: `${foto.error} No se guardó el cliente; probá de nuevo.` };
    }

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
      gpsPrecision: numeroValido(input.gpsPrecision),
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
  // `retryable`: el fallo es TEMPORAL (kill switch, error de red/DB, sesión) → la cola
  // offline NO debe envenenar el cobro (marcarlo "atascado" y pedir descartarlo); hay
  // que reintentar. Sin la marca, es un fallo PERMANENTE (crédito finalizado/saldado).
  | { ok: false; error: string; retryable?: boolean };

export async function registrarPagoCobrador(input: {
  clienteId: string;
  /** Crédito específico si el cliente tiene varios activos. null = el principal. */
  prestamoId?: string | null;
  monto?: number | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  /** Precisión del fix GPS en metros (accuracy) — para la bitácora anti-fuga. */
  gpsPrecision?: number | null;
  registradoEn?: string | null;
  opId?: string | null;
}): Promise<ResultadoCobro> {
  // Validación en el borde: rechaza input malformado antes de tocar la base.
  if (!validar(cobroSchema, input).ok) return { ok: false, error: "Datos del cobro inválidos." };
  try {
    const usuario = await getUsuarioActual();
    // Sesión: puede ser un blip de auth (no la culpa del cobro) → retryable, no envenena.
    if (!usuario || !usuario.activo) return { ok: false, error: "Sesión no válida.", retryable: true };
    const bloqueo = await bloqueoSoloLectura(); // kill switch: congela escrituras de plata
    if (bloqueo) return bloqueo;

    const db = await createSupabaseServer();
    const cliente = await getClientePorId(db, input.clienteId);
    if (!cliente) return { ok: false, error: "Cliente no encontrado." };
    const prestamo = await resolverPrestamo(db, cliente.id, input.prestamoId);
    if (!prestamo) return { ok: false, error: "El cliente no tiene crédito activo." };

    // Imputar al primer día no cubierto (o al día de hoy).
    const pagos = await getPagosDePrestamo(db, prestamo.id);
    const r = calcularEstadosCarton(prestamo, pagos, hoyUY());
    const objetivo =
      r.dias.find((d) => d.estado !== "futuro" && d.montoPagado < prestamo.cuota_diaria) ??
      r.dias.find((d) => d.esHoy) ??
      r.dias.find((d) => d.estado === "futuro");
    const dia = objetivo?.dia ?? Math.max(1, r.diaActual);

    // Anti sobre-pago (money-critical): el libro es INMUTABLE, así que nunca se
    // registra más de lo que RESTA del crédito. Un botón "cuota completa" sobre un
    // crédito casi saldado, un dedazo, o un dato viejo desde offline quedarían como
    // sobre-cobro que después hay que anular a mano y descuadra el arqueo. `r.falta`
    // es el saldo REAL recalculado del libro (no el denormalizado). Es la última
    // línea de defensa: el cliente también capa, pero el servidor es la garantía.
    const solicitado =
      input.monto && input.monto > 0 ? Math.round(input.monto) : Math.round(prestamo.cuota_diaria);
    // Redondeo tras el clamp: `r.falta` puede reintroducir una fracción si la cuota
    // fuera fraccionaria (cuota×días − Σpagos). El monto que se registra y se muestra
    // en el recibo es SIEMPRE entero (además del chokepoint en registrarPago).
    const monto = Math.round(Math.min(solicitado, r.falta));
    if (monto <= 0) return { ok: false, error: "Este crédito ya está saldado." };
    const gps_lat = numeroValido(input.gpsLat);
    const gps_lng = numeroValido(input.gpsLng);

    // La precisión (accuracy) del fix del cobro entra a la geo-cerca: con señal mala
    // el resultado queda "indeterminado" (enZona=null) en vez de acusar falso "fuera
    // de zona" a un cobrador honesto.
    const zona = evaluarZona(
      { lat: gps_lat, lng: gps_lng, precision: numeroValido(input.gpsPrecision) },
      { lat: cliente.gps_lat, lng: cliente.gps_lng },
    );

    // Día contable sellado con el reloj del SERVIDOR (tolera el reloj mal del
    // celular): un cobro offline conserva su hora real solo si es del mismo día
    // UY; si no, se sella con "ahora". Evita faltantes fantasma (ver sellarRegistroEn).
    const registradoEn = sellarRegistroEn(input.registradoEn);

    let duplicado = false;
    try {
      await registrarPago(db, {
        prestamo_id: prestamo.id,
        dia_credito: dia,
        monto,
        registrado_por: usuario.id,
        gps_lat,
        gps_lng,
        registrado_en: registradoEn,
        op_id: input.opId ?? null,
      });
    } catch (e) {
      // Reintento de una op ya guardada (flush cortado): idempotente → ok.
      if (!esDuplicado(e)) throw e;
      duplicado = true;
    }

    // Bitácora de campo SOLO si el pago se creó de verdad. En el reintento
    // idempotente (23505) NO se registra: si no, un mismo cobro contaría DOBLE
    // como acto en la auditoría de campo (score de sospecha, /admin/campo).
    if (!duplicado) {
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
        gpsPrecision: numeroValido(input.gpsPrecision),
        gpsDenegado: gps_lat == null || gps_lng == null,
        enZona: zona ? zona.enZona : null,
        deviceTs: input.registradoEn ?? null,
      });
    }

    revalidatePath("/cobrador");
    revalidatePath(`/cobrador/cliente/${cliente.id}`);
    return { ok: true, dia, monto, enZona: zona ? zona.enZona : null };
  } catch (e) {
    // Ruta de PLATA: el error deja rastro (nunca se traga en silencio).
    reportarError("registrarPagoCobrador", e, { clienteId: input.clienteId, opId: input.opId });
    // Error TRANSITORIO (DB/red): retryable → la cola reintenta, NO envenena el cobro.
    return { ok: false, error: "No pudimos registrar el pago. Probá de nuevo.", retryable: true };
  }
}

// ── No pago (visita) ─────────────────────────────────────────────────────────
// MOTIVOS_NOPAGO y MotivoNoPago viven en ./motivos (este archivo es "use server"
// y solo puede EXPORTAR funciones async).

export async function registrarNoPagoCobrador(input: {
  clienteId: string;
  prestamoId?: string | null;
  motivo: MotivoNoPago;
  gpsLat?: number | null;
  gpsLng?: number | null;
  gpsPrecision?: number | null;
  registradoEn?: string | null;
  opId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; retryable?: boolean }> {
  if (!validar(noPagoSchema, input).ok) return { ok: false, error: "Datos inválidos." };
  try {
    const usuario = await getUsuarioActual();
    if (!usuario || !usuario.activo) return { ok: false, error: "Sesión no válida.", retryable: true };
    const bloqueo = await bloqueoSoloLectura();
    if (bloqueo) return bloqueo;

    const db = await createSupabaseServer();
    const prestamo = await resolverPrestamo(db, input.clienteId, input.prestamoId);
    if (!prestamo) return { ok: false, error: "El cliente no tiene crédito activo." };

    const m = MOTIVOS_NOPAGO.find((x) => x.id === input.motivo) ?? MOTIVOS_NOPAGO[0];
    const gps_lat = numeroValido(input.gpsLat);
    const gps_lng = numeroValido(input.gpsLng);
    let duplicado = false;
    try {
      await crearVisita(db, {
        prestamo_id: prestamo.id,
        cobrador_id: usuario.id,
        resultado: m.resultado,
        motivo: m.label,
        gps_lat,
        gps_lng,
        registrado_en: sellarRegistroEn(input.registradoEn),
        op_id: input.opId ?? null,
      });
    } catch (e) {
      // Reintento de una op ya guardada (flush cortado): idempotente → ok.
      if (!esDuplicado(e)) throw e;
      duplicado = true;
    }

    // Bitácora de campo SOLO si la visita se creó de verdad (igual que el cobro): en
    // el reintento idempotente NO se registra, si no una misma visita contaría DOBLE
    // como acto en la auditoría de campo (score de sospecha, /admin/campo).
    if (!duplicado) {
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
        gpsPrecision: numeroValido(input.gpsPrecision),
        gpsDenegado: gps_lat == null || gps_lng == null,
        deviceTs: input.registradoEn ?? null,
      });
    }

    revalidatePath("/cobrador");
    revalidatePath(`/cobrador/cliente/${input.clienteId}`);
    return { ok: true };
  } catch (e) {
    reportarError("registrarNoPagoCobrador", e, { clienteId: input.clienteId, opId: input.opId });
    return { ok: false, error: "No pudimos registrar. Probá de nuevo.", retryable: true };
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
/**
 * Resuelve a qué crédito se imputa la operación. Si el cliente tiene varios
 * activos y el cobrador eligió uno (`prestamoId`), se valida que ese crédito
 * sea REALMENTE un activo de ESE cliente (no de otro) y se usa; si no se eligió,
 * se usa el principal. Nunca deja imputar a un crédito ajeno.
 */
async function resolverPrestamo(
  db: Awaited<ReturnType<typeof createSupabaseServer>>,
  clienteId: string,
  prestamoId?: string | null,
): Promise<Prestamo | null> {
  if (prestamoId) {
    const activos = await getPrestamosActivosPorCliente(db, clienteId);
    return activos.find((p) => p.id === prestamoId) ?? null;
  }
  return getPrestamoActivoPorCliente(db, clienteId);
}

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
