"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — ALTA de un crédito NUEVO para un cliente SIN crédito activo.
//
//  Cierra el eslabón que faltaba del ciclo de vida: hoy la única puerta para
//  colocar capital era la RENOVACIÓN, que exige un crédito anterior 'activo' y
//  saldado. El cliente que terminaba de pagar y volvía a los días quedaba fuera
//  del sistema (mismo síntoma reportado en Disapp). Son 862 ex-clientes con
//  historial y crece con cada crédito que se termina.
//
//  Reglas de plata (mismas que la renovación, no se inventan):
//   · CAP $100.000 DURO para todos, incluido el admin.
//   · El aumento respecto del ÚLTIMO crédito del cliente respeta el tope del
//     tramo (20/15/10%) para el supervisor; el admin puede excederlo.
//   · Primer crédito de alguien SIN historial → solo el admin (no hay contra qué
//     medir el tope, así que la decisión sube al que pone el capital).
//   · La cuota la calcula el SERVIDOR (el formulario solo previsualiza).
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor, esAdmin } from "@/lib/auth";
import { alcanceDelActor } from "@/lib/data/alcance";
import { getClientePorId } from "@/lib/data/clientes";
import { getCobradorDeCliente } from "@/lib/data/asignaciones";
import {
  getUltimoCreditoDe,
  crearCreditoNuevoDb,
} from "@/lib/data/creditoNuevo";
import { calcularCuotaCreditoNuevo, INTERES_DEFECTO_PCT, interesDeBase } from "@/lib/creditoNuevo";
import { evaluarRenovacion, RENOVACION_CAP_TOTAL } from "@/lib/renovacion";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { esUuid, opIdDeterminista } from "@/lib/idempotencia";
import { hoyUY } from "@/lib/fecha";
import { proximoDiaCobro } from "@/lib/cartones";
import { toIso, UYU } from "@/lib/format";
import type { FrecuenciaPrestamo } from "@/types/db";

const FRECUENCIAS: FrecuenciaPrestamo[] = ["diario", "semanal", "quincenal", "mensual"];

export type ResultadoCreditoNuevo =
  | { ok: true; prestamoId: string; cuota: number; repetido: boolean }
  | { ok: false; error: string };

export async function crearCreditoNuevo(input: {
  clienteId: string;
  cobradorId: string;
  monto: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
  /** Solo se usa si el cliente NO tiene historial (si lo tiene, manda su tasa). */
  interesPct?: number;
  /** Nonce del navegador para la idempotencia; si falta se deriva uno estable. */
  nonce?: string;
}): Promise<ResultadoCreditoNuevo> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) {
    return { ok: false, error: "No tenés permisos para dar de alta créditos." };
  }
  // Kill switch: dar de alta COLOCA capital → congelado en modo solo-lectura.
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;

  const monto = Math.round(Number(input.monto));
  const totalDias = Math.round(Number(input.totalDias));
  if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: "Revisá el monto." };
  // Tope superior 366 (auditoría 08-05): un totalDias absurdo pulveriza la cuota
  // (round → $1) y el total del crédito queda por debajo del capital prestado.
  if (!Number.isInteger(totalDias) || totalDias <= 0 || totalDias > 366)
    return { ok: false, error: "La cantidad de cuotas debe ser un entero entre 1 y 366." };
  if (!FRECUENCIAS.includes(input.frecuencia)) return { ok: false, error: "Frecuencia inválida." };
  // CAP total DURO (money-critical), idéntico al de la renovación.
  if (monto > RENOVACION_CAP_TOTAL)
    return { ok: false, error: `El crédito no puede superar ${UYU(RENOVACION_CAP_TOTAL)} (tope máximo).` };

  const db = await createSupabaseServer();
  const admin = esAdmin(u.rol);

  const cliente = await getClientePorId(db, input.clienteId);
  if (!cliente || !cliente.activo) return { ok: false, error: "El cliente no existe o está archivado." };

  // ⚠️ REGLA DEL NEGOCIO (Carlos, 07-08): un cliente puede tener VARIOS créditos
  // a la vez, sin estar al día con los anteriores. Acá había un rechazo ("Este
  // cliente ya tiene un crédito activo. Usá Renovaciones cuando lo termine de
  // pagar") que dejaba a la OFICINA sin poder darle un crédito a nadie que
  // estuviera pagando. La cartera viva ya trabaja así: 471 clientes con 2 o más,
  // hasta 10 en un caso (SONIA TELIS). Lo que acota la exposición es el CAP por
  // crédito y el tramo según historial, no un tope de cantidad.

  // ── Cobrador de destino: debe existir, estar activo y ser cobrador ──
  const { data: cob } = await db
    .from("usuarios")
    .select("id, nombre, rol, activo, zona_id")
    .eq("id", input.cobradorId)
    .maybeSingle();
  if (!cob || cob.rol !== "cobrador" || !cob.activo)
    return { ok: false, error: "Elegí un cobrador válido." };

  // ── Recorte por ZONA (el supervisor no coloca fuera de su zona) ──
  const alcance = await alcanceDelActor();
  if (!alcance.global) {
    if (!alcance.cobradorIds.includes(input.cobradorId))
      return { ok: false, error: "Ese cobrador no es de tu zona." };
    // El cliente tiene que ser de su zona O no estar en la ruta de nadie: adoptar
    // un cliente huérfano es legítimo; robarle uno a otra zona, no.
    if (!alcance.clienteIds.includes(input.clienteId)) {
      const ruta = await getCobradorDeCliente(db, input.clienteId);
      if (ruta) return { ok: false, error: "Ese cliente es de otra zona." };
    }
  }

  // ── Tasa y tope, contra el ÚLTIMO crédito del cliente ──
  const base = await getUltimoCreditoDe(db, input.clienteId);
  const baseTasa = base ? { monto: base.monto, cuota: base.cuota, totalDias: base.totalDias } : null;
  const conHistorial = !!(baseTasa && baseTasa.monto > 0 && baseTasa.cuota > 0 && baseTasa.totalDias > 0);

  if (!conHistorial && !admin)
    return { ok: false, error: "El primer crédito de un cliente lo da de alta el administrador." };
  if (conHistorial) {
    const evalu = evaluarRenovacion(baseTasa!.monto, monto);
    if (evalu.excedePct && !admin)
      return { ok: false, error: `${evalu.motivo} Pedile al administrador que lo autorice.` };
  }

  // El interés solo se acepta del formulario cuando NO hay historial; si lo hay,
  // manda la tasa del crédito anterior (el gestor no puede re-tarifar por acá).
  const interesPct = conHistorial
    ? interesDeBase(baseTasa)
    : Math.max(0, Math.min(100, Math.round(Number(input.interesPct ?? INTERES_DEFECTO_PCT))));

  const cuota = calcularCuotaCreditoNuevo(baseTasa, monto, totalDias, interesPct ?? INTERES_DEFECTO_PCT);
  if (!(cuota > 0)) return { ok: false, error: "La cuota calculada es inválida (revisar monto/cuotas)." };

  // La plata se entrega HOY y se empieza a pagar el PRÓXIMO día de cobro: con
  // fecha_inicio = hoy, la cuota 1 vencía el mismo día en que el cliente recibía
  // el dinero y a la medianoche el cartón la pintaba atrasada (reporte de campo
  // del día 2). Si mañana es domingo, arranca el lunes.
  const fechaInicio = toIso(proximoDiaCobro(hoyUY(new Date())));
  // Idempotencia: el nonce del navegador sobrevive al reintento del MISMO submit;
  // sin él, una clave determinista por (cliente, términos, día, gestor) igual evita
  // que un doble clic coloque el capital dos veces.
  const opId = esUuid(input.nonce)
    ? input.nonce
    : opIdDeterminista("credito-nuevo", input.clienteId, monto, cuota, totalDias, fechaInicio, u.id);

  const res = await crearCreditoNuevoDb(db, {
    clienteId: input.clienteId,
    cobradorId: input.cobradorId,
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
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: conHistorial ? "Dio de alta un crédito nuevo (cliente que volvió)" : "Dio de alta el primer crédito del cliente",
      entidad: "cliente",
      entidadId: input.clienteId,
      detalle: `${UYU(monto)} × ${totalDias} (${input.frecuencia}) · cuota ${UYU(cuota)} · ruta: ${(cob as { nombre?: string }).nombre ?? "—"}`,
    });
  }

  revalidatePath(`/admin/clientes/${input.clienteId}`);
  revalidatePath("/admin/renovaciones");
  revalidatePath("/admin/mora");
  revalidatePath("/admin");
  return { ok: true, prestamoId: res.prestamoId, cuota, repetido: res.repetido };
}
