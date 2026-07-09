"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — reportar "falta un pago".
//  Único write de la vista de cliente. Corre SOLO en el servidor: valida el
//  token (sin login), usa service_role y guarda el reporte. El navegador
//  nunca toca Supabase.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getClientePorToken } from "@/lib/data/clientes";
import { getPrestamoActivoPorCliente } from "@/lib/data/prestamos";
import { crearReporte, contarReportesRecientes } from "@/lib/data/reportes";
import { getSaldoEstrellas, crearSolicitudRedencion } from "@/lib/data/estrellas";
import { validarRedencion, claveCiclo } from "@/lib/estrellas";
import { getAjustesJuego } from "@/lib/data/juegoConfig";
import { cicloUY, hoyUY } from "@/lib/fecha";
import { getPagosDePrestamo } from "@/lib/data/pagos";
import { calcularEstadosCarton } from "@/lib/cartones";
import {
  getEstadoRaspaCliente,
  getSegmentosRaspa,
  registrarJugadaRaspa,
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
import { numeroValido } from "@/lib/quiniela";
import { tokenValido } from "@/lib/validacion/esquemas";

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

export async function reportarFaltaPago(input: {
  token: string;
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

    // 3) Saneamiento de entradas.
    const prestamo = await getPrestamoActivoPorCliente(db, cliente.id);
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
      prestamo_id: prestamo?.id ?? null,
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
  | { ok: true; label: string; tipo: "beneficio" | "nada" }
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
    const label = premio?.label ?? "¡Seguí participando!";
    const tipo: "beneficio" | "nada" = premio ? "beneficio" : "nada";
    await registrarJugadaRaspa(db, {
      clienteId: cliente.id,
      premioId: premio?.id ?? null,
      premioLabel: label,
      premioTipo: tipo,
    });
    return { ok: true, label, tipo };
  } catch {
    return { ok: false, error: "No pudimos jugar la raspadita. Probá más tarde." };
  }
}

// ── Quiniela (PROMOCIONAL, sin dinero) ─────────────────────────────────────
// El cliente elige un número por estar AL DÍA. El premio es un BENEFICIO
// simbólico; el sorteo lo carga el admin. Sin apuesta ni pago en efectivo.
export async function participarQuiniela(input: {
  token: string;
  numero: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!tokenValido(input.token)) return { ok: false, error: "Enlace no válido." };
    const db = createSupabaseAdmin();
    const cliente = await getClientePorToken(db, input.token);
    if (!cliente) return { ok: false, error: "Enlace no válido." };

    const quiniela = await getQuinielaAbierta(db);
    if (!quiniela) return { ok: false, error: "No hay una quiniela abierta ahora." };

    // Entrada por estar AL DÍA (no se apuesta dinero).
    const prestamo = await getPrestamoActivoPorCliente(db, cliente.id);
    if (!prestamo) return { ok: false, error: "Necesitás un crédito activo para participar." };
    const pagos = await getPagosDePrestamo(db, prestamo.id);
    const carton = calcularEstadosCarton(prestamo, pagos, hoyUY());
    if (carton.dias.some((d) => d.estado === "atrasado"))
      return { ok: false, error: "Ponete al día y participás. ¡Te esperamos! 💙" };

    if (!numeroValido(input.numero, { min: quiniela.rangoMin, max: quiniela.rangoMax }))
      return { ok: false, error: `Elegí un número entre ${quiniela.rangoMin} y ${quiniela.rangoMax}.` };

    const yaTiene = await getParticipacionCliente(db, quiniela.id, cliente.id);
    if (yaTiene != null) return { ok: false, error: `Ya participaste con el número ${yaTiene}.` };

    try {
      await participarQuinielaDb(db, {
        quinielaId: quiniela.id,
        clienteId: cliente.id,
        numero: Math.round(input.numero),
      });
    } catch (e) {
      // Carrera: dos envíos casi simultáneos → el índice único (quiniela,cliente)
      // rechaza el segundo (23505). Mensaje amable en vez de error genérico.
      if ((e as { code?: string } | null)?.code === "23505")
        return { ok: false, error: "Ya estás participando en esta quiniela." };
      throw e;
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "No pudimos registrar tu número. Probá más tarde." };
  }
}
