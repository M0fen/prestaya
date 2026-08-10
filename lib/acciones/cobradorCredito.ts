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
//   · RENOVAR — repetir el crédito que su cliente terminó de pagar, POR EL MISMO
//     MONTO (regla de Carlos, 06-08: "si terminó 60k, se renueva en 60k"). El
//     monto viene puesto pero es EDITABLE: hasta +20% lo aprueba él solo; por
//     encima se le pide al admin en vez de rebotar.
//   · NUEVA VENTA — colocarle OTRO crédito a un cliente suyo, dentro del tramo
//     que le corresponde por historial. Puede tener VARIOS a la vez y no hace
//     falta que esté al día (regla de Carlos, 07-08): la deuda viva se le muestra
//     al cobrador y la decisión es suya. Sin tope de cantidad: lo que acota la
//     exposición es el CAP por crédito y el tramo según su historial.
//
//  Lo que NO puede (y por qué):
//   · Superar el CAP de $100.000 — duro para todos, incluido el admin.
//   · Exceder el +20% — eso NO lo rechaza: lo pide al admin.
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
} from "@/lib/data/creditoNuevo";
import {
  calcularCuotaCreditoNuevo,
  interesDeBase,
  INTERES_DEFECTO_PCT,
} from "@/lib/creditoNuevo";
import {
  montoRenovacionAutoAprobable,
  montoRenovacionSugerido,
  techoRenovacion,
  techoVentaNueva,
  RENOVACION_CAP_TOTAL,
} from "@/lib/renovacion";
import { crearSolicitudDb, cerrarSolicitudPendienteDeAnterior } from "@/lib/data/solicitudesRenovacion";
import { calcularEstadosCarton, proximoDiaCobro } from "@/lib/cartones";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { esUuid, opIdDeterminista } from "@/lib/idempotencia";
import { hoyUY } from "@/lib/fecha";
import { toIso, UYU } from "@/lib/format";
import type { FrecuenciaPrestamo } from "@/types/db";

export type ResultadoColocar =
  | { ok: true; prestamoId?: string; cuota?: number; repetido?: boolean }
  /** Se mandó a la oficina para que el admin la apruebe (no se creó nada todavía). */
  | { ok: true; solicitado: true; mensaje: string }
  /** Frenado por el candado anti doble-colocación: el primer crédito YA existe. */
  | { ok: false; error: string; duplicado?: boolean };

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
 * Manda la renovación a la OFICINA para que el admin la apruebe, en vez de
 * devolverle al cobrador un error sin salida. Se escribe con service_role porque
 * `solicitudes_renovacion` es de gestores por RLS; la autorización ya la dieron
 * `puerta()` (rol cobrador + cliente de su ruta) y los gates de propiedad/saldado.
 */
async function pedirAprobacion(
  db: Awaited<ReturnType<typeof createSupabaseServer>>,
  u: { id: string; nombre: string },
  s: {
    clienteId: string;
    prestamoAnteriorId: string;
    monto: number;
    totalDias: number;
    frecuencia: FrecuenciaPrestamo;
  },
): Promise<ResultadoColocar> {
  try {
    await crearSolicitudDb(createSupabaseAdmin(), {
      clienteId: s.clienteId,
      prestamoAnteriorId: s.prestamoAnteriorId,
      monto: s.monto,
      totalDias: s.totalDias,
      frecuencia: s.frecuencia,
      solicitadoPor: u.id,
      solicitadoPorNombre: u.nombre,
    });
  } catch (e) {
    // Una solicitud pendiente por crédito (unique): el segundo toque no duplica.
    if ((e as { code?: string } | null)?.code === "23505")
      return { ok: true, solicitado: true, mensaje: "Ya estaba pedido a la oficina. Sigue esperando el OK." };
    return { ok: false, error: "No se pudo pedir la aprobación. Probá de nuevo." };
  }
  await registrarAuditoria(db, {
    actorId: u.id,
    actorNombre: u.nombre,
    accion: "Pidió aprobación para renovar (supera el tope)",
    entidad: "cliente",
    entidadId: s.clienteId,
    detalle: `${UYU(s.monto)} × ${s.totalDias} (${s.frecuencia}) — espera al admin`,
  });
  revalidatePath("/cobrador/colocar");
  return {
    ok: true,
    solicitado: true,
    mensaje: "PEDIDO a la oficina. Todavía no está aprobado.",
  };
}

/** Ventana del candado anti doble-colocación. Los duplicados reales del piloto
 *  fueron de 1 y 2 minutos (MAICOL RIVERO 17:53→17:55, JOSE MONTERO 17:29→17:30). */
const VENTANA_DOBLE_ALTA_MS = 15 * 60 * 1000;

/**
 * ¿Ya se le colocó ESTE MISMO monto a ESTE cliente hace un rato?
 *
 * ⚠️ La idempotencia por `op_id` solo reconoce el REINTENTO de la misma operación.
 * Dos toques separados generan op_id distintos y pasan los dos: el 08-08 quedaron
 * MAICOL RIVERO con dos créditos de $7.000 (2 minutos) y JOSE MONTERO con dos de
 * $5.000 (1 minuto), $28.000 de capital duplicado contando el tercero. Y como un
 * cliente PUEDE tener varios créditos a la vez, nada más lo iba a frenar.
 *
 * Se mira con el cliente ADMIN: la RLS del cobrador filtra por asignación y podría
 * esconderle justo el crédito que él mismo acaba de crear.
 */
async function yaColocoEsteMonto(
  clienteId: string,
  monto: number,
  cobradorId: string,
): Promise<{ id: string; hace: number } | null> {
  const admin = createSupabaseAdmin();
  const desde = new Date(Date.now() - VENTANA_DOBLE_ALTA_MS).toISOString();
  const { data } = await admin
    .from("prestamos")
    .select("id, creado_en")
    .eq("cliente_id", clienteId)
    .eq("creado_por", cobradorId)
    .eq("estado", "activo")
    .eq("monto_prestado", monto)
    .gte("creado_en", desde)
    .order("creado_en", { ascending: false })
    .limit(1);
  const p = data?.[0];
  if (!p) return null;
  return {
    id: p.id as string,
    hace: Math.round((Date.now() - new Date(p.creado_en as string).getTime()) / 60000),
  };
}

/**
 * ¿La renovación de este crédito YA SE HIZO? Mira el linaje `renovado_de` (0116),
 * que es la verdad aunque la respuesta se haya perdido en el camino.
 *
 * ⚠️ Candado de propiedad: si el que renovó fue el compañero (o la oficina), NO se
 * le confirma al cobrador una renovación que él no hizo — con 53 clientes
 * compartidos entre rutas eso pasa de verdad, y confirmárselo lo haría entregar
 * plata por un crédito ajeno.
 */
async function renovacionYaHecha(
  db: Awaited<ReturnType<typeof createSupabaseServer>>,
  prestamoAnteriorId: string,
  cobradorId: string,
): Promise<ResultadoColocar | null> {
  const { data } = await db
    .from("prestamos")
    .select("id, cuota_diaria, cobrador_id")
    .eq("renovado_de", prestamoAnteriorId)
    .eq("estado", "activo")
    .order("creado_en", { ascending: false })
    .limit(1);
  const h = data?.[0];
  if (!h || (h.cobrador_id && h.cobrador_id !== cobradorId)) return null;
  return {
    ok: true,
    prestamoId: h.id as string,
    cuota: Math.round(Number(h.cuota_diaria) || 0),
    repetido: true,
  };
}

/**
 * RENOVAR — repetir el crédito que el cliente terminó de pagar, de un toque.
 * Solo si ese crédito está SALDADO. Por defecto va POR EL MISMO MONTO; si la
 * calle manda uno editado, se acepta hasta el techo del cobrador (+20%), por
 * encima se le pide al admin, y pasado el máximo se rechaza mostrando el número.
 */
export async function renovarDesdeCalle(input: {
  clienteId: string;
  prestamoId: string;
  /** Monto a colocar. Si no viene, el servidor usa el +20% del negocio. Si viene y
   *  se pasa del techo del cobrador, la renovación se le PIDE al admin en vez de
   *  rebotar (pedido de Carlos, 06-08: poder cambiarlo a mano en la calle). */
  monto?: number;
  /** Cantidad de cuotas del crédito NUEVO. Si no viene, se hereda del anterior.
   *  Cambiarla NO cambia lo que el cliente paga en total (monto × su tasa): reparte
   *  ese total en más o menos cuotas, o sea que sube o baja la cuota diaria. */
  cuotas?: number;
  /** El cobrador CONFIRMÓ que de verdad quiere colocar OTRO crédito por el mismo
   *  monto, sabiendo que hace minutos ya le colocó uno igual a este cliente. */
  repetirIgual?: boolean;
  nonce?: string;
}): Promise<ResultadoColocar> {
  const p = await puerta(input.clienteId);
  if (!p.ok) return p;
  const { u, db } = p;

  const activos = await getPrestamosActivosPorCliente(db, input.clienteId);
  const ant = activos.find((x) => x.id === input.prestamoId);
  if (!ant) {
    // ¿O ya se renovó y se perdió la respuesta? En la calle se corta la señal a
    // mitad de la operación todo el tiempo, y la propia app le enseña al cobrador
    // a reintentar ("no se duplica"). Si el reintento contestaba "ya no está
    // activo", el cobrador daba la renovación por fallida y NO entregaba la plata
    // — pero el crédito existía y le empezaba a cobrar cuotas a alguien que no
    // recibió nada. El linaje `renovado_de` (0116) dice la verdad.
    const ya = await renovacionYaHecha(db, input.prestamoId, u.id);
    if (ya) return ya;
    return { ok: false, error: "Ese crédito ya no está activo." };
  }
  // ⚠️ PROPIEDAD DEL CRÉDITO. La escritura va con service_role (ver abajo), así
  // que la RLS ya no filtra nada: hay que exigir acá que el crédito sea SUYO. Con
  // 59 clientes compartidos entre dos rutas, sin esto un cobrador podría renovar
  // —y quedarse con la comisión de— el crédito de un compañero, porque la RPC
  // valida cliente/CAP/saldado pero NO el dueño.
  if (ant.cobrador_id && ant.cobrador_id !== u.id)
    return {
      ok: false,
      error: "Ese crédito es de otro cobrador. Que lo renueve él o la oficina.",
    };

  // ¿Terminó de pagar EL CRÉDITO QUE SE RENUEVA? Se exige saldado SOLO el elegido,
  // igual que el camino de la oficina (lib/data/renovaciones.ts). Exigir que TODOS
  // los créditos del cliente estén en cero (como se hizo el 08-04) contradice la
  // regla del negocio de que el multi-crédito es legítimo: un cliente que termina
  // uno y sigue pagando otro NO podía renovar el terminado — y encima desaparecía
  // mudo de la lista "Renovar" (reporte de campo 08-05, caso 8).
  const pagosDelElegido = await getPagosDePrestamo(db, ant.id);
  const cartonElegido = calcularEstadosCarton(ant, pagosDelElegido, hoyUY());
  if (cartonElegido.falta >= 1) {
    return {
      ok: false,
      error: `Todavía le falta pagar ${UYU(cartonElegido.falta)}. Se renueva cuando termine.`,
    };
  }

  const montoAnterior = Math.round(Number(ant.monto_prestado) || 0);
  const diasAnterior = Number(ant.total_dias) || 0;
  if (!(montoAnterior > 0) || !(diasAnterior > 0)) {
    return {
      ok: false,
      error: "Los términos del crédito anterior no son válidos. Avisá a la oficina.",
    };
  }
  // El crédito se pasa del tope del sistema (herencia de Disapp: 135 activos, hasta
  // $1.750.000). NO es un callejón sin salida: se le manda la solicitud al admin
  // para que la apruebe (decisión de Carlos, 06-08). Antes esto devolvía un error
  // y el cliente quedaba sin forma de renovar — encima el crédito ni siquiera
  // aparecía en la lista. El monto pedido NO se recorta al CAP: recortarlo sería
  // rebajarle el capital al cliente en silencio.
  // ── UNA SOLA REGLA PARA EL MONTO DE LA RENOVACIÓN ────────────────────────
  //  Por defecto se repite el MISMO monto que terminó (regla de Carlos, 06-08:
  //  "si terminó 60k, se renueva en 60k"). El cobrador puede cambiarlo: está
  //  frente al cliente. Y entonces hay tres tramos, en este orden:
  //    · hasta su TECHO (+20%)        → lo aprueba él solo, se crea en el acto
  //    · entre el techo y el MÁXIMO   → va a la oficina (no rebota)
  //    · por encima del máximo        → se rechaza mostrando el número posible
  //
  //  ⚠️ Antes había DOS ramas y la primera se elegía por el monto ANTERIOR, no
  //  por el pedido: un crédito heredado de $120.000 que se quería renovar en
  //  $50.000 —por debajo del tope y del propio techo del cobrador— igual se iba
  //  a la cola del admin y el cliente esperaba sin razón.
  // CUOTAS del crédito nuevo. Por defecto se heredan del anterior (renovar es
  // repetir), pero el cobrador puede cambiarlas: el cliente a veces necesita la
  // cuota más baja aunque tarde más. Cambiarlas NO cambia lo que paga en TOTAL
  // (monto × su tasa) — reparte ese total en más o menos cuotas.
  // Mismo tope que la venta de calle: sin él, un `totalDias` absurdo (1 o 5.000)
  // produce una cuota disparatada y el cartón queda ilegible.
  const totalDias = input.cuotas == null ? diasAnterior : Math.round(Number(input.cuotas));
  if (!Number.isInteger(totalDias) || totalDias <= 0 || totalDias > 366) {
    return { ok: false, error: "Revisá la cantidad de cuotas (máximo 366)." };
  }

  const techoSolo = montoRenovacionAutoAprobable(montoAnterior);
  const maximo = techoRenovacion(montoAnterior);
  const pedido =
    input.monto == null ? montoRenovacionSugerido(montoAnterior) : Math.round(Number(input.monto));
  if (!Number.isFinite(pedido) || pedido <= 0) {
    return { ok: false, error: "Revisá el monto de la renovación." };
  }
  if (pedido > maximo) {
    // No se recorta en silencio (un cero de más se volvía un crédito 5× más
    // grande) ni se manda a una puerta que no existe: el máximo es duro también
    // para la oficina, así que decirle "pedíselo a la oficina" era mentira.
    return {
      ok: false,
      error: `Para este cliente el máximo posible es ${UYU(maximo)} — ni la oficina puede subirlo. Revisá el monto.`,
    };
  }
  if (pedido > techoSolo) {
    return pedirAprobacion(db, u, {
      clienteId: input.clienteId,
      prestamoAnteriorId: ant.id,
      monto: pedido,
      totalDias,
      frecuencia: (ant.frecuencia as FrecuenciaPrestamo) ?? "diario",
    });
  }
  const monto = pedido;

  // CANDADO ANTI DOBLE-COLOCACIÓN: el mismo monto al mismo cliente hace minutos.
  // Solo se salta si el cobrador CONFIRMA que de verdad son dos créditos.
  if (!input.repetirIgual) {
    const gemelo = await yaColocoEsteMonto(input.clienteId, monto, u.id);
    if (gemelo)
      return {
        ok: false,
        error: `Hace ${gemelo.hace === 0 ? "un momento" : `${gemelo.hace} min`} ya le colocaste ${UYU(monto)} a este cliente. Si de verdad son DOS créditos, tocá de nuevo para confirmarlo; si fue sin querer, mirá su ficha — el primero ya está creado.`,
        duplicado: true,
      };
  }

  // ⚠️ La ESCRITURA va con service_role, igual que la colocación de la calle
  // (línea ~238). Con la sesión del cobrador, la RPC `renovar_credito_seguro`
  // (SECURITY INVOKER) ejecuta su UPDATE bajo la policy `prestamos_update`, que
  // solo habilita gestores (`app_gestor_ve_cliente` = admin o supervisor de la
  // zona). Para un cobrador el UPDATE afectaba 0 filas y la RPC lo interpretaba
  // como carrera perdida → P0410 → "El crédito anterior ya fue renovado por otra
  // persona" EN ROJO, en cada renovación de campo (día 1 del piloto: 0 renovaciones
  // completadas). La AUTORIZACIÓN no se relaja: la da `puerta()` (rol cobrador +
  // cliente en su ruta por RLS) y los gates de arriba (saldado, CAP, términos).
  const admin = createSupabaseAdmin();
  const res = await crearRenovacion(
    admin,
    {
      clienteId: input.clienteId,
      prestamoAnteriorId: ant.id,
      monto,
      totalDias,
      frecuencia: (ant.frecuencia as FrecuenciaPrestamo) ?? "diario",
      creadoPor: u.id,
      // Un crédito HEREDADO por encima del CAP se repite tal cual: la RPC tiene su
      // propio tope duro (P0411) que no sabe que esto es continuidad, no capital
      // nuevo. Sin esto, renovar un $120.000 por el mismo monto reventaba en rojo.
      permitirSobreCap: monto > RENOVACION_CAP_TOTAL,
    },
    new Date(),
    admin,
  );
  if (!res.ok) {
    // ⚠️ Antes de darle un error al cobrador: ¿el crédito NACIÓ igual? Pasa cuando
    // el 2º toque del reintento —el que la propia app recomienda ("no se duplica")—
    // entra mientras el 1º todavía tiene el candado: el anterior ya quedó finalizado
    // y la RPC devuelve P0410 "ya fue renovado por otra persona"... siendo él mismo.
    // Con el rojo en pantalla el cobrador NO entregaba la plata, y el cliente
    // empezaba a pagar al día siguiente un crédito que nunca recibió.
    const ya = await renovacionYaHecha(db, ant.id, u.id);
    if (ya) return ya;
    return res;
  }

  // Si había un pedido a la oficina por ESTE mismo crédito y al final se renovó
  // acá (por un monto que sí entra en el techo), la solicitud queda huérfana:
  // pendiente para siempre en la cola del admin, y el índice de "una pendiente por
  // crédito" bloquea pedir otra cosa. Best-effort: el crédito ya está creado.
  if (res.prestamoId) {
    try {
      // Se cierra como RECHAZADA, no "aprobada": la oficina nunca la miró. El
      // cobrador se arrepintió y colocó un monto que entra en su techo.
      await cerrarSolicitudPendienteDeAnterior(
        createSupabaseAdmin(),
        ant.id,
        res.prestamoId,
        u.id,
        "rechazada",
        `El cobrador renovó por ${UYU(monto)} sin esperar la aprobación.`,
      );
    } catch {
      /* la cola se limpia igual desde el panel; no frenar al cobrador por esto */
    }
  }

  await registrarAuditoria(db, {
    actorId: u.id,
    actorNombre: u.nombre,
    accion: "Renovó un crédito desde la calle",
    entidad: "cliente",
    entidadId: input.clienteId,
    detalle:
      monto === montoAnterior
        ? `${UYU(monto)} × ${totalDias} (mismo monto que terminó)`
        : `${UYU(montoAnterior)} → ${UYU(monto)} × ${totalDias} (${monto > montoAnterior ? "+" : "−"}${UYU(Math.abs(monto - montoAnterior))})`,
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
  /** Confirmación explícita de que son DOS créditos distintos (ver el candado). */
  repetirIgual?: boolean;
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

  // CANDADO ANTI DOBLE-COLOCACIÓN: el mismo monto al mismo cliente hace minutos.
  // Solo se salta si el cobrador CONFIRMA que de verdad son dos créditos.
  if (!input.repetirIgual) {
    const gemelo = await yaColocoEsteMonto(input.clienteId, monto, u.id);
    if (gemelo)
      return {
        ok: false,
        error: `Hace ${gemelo.hace === 0 ? "un momento" : `${gemelo.hace} min`} ya le colocaste ${UYU(monto)} a este cliente. Si de verdad son DOS créditos, tocá de nuevo para confirmarlo; si fue sin querer, mirá su ficha — el primero ya está creado.`,
        duplicado: true,
      };
  }

  // ⚠️ REGLA DEL NEGOCIO (Carlos, 07-08): un cliente PUEDE tener VARIOS créditos a
  // la vez, sin necesidad de estar al día con los anteriores. Acá había un bloqueo
  // ("Este cliente ya tiene un crédito. Renovalo cuando lo termine de pagar") que
  // hacía imposible la venta nueva en la calle — el reporte del operador. La
  // exposición NO queda suelta: sigue el CAP por crédito, sigue el techo del tramo
  // según su historial, y la pantalla le muestra al cobrador la deuda viva de los
  // otros créditos antes de decidir. Cuántos créditos aguanta cada cliente es una
  // decisión de negocio, no del sistema.

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
  //
  // ⚠️ Se compara contra `techoVentaNueva` — LA MISMA función con la que la lista
  // dibuja "podés darle hasta $X" — y no contra el PORCENTAJE. Comparando el
  // porcentaje, el redondeo del techo mostrado podía dar 20,004% y el servidor
  // rechazaba en rojo exactamente el número que la pantalla acababa de ofrecer.
  const techo = techoVentaNueva(baseTasa!.monto);
  if (monto > techo)
    return {
      ok: false,
      error: `A este cliente le podés dar hasta ${UYU(techo)} vos solo (su último crédito fue de ${UYU(baseTasa!.monto)}). Para más, pedíselo a tu supervisor.`,
    };

  const interesPct = interesDeBase(baseTasa);
  const cuota = calcularCuotaCreditoNuevo(
    baseTasa,
    monto,
    totalDias,
    interesPct ?? INTERES_DEFECTO_PCT,
  );
  if (!(cuota > 0))
    return { ok: false, error: "La cuota calculada no es válida. Revisá monto y cuotas." };

  // Arranca el PRÓXIMO día de cobro: se entrega hoy, se paga desde mañana.
  const fechaInicio = toIso(proximoDiaCobro(hoyUY(new Date())));
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
    // ⚠️ Acá había un ROLLBACK que BORRABA el crédito recién creado si el cliente
    // quedaba con más de un activo. Con la regla nueva (dos créditos a la vez son
    // legítimos) ese rollback destruiría ventas buenas, así que se saca.
    //
    // Lo que SÍ protegía —la carrera de dos requests paralelas del MISMO cobro—
    // lo cubre la idempotencia por `op_id` (índice único), que es el candado
    // correcto: frena el duplicado sin frenar el segundo crédito legítimo.
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
