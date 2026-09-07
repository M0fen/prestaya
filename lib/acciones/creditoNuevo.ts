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
//   · Desde el 08-13 (regla de Carlos) TODO GESTOR es aprobador: el supervisor
//     da el primer crédito y autoriza sobre el tramo igual que el admin — la
//     autorización solo aplica al COBRADOR que se pasa de su techo (+20%), y esa
//     solicitud la resuelve acá cualquiera de los dos.
//   · La cuota la calcula el SERVIDOR (el formulario solo previsualiza).
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { alcanceDelActor } from "@/lib/data/alcance";
import { getClientePorId } from "@/lib/data/clientes";
import { getCobradorDeCliente } from "@/lib/data/asignaciones";
import {
  getUltimoCreditoDe,
  crearCreditoNuevoDb,
} from "@/lib/data/creditoNuevo";
import { cerrarSolicitudPendienteDeAnterior } from "@/lib/data/solicitudesRenovacion";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { UYU } from "@/lib/format";
import { referenciaDe, resolverCredito } from "@/lib/domain/credito";
import type { FrecuenciaPrestamo } from "@/types/db";

export type ResultadoCreditoNuevo =
  | { ok: true; prestamoId: string; cuota: number; repetido: boolean }
  | { ok: false; error: string };

export async function crearCreditoNuevo(input: {
  clienteId: string;
  cobradorId: string;
  monto: number;
  totalDias: number;
  /** OBLIGATORIO. `null` = la pantalla no preguntó → se rechaza, no se asume
   *  'diario': ese default silencioso es el que hizo nacer ocho planes semanales
   *  programados día por día. */
  frecuencia: FrecuenciaPrestamo | null;
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

  // ⚠️ El monto, las cuotas, el formato, el techo, la tasa, la cuota, la fecha de
  // inicio y la clave de idempotencia NO se deciden acá: los resuelve
  // `resolverCredito` (lib/domain/credito), el mismo módulo que usan la calle y
  // el aprobador. Lo que queda en esta puerta es lo que le es propio: quién
  // entra, a qué zona alcanza y qué se hace después de crear.
  const db = await createSupabaseServer();

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

  // ── Los TÉRMINOS los decide el módulo de dominio ──────────────────────────
  // La referencia es el ÚLTIMO crédito REGISTRADO del cliente (regla de Carlos,
  // 19-08: no el más grande de su historia), y de ahí salen a la vez la tasa que
  // se arrastra y el techo. `getUltimoCreditoDe` ya excluye los cancelados: una
  // venta deshecha nunca existió financieramente.
  //
  // ⚠️ Desde el 08-13 el SUPERVISOR también es aprobador (regla de Carlos: "que
  // den aprobación o hagan esto manual ellos mismos"), así que entra como
  // `autoridad: "gestor"`: autoriza hasta el máximo del sistema y por encima se
  // rechaza — no hay a quién pedirle.
  const base = await getUltimoCreditoDe(db, input.clienteId);
  const resol = resolverCredito({
    via: "venta",
    autoridad: "gestor",
    clienteId: input.clienteId,
    cobradorId: input.cobradorId,
    actorId: u.id,
    monto: input.monto,
    totalDias: input.totalDias,
    frecuencia: input.frecuencia,
    interesPct: input.interesPct,
    referencia: referenciaDe(base),
    nonce: input.nonce,
    hoy: new Date(),
  });
  if (resol.via === "rechazo") return { ok: false, error: resol.error };
  const t = resol.terminos;
  const { monto, totalDias, cuota } = t;

  const res = await crearCreditoNuevoDb(db, {
    clienteId: t.clienteId,
    cobradorId: t.cobradorId,
    monto: t.monto,
    cuota: t.cuota,
    totalDias: t.totalDias,
    frecuencia: t.frecuencia,
    fechaInicio: t.fechaInicio,
    interesPct: t.interesPct,
    creadoPor: u.id,
    opId: t.opId,
  });
  if (!res.ok) return res;

  // Si este cliente tenía un pedido de VENTA sobre-techo esperando en la cola y
  // el gestor le dio el alta directa desde la ficha ("que hagan esto manual
  // ellos mismos"), el pedido queda huérfano: días después el otro gestor lo
  // aprueba y sale un SEGUNDO crédito (el patrón JORGE, 06→09-08 — el cartel
  // ámbar de colocadoDespues no alcanzó entonces y por eso los otros tres
  // caminos ya cierran automático). Best-effort: el crédito ya está creado.
  if (t.referenciaId && res.prestamoId && !res.repetido) {
    try {
      await cerrarSolicitudPendienteDeAnterior(
        db,
        t.referenciaId,
        res.prestamoId,
        u.id,
        "rechazada",
        `Se colocó desde el panel por ${UYU(monto)} sin resolver el pedido.`,
        "venta",
      );
    } catch {
      /* la cola se limpia igual a mano; no frenar el alta ya hecha */
    }
  }

  if (!res.repetido) {
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: t.referenciaId
        ? "Dio de alta un crédito nuevo (cliente que volvió)"
        : "Dio de alta el primer crédito del cliente",
      entidad: "cliente",
      entidadId: input.clienteId,
      // El formato queda escrito en el asiento: es el dato que faltaba cuando
      // ocho planes semanales nacieron 'diario' sin que nadie pudiera verlo.
      detalle: `${UYU(monto)} × ${totalDias} (${t.frecuencia}) · cuota ${UYU(cuota)} · ruta: ${(cob as { nombre?: string }).nombre ?? "—"}`,
    });
  }

  revalidatePath(`/admin/clientes/${input.clienteId}`);
  revalidatePath("/admin/renovaciones");
  revalidatePath("/admin/mora");
  revalidatePath("/admin");
  return { ok: true, prestamoId: res.prestamoId, cuota, repetido: res.repetido };
}
