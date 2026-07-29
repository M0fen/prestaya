"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — reportar "falta un pago".
//  Único write de la vista de cliente. Corre SOLO en el servidor: valida el
//  token (sin login), usa service_role y guarda el reporte. El navegador
//  nunca toca Supabase.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getClientePorToken } from "@/lib/data/clientes";
import { getPrestamoActivoPorCliente, getPrestamosActivosPorCliente } from "@/lib/data/prestamos";
import { crearReporte, contarReportesRecientes } from "@/lib/data/reportes";
import { getSaldoEstrellas, crearSolicitudRedencion } from "@/lib/data/estrellas";
import { validarRedencion, claveCiclo } from "@/lib/estrellas";
import { clienteEnSegmento } from "@/lib/segmentos";
import { getAjustesJuego } from "@/lib/data/juegoConfig";
import { cicloUY, hoyUY } from "@/lib/fecha";
import { getPagosDePrestamo } from "@/lib/data/pagos";
import { calcularEstadosCarton } from "@/lib/cartones";
import {
  getEstadoRaspaCliente,
  getSegmentosRaspa,
  registrarJugadaRaspaSeguro,
  getQuinielaAbierta,
  getParticipacionCliente,
  participarQuinielaDb,
} from "@/lib/data/promos";
import {
  elegirPremio,
  segmentoParaScore,
  resultadoRaspadita,
  scoreAPorcentaje,
} from "@/lib/raspadita";
import { getHistorialCrediticio } from "@/lib/data/scoring";
import { getConfigScoring } from "@/lib/data/scoringConfig";
import { calcularScore } from "@/lib/scoring";
import { numeroSuerte } from "@/lib/quiniela";
import { tokenValido } from "@/lib/validacion/esquemas";
import { getProductoAdmin, crearSolicitudDb, contarSolicitudesRecientesCliente, getZonaIdDeCliente } from "@/lib/data/tienda";
import { esUuid } from "@/lib/idempotencia";

/** Azar del SERVIDOR (no del cliente) para decidir premios. Uniforme en [0,1). */
function azarServidor(): number {
  try {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    return a[0] / 2 ** 32;
  } catch {
    return Math.random();
  }
}

export type ResultadoReporte = { ok: true } | { ok: false; error: string };

/**
 * TIENDA — el cliente toca "Me interesa" en un producto → LEAD para el admin.
 * Valida el token en el servidor (service_role); NO genera crédito. Rate-limit
 * suave por cliente. Mismo patrón seguro que reportarFaltaPago.
 */
export async function registrarInteres(input: {
  token: string;
  productoId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!tokenValido(input.token)) return { ok: false, error: "Enlace no válido." };
    if (!esUuid(input.productoId)) return { ok: false, error: "Producto inválido." };
    const db = createSupabaseAdmin();
    const cliente = await getClientePorToken(db, input.token);
    if (!cliente) return { ok: false, error: "Enlace no válido." };
    const prod = await getProductoAdmin(db, input.productoId);
    if (!prod || !prod.activo) return { ok: false, error: "Ese producto ya no está disponible." };
    // AUDIENCIA (0089): si el producto está acotado a un segmento, solo genera lead quien
    // pertenece — MISMA resolución que la vitrina (getProductosParaCliente: zona del
    // cliente + calificación, alDia=true, cobradorId=null) → "lo ve ⟺ puede pedirlo".
    // Defensa en profundidad server-side (espejo de la quiniela): un cliente fuera de
    // audiencia no debe auto-inscribirse llamando la acción directa con un productId cacheado.
    if (prod.segmentoDef) {
      const zonaId = await getZonaIdDeCliente(db, cliente.id);
      const enAudiencia = clienteEnSegmento(
        { id: cliente.id, calificacion: cliente.calificacion, zonaId, cobradorId: null, alDia: true },
        prod.segmentoDef,
      );
      if (!enAudiencia) return { ok: false, error: "Ese producto ya no está disponible." };
    }
    // Rate-limit: máx. 10 solicitudes en 10 minutos por cliente (anti-spam del link).
    const desde = new Date(Date.now() - 10 * 60 * 1000);
    if ((await contarSolicitudesRecientesCliente(db, cliente.id, desde)) >= 10) {
      return { ok: false, error: "Ya registramos tu interés. Te vamos a contactar." };
    }
    await crearSolicitudDb(db, { productoId: prod.id, clienteId: cliente.id, productoNombre: prod.nombre });
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo registrar. Probá de nuevo." };
  }
}

export async function reportarFaltaPago(input: {
  token: string;
  /** Crédito que el cliente estaba VIENDO (multi-crédito). Se valida que sea suyo. */
  prestamoId?: string | null;
  diaCredito?: number | null;
  montoReclamado?: number | null;
  comentario?: string | null;
}): Promise<ResultadoReporte> {
  try {
    // Forma del token (barato, antes de tocar la base).
    if (!tokenValido(input.token)) return { ok: false, error: "Enlace no válido." };
    const db = createSupabaseAdmin();

    // 1) Validar token → cliente (no revelamos nada si no existe).
    const cliente = await getClientePorToken(db, input.token);
    if (!cliente) return { ok: false, error: "Enlace no válido." };

    // 2) Rate-limit simple: máx. 3 reportes en 10 minutos por cliente.
    const desde = new Date(Date.now() - 10 * 60 * 1000);
    const recientes = await contarReportesRecientes(db, cliente.id, desde);
    if (recientes >= 3) {
      return {
        ok: false,
        error: "Ya recibimos tu aviso. Lo estamos revisando, gracias.",
      };
    }

    // 3) Crédito al que se adjunta: el que el cliente estaba VIENDO (multi-crédito) si
    // mandó uno válido y es SUYO; si no, el principal. Validar la pertenencia evita que
    // por la acción directa se adjunte el reporte a un crédito AJENO con un id arbitrario.
    let prestamoId: string | null = null;
    if (input.prestamoId && esUuid(input.prestamoId)) {
      const activos = await getPrestamosActivosPorCliente(db, cliente.id);
      if (activos.some((p) => p.id === input.prestamoId)) prestamoId = input.prestamoId;
    }
    if (!prestamoId) prestamoId = (await getPrestamoActivoPorCliente(db, cliente.id))?.id ?? null;

    // 4) Saneamiento de entradas.
    const dia =
      typeof input.diaCredito === "number" &&
      input.diaCredito >= 1 &&
      input.diaCredito <= 366
        ? Math.floor(input.diaCredito)
        : null;
    const monto =
      typeof input.montoReclamado === "number" && input.montoReclamado > 0
        ? input.montoReclamado
        : null;
    const comentario = (input.comentario ?? "").toString().trim().slice(0, 500);

    await crearReporte(db, {
      cliente_id: cliente.id,
      prestamo_id: prestamoId,
      tipo: "falta_pago",
      dia_credito: dia,
      monto_reclamado: monto,
      comentario: comentario || null,
    });

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "No pudimos enviar tu aviso ahora. Probá de nuevo en un rato.",
    };
  }
}

// ── Solicitar CANJE de estrellas ───────────────────────────────────────────
// El cliente pide canjear N estrellas desde su vista por token. Queda
// 'pendiente' hasta que el admin la apruebe. Se valida el token y el saldo en
// el servidor (service_role). Tope de 5 por ciclo (mes) — ver lib/estrellas.
export async function solicitarRedencion(input: {
  token: string;
  cantidad: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!tokenValido(input.token)) return { ok: false, error: "Enlace no válido." };
    const db = createSupabaseAdmin();
    const cliente = await getClientePorToken(db, input.token);
    if (!cliente) return { ok: false, error: "Enlace no válido." };

    // El ciclo del tope lo define el admin (mes o crédito): mismo cálculo que
    // usa la vista al mostrar el saldo, para que coincidan.
    const [ajustes, prestamo] = await Promise.all([
      getAjustesJuego(db),
      getPrestamoActivoPorCliente(db, cliente.id),
    ]);
    const ciclo = claveCiclo(ajustes.estrellasCiclo, {
      cicloMes: cicloUY(),
      prestamoId: prestamo?.id ?? null,
    });
    const saldo = await getSaldoEstrellas(db, cliente.id, ciclo);
    const v = validarRedencion(saldo, input.cantidad);
    if (!v.ok) return v;

    await crearSolicitudRedencion(db, {
      clienteId: cliente.id,
      estrellas: Math.round(input.cantidad),
      ciclo,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "No pudimos registrar tu solicitud. Probá más tarde." };
  }
}

// ── Raspadita (PROMOCIONAL, sin dinero) ────────────────────────────────────
// El cliente juega una raspadita que desbloqueó al pagar. El premio (un
// BENEFICIO simbólico o "nada") lo decide el SERVIDOR con azar del servidor y se
// registra. No hay dinero real (ver lib/raspadita.ts / migración 0021).
export type ResultadoRaspa =
  | { ok: true; label: string; tipo: "beneficio" | "nada"; folio?: number | null }
  | { ok: false; error: string };

export async function jugarRaspadita(input: { token: string }): Promise<ResultadoRaspa> {
  try {
    if (!tokenValido(input.token)) return { ok: false, error: "Enlace no válido." };
    const db = createSupabaseAdmin();
    const cliente = await getClientePorToken(db, input.token);
    if (!cliente) return { ok: false, error: "Enlace no válido." };

    const estado = await getEstadoRaspaCliente(db, cliente.id);
    if (estado.disponibles <= 0)
      return { ok: false, error: "No tenés raspaditas por ahora. ¡Con tu próximo pago desbloqueás otra!" };

    // El premio depende del SCORING del cliente (0042): el dueño define tramos
    // (rango de score → % de ganar → premios). Se calcula el score en vivo, se
    // busca su tramo y el servidor decide (gana/pierde + cuál premio, por peso).
    const segmentos = await getSegmentosRaspa(db, true);
    let premio: { id: string; label: string; tipo: "beneficio" | "nada" } | null;
    if (segmentos.length === 0) {
      // Compat: base sin 0042 → comportamiento previo (ruleta única por peso).
      premio = elegirPremio(estado.premios, azarServidor());
      if (!premio) return { ok: false, error: "El juego no está disponible ahora." };
    } else {
      const [historial, configScoring] = await Promise.all([
        getHistorialCrediticio(db, cliente.id),
        getConfigScoring(db),
      ]);
      const score = calcularScore({ ...historial, hoy: hoyUY() }, configScoring);
      const seg = segmentoParaScore(scoreAPorcentaje(score.puntaje), segmentos);
      // Premios de ESE tramo (los sin tramo cuentan como del default "Los demás").
      const premiosDelTramo = estado.premios.filter(
        (p) => p.activo && (p.segmentoId === seg?.id || (!!seg?.esDefault && !p.segmentoId)),
      );
      premio = resultadoRaspadita(seg, premiosDelTramo, azarServidor(), azarServidor());
    }

    // Se registra SIEMPRE (gane o no): si no ganó, queda como "nada" (auditable).
    // El tipo sale del PREMIO real (en el fallback sin tramos, elegirPremio puede
    // devolver el ítem 'nada' sembrado: NO hay que festejarlo como beneficio).
    const label = premio?.label ?? "¡Seguí participando!";
    const tipo: "beneficio" | "nada" = premio?.tipo ?? "nada";
    // Jugada ATÓMICA (0097): re-chequea el cupo (jugadas < ganadas) con advisory lock
    // → dos jugadas concurrentes no farmean cupones. Devuelve el folio del comprobante.
    const guardado = await registrarJugadaRaspaSeguro(db, {
      clienteId: cliente.id,
      premioId: premio?.id ?? null,
      premioLabel: label,
      premioTipo: tipo,
      ganadas: estado.ganadas,
    });
    if (!guardado.ok) {
      // Otra jugada concurrente ya consumió el último cupo (o el cliente se quedó sin).
      return { ok: false, error: "Ya jugaste tus raspaditas por ahora. ¡Con tu próximo pago desbloqueás otra! 🌟" };
    }
    return { ok: true, label, tipo, folio: guardado.folio };
  } catch {
    return { ok: false, error: "No pudimos jugar la raspadita. Probá más tarde." };
  }
}

// ── Quiniela (PROMOCIONAL, sin dinero) ─────────────────────────────────────
// El número de la suerte es ASIGNADO: los últimos 3 dígitos del número de
// registro del cliente. Participa por estar AL DÍA (no elige, no apuesta plata).
// El premio es un BENEFICIO simbólico; el sorteo lo carga el admin. Idempotente:
// si ya está participando, devuelve ok con su mismo número (se autollama al abrir).
export async function participarQuiniela(input: {
  token: string;
}): Promise<{ ok: true; numero: number } | { ok: false; error: string }> {
  try {
    if (!tokenValido(input.token)) return { ok: false, error: "Enlace no válido." };
    const db = createSupabaseAdmin();
    const cliente = await getClientePorToken(db, input.token);
    if (!cliente) return { ok: false, error: "Enlace no válido." };

    const quiniela = await getQuinielaAbierta(db);
    if (!quiniela) return { ok: false, error: "No hay una quiniela abierta ahora." };

    // El número es ASIGNADO (últimos 3 del registro), no elegido por el cliente.
    const miNumero = numeroSuerte(cliente.numero_registro);
    if (miNumero == null) return { ok: false, error: "Todavía no tenés número de la suerte." };

    // Entrada por estar AL DÍA (no se apuesta dinero).
    const prestamo = await getPrestamoActivoPorCliente(db, cliente.id);
    if (!prestamo) return { ok: false, error: "Necesitás un crédito activo para participar." };
    const pagos = await getPagosDePrestamo(db, prestamo.id);
    const carton = calcularEstadosCarton(prestamo, pagos, hoyUY());
    if (carton.dias.some((d) => d.estado === "atrasado"))
      return { ok: false, error: "Ponete al día y tu número entra al sorteo. 💙" };

    // AUDIENCIA (0089): si la quiniela está acotada a un segmento, solo participa
    // quien pertenece. Defensa en profundidad (el cartón ya la oculta fuera de audiencia,
    // pero un cliente manipulado no debe poder auto-inscribirse). Misma definición de
    // "al día" que el display (sin atrasados NI pendientes) para no contradecirse.
    if (quiniela.segmentoDef) {
      let zonaId: string | null = null;
      if (prestamo.cobrador_id) {
        const { data: cob } = await db.from("usuarios").select("zona_id").eq("id", prestamo.cobrador_id).maybeSingle();
        zonaId = (cob as { zona_id: string | null } | null)?.zona_id ?? null;
      }
      const alDia = !carton.dias.some((d) => d.estado === "atrasado" || d.estado === "pendiente");
      const enAudiencia = clienteEnSegmento(
        { id: cliente.id, calificacion: cliente.calificacion, zonaId, cobradorId: prestamo.cobrador_id ?? null, alDia },
        quiniela.segmentoDef,
      );
      if (!enAudiencia) return { ok: false, error: "Esta quiniela no está disponible para vos." };
    }

    // Idempotente: ya participando → ok con su número (asignado, siempre el mismo).
    const yaTiene = await getParticipacionCliente(db, quiniela.id, cliente.id);
    if (yaTiene != null) return { ok: true, numero: yaTiene };

    try {
      await participarQuinielaDb(db, {
        quinielaId: quiniela.id,
        clienteId: cliente.id,
        numero: miNumero,
      });
    } catch (e) {
      // Carrera: dos autollamados casi simultáneos → el índice único rechaza el
      // segundo (23505). Es ok: ya quedó participando con su número.
      if ((e as { code?: string } | null)?.code === "23505") return { ok: true, numero: miNumero };
      throw e;
    }
    return { ok: true, numero: miNumero };
  } catch {
    return { ok: false, error: "No pudimos registrarte en el sorteo. Probá más tarde." };
  }
}
