"use server";
// ─────────────────────────────────────────────────────────────────────────
//  COLOCAR CAPITAL DESDE LA CALLE (decisión de Carlos, 08-05).
//
//  Hasta hoy solo un GESTOR podía crear créditos, y la migración 0129 lo
//  cerró también a nivel base porque un cobrador podía POSTear a
//  /rest/v1/prestamos y saltarse el CAP, el tope del tramo y el kill-switch.
//  Ese candado SIGUE PUESTO: acá no se abre la policy. El cobrador escribe
//  únicamente por estas dos acciones, que aplican TODOS los gates antes de
//  tocar la base y recién entonces usan una vía de confianza.
//
//  Lo que el cobrador PUEDE:
//   · RENOVAR — repetir el crédito que su cliente terminó de pagar, con los
//     MISMOS términos. Aumento 0% ⇒ siempre dentro del tope del tramo.
//   · NUEVA VENTA — colocarle otro crédito a un cliente suyo que ya no tiene
//     crédito activo, dentro del tramo que le corresponde por historial.
//
//  Lo que NO puede (y por qué):
//   · Superar el CAP de $100.000 — duro para todos, incluido el admin.
//   · Exceder el tope del tramo (20/15/10%) — eso lo pide al supervisor.
//   · Dar el PRIMER crédito de alguien sin historial — no hay contra qué
//     medir el riesgo; lo da la oficina.
//   · Tocar un cliente que no está en SU ruta — lo garantiza el RLS.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual } from "@/lib/auth";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { getClientePorId } from "@/lib/data/clientes";
import { getPrestamosActivosPorCliente } from "@/lib/data/prestamos";
import { getPagosDePrestamo } from "@/lib/data/pagos";
import { crearRenovacion } from "@/lib/data/renovaciones";
import {
  crearCreditoNuevoDb,
  getUltimoCreditoDe,
  contarCreditosActivos,
} from "@/lib/data/creditoNuevo";
import {
  calcularCuotaCreditoNuevo,
  interesDeBase,
  INTERES_DEFECTO_PCT,
} from "@/lib/creditoNuevo";
import { evaluarRenovacion, RENOVACION_CAP_TOTAL } from "@/lib/renovacion";
import { calcularEstadosCarton } from "@/lib/cartones";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { esUuid, opIdDeterminista } from "@/lib/idempotencia";
import { hoyUY } from "@/lib/fecha";
import { toIso, UYU } from "@/lib/format";
import type { FrecuenciaPrestamo } from "@/types/db";

export type ResultadoColocar =
  | { ok: true; prestamoId?: string; cuota?: number; repetido?: boolean }
  | { ok: false; error: string };

const FRECUENCIAS: FrecuenciaPrestamo[] = ["diario", "semanal", "quincenal", "mensual"];

type Puerta =
  | { ok: false; error: string }
  | {
      ok: true;
      u: NonNullable<Awaited<ReturnType<typeof getUsuarioActual>>>;
      db: Awaited<ReturnType<typeof createSupabaseServer>>;
    };

/** Puerta común: sesión de COBRADOR + sistema operativo + cliente de SU ruta. */
async function puerta(clienteId: string): Promise<Puerta> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  // Los gestores tienen su propio camino en el panel (con más atribuciones).
  if (u.rol !== "cobrador") return { ok: false, error: "Esta acción es de la app del cobrador." };
  if (!esUuid(clienteId)) return { ok: false, error: "Cliente inválido." };

  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo)
    return {
      ok: false,
      error: bloqueo.error ?? "El sistema está en modo consulta por unos minutos. Probá enseguida.",
    };

  // Sesión del cobrador ⇒ el RLS solo le deja ver clientes de su ruta.
  const db = await createSupabaseServer();
  const cliente = await getClientePorId(db, clienteId);
  if (!cliente) return { ok: false, error: "Ese cliente no está en tu ruta." };
  if (!cliente.activo)
    return { ok: false, error: "Ese cliente está dado de baja. Avisá a la oficina." };

  return { ok: true, u, db };
}

/**
 * RENOVAR — repetir el crédito con los MISMOS términos, de un toque.
 * Solo si el crédito activo del cliente está SALDADO (terminó de pagarlo).
 */
export async function renovarDesdeCalle(input: {
  clienteId: string;
  prestamoId: string;
  nonce?: string;
}): Promise<ResultadoColocar> {
  const p = await puerta(input.clienteId);
  if (!p.ok) return p;
  const { u, db } = p;

  const activos = await getPrestamosActivosPorCliente(db, input.clienteId);
  const ant = activos.find((x) => x.id === input.prestamoId);
  if (!ant) return { ok: false, error: "Ese crédito ya no está activo." };

  // ¿Terminó de pagar TODO? No solo el crédito elegido: si el cliente tiene OTRO
  // crédito activo con saldo, renovarle este (saldado) le entrega capital nuevo
  // con deuda viva al lado — renovación indebida (auditoría 08-05). Un multi-
  // crédito legítimo se renueva cuando TODOS están al cero.
  for (const cred of activos) {
    const pagosDe = await getPagosDePrestamo(db, cred.id);
    const carton = calcularEstadosCarton(cred, pagosDe, hoyUY());
    if (carton.falta >= 1) {
      return {
        ok: false,
        error:
          cred.id === ant.id
            ? `Todavía le falta pagar ${UYU(carton.falta)}. Se renueva cuando termine.`
            : `Tiene OTRO crédito activo al que le falta ${UYU(carton.falta)}. Se renueva cuando termine todo.`,
      };
    }
  }

  const monto = Math.round(Number(ant.monto_prestado) || 0);
  const totalDias = Number(ant.total_dias) || 0;
  if (!(monto > 0) || !(totalDias > 0)) {
    return {
      ok: false,
      error: "Los términos del crédito anterior no son válidos. Avisá a la oficina.",
    };
  }
  // CAP duro. Mismo monto que antes, así que solo salta si el crédito viejo ya
  // lo superaba (herencia del import de Disapp).
  if (monto > RENOVACION_CAP_TOTAL) {
    return {
      ok: false,
      error: `Ese crédito supera ${UYU(RENOVACION_CAP_TOTAL)}: lo tiene que renovar la oficina.`,
    };
  }

  const res = await crearRenovacion(db, {
    clienteId: input.clienteId,
    prestamoAnteriorId: ant.id,
    monto,
    totalDias,
    frecuencia: (ant.frecuencia as FrecuenciaPrestamo) ?? "diario",
    creadoPor: u.id,
  });
  if (!res.ok) return res;

  await registrarAuditoria(db, {
    actorId: u.id,
    actorNombre: u.nombre,
    accion: "Renovó un crédito desde la calle",
    entidad: "cliente",
    entidadId: input.clienteId,
    detalle: `Mismos términos: ${UYU(monto)} × ${totalDias}`,
  });
  revalidatePath("/cobrador");
  revalidatePath(`/cobrador/cliente/${input.clienteId}`);
  return { ok: true, prestamoId: res.prestamoId, cuota: res.cuota };
}

/**
 * NUEVA VENTA — otro crédito para un cliente suyo que NO tiene crédito activo.
 * El monto lo elige el cobrador, dentro del tramo que le da su historial.
 */
export async function nuevaVentaDesdeCalle(input: {
  clienteId: string;
  monto: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
  nonce?: string;
}): Promise<ResultadoColocar> {
  const p = await puerta(input.clienteId);
  if (!p.ok) return p;
  const { u, db } = p;

  const monto = Math.round(Number(input.monto));
  const totalDias = Math.round(Number(input.totalDias));
  if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: "Revisá el monto." };
  // Tope SUPERIOR de cuotas (auditoría 08-05): sin él, un totalDias absurdo
  // pulveriza la cuota (round(monto·factor/dias) → $1) y el total del crédito
  // queda por DEBAJO del capital prestado — interés destruido y pérdida de
  // principal. 366 cubre de sobra el crédito diario más largo del negocio.
  if (!Number.isInteger(totalDias) || totalDias <= 0 || totalDias > 366)
    return { ok: false, error: "Revisá la cantidad de cuotas (máximo 366)." };
  if (!FRECUENCIAS.includes(input.frecuencia)) return { ok: false, error: "Frecuencia inválida." };
  if (monto > RENOVACION_CAP_TOTAL)
    return { ok: false, error: `El crédito no puede superar ${UYU(RENOVACION_CAP_TOTAL)}.` };

  // Con crédito activo, el camino correcto es RENOVAR (cierra el anterior).
  // Así no se fabrica un segundo crédito paralelo por error de navegación.
  if ((await contarCreditosActivos(db, input.clienteId)) > 0)
    return {
      ok: false,
      error: "Este cliente ya tiene un crédito. Renovalo cuando lo termine de pagar.",
    };

  // Sin historial no hay contra qué medir el riesgo → lo da la oficina.
  const base = await getUltimoCreditoDe(db, input.clienteId);
  const baseTasa = base ? { monto: base.monto, cuota: base.cuota, totalDias: base.totalDias } : null;
  const conHistorial = !!(
    baseTasa &&
    baseTasa.monto > 0 &&
    baseTasa.cuota > 0 &&
    baseTasa.totalDias > 0
  );
  if (!conHistorial)
    return { ok: false, error: "Es el primer crédito de esta persona: lo da de alta la oficina." };

  // Tope del tramo: DURO para el cobrador. Si quiere más, lo pide al supervisor.
  const evalu = evaluarRenovacion(baseTasa!.monto, monto);
  if (evalu.superaCap) return { ok: false, error: evalu.motivo ?? "Supera el tope." };
  if (evalu.excedePct) return { ok: false, error: `${evalu.motivo} Pedíselo a tu supervisor.` };

  const interesPct = interesDeBase(baseTasa);
  const cuota = calcularCuotaCreditoNuevo(
    baseTasa,
    monto,
    totalDias,
    interesPct ?? INTERES_DEFECTO_PCT,
  );
  if (!(cuota > 0))
    return { ok: false, error: "La cuota calculada no es válida. Revisá monto y cuotas." };

  const fechaInicio = toIso(hoyUY(new Date()));
  const opId = esUuid(input.nonce)
    ? input.nonce
    : opIdDeterminista("venta-calle", input.clienteId, monto, cuota, totalDias, fechaInicio, u.id);

  // ⚠️ Se escribe con el cliente ADMIN a propósito: la policy de INSERT sobre
  // `prestamos` (0129) sigue exigiendo gestor, y así tiene que quedar — es lo
  // que impide que alguien POSTee un crédito por REST saltándose todo lo de
  // arriba. Acá ya se validaron CAP, tramo, historial, ruta y kill-switch.
  const res = await crearCreditoNuevoDb(createSupabaseAdmin(), {
    clienteId: input.clienteId,
    cobradorId: u.id, // el cobrador solo coloca en SU propia ruta
    monto,
    cuota,
    totalDias,
    frecuencia: input.frecuencia,
    fechaInicio,
    interesPct,
    creadoPor: u.id,
    opId,
  });
  if (!res.ok) return res;

  if (!res.repetido) {
    // ANTI-CARRERA (auditoría 08-05): el "sin crédito activo" de arriba es un
    // check-then-insert sin candado en BD (no hay unique de un-activo-por-cliente
    // porque la tienda legítimamente convive con el crédito de efectivo). Dos
    // requests paralelas con montos DISTINTOS (op_id distinto) pasaban ambas el
    // check → dos créditos activos, cada uno dentro del tramo pero sumados por
    // encima. Verificación post-insert: si el cliente quedó con MÁS de un activo,
    // se deshace ESTE crédito recién nacido (sin pagos ni movimientos de caja —
    // mismo patrón de rollback que el censo) y se le pide reintentar.
    const admin = createSupabaseAdmin();
    const { count } = await admin
      .from("prestamos")
      .select("*", { count: "exact", head: true })
      .eq("cliente_id", input.clienteId)
      .eq("estado", "activo");
    if ((count ?? 1) > 1) {
      await admin.from("prestamos").delete().eq("id", res.prestamoId).eq("pagado_acum", 0);
      await registrarAuditoria(db, {
        actorId: u.id,
        actorNombre: u.nombre,
        accion: "Venta desde la calle deshecha (carrera de doble crédito)",
        entidad: "cliente",
        entidadId: input.clienteId,
        detalle: `${UYU(monto)} × ${totalDias}: el cliente ya tenía otro crédito activo creándose a la vez.`,
      });
      return {
        ok: false,
        error: "Se estaba creando OTRO crédito para este cliente al mismo tiempo. Mirá su ficha antes de reintentar.",
      };
    }
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Colocó un crédito nuevo desde la calle",
      entidad: "cliente",
      entidadId: input.clienteId,
      detalle: `${UYU(monto)} × ${totalDias} (${input.frecuencia}) · cuota ${UYU(cuota)}`,
    });
  }
  revalidatePath("/cobrador");
  revalidatePath(`/cobrador/cliente/${input.clienteId}`);
  return { ok: true, prestamoId: res.prestamoId, cuota, repetido: res.repetido };
}
