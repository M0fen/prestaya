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
  getClientePorDocumentoFlexible,
  getClienteRecientePorNombre,
  getClientePorId,
} from "@/lib/data/clientes";
import {
  getPrestamoActivoPorCliente,
  getPrestamosActivosPorCliente,
} from "@/lib/data/prestamos";
import { getPagosDePrestamo, registrarPago, esSobrePago, esGemelo } from "@/lib/data/pagos";
import { subirFotoCliente } from "@/lib/data/fotos";
import type { Prestamo } from "@/types/db";

import { gemeloReciente } from "@/lib/candadoCobro";
import { crearVisita } from "@/lib/data/visitas";
import { registrarBitacora } from "@/lib/data/bitacora";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { calcularEstadosCarton } from "@/lib/cartones";
import { evaluarZona, MAX_PRECISION_ANCLA_M } from "@/lib/geo";
import { hoyUY, sellarRegistroEn } from "@/lib/fecha";
import { UYU } from "@/lib/format";
import { validar, cobroSchema, noPagoSchema } from "@/lib/validacion/esquemas";
import { reportarError } from "@/lib/observabilidad";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";

// ── Censo ────────────────────────────────────────────────────────────────────
export type ResultadoCenso =
  | { ok: true; id: string; adoptado?: boolean }
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
    // El censo AUTO-ASIGNA el cliente a quien lo da de alta (más abajo). Si lo
    // corre un gestor, el cliente queda "en la ruta" de alguien que no camina
    // ninguna ruta: no aparece en la app de ningún cobrador, y al colocarle un
    // crédito nace el fantasma que INV10 marca como crítico. El alta de oficina
    // tiene su propia pantalla en el panel.
    if (usuario.rol !== "cobrador") {
      return { ok: false, error: "El censo en calle lo hace el cobrador. Desde la oficina, dá de alta al cliente en el panel." };
    }
    // Kill-switch: el censo crea la ficha que después recibe capital. Si el
    // sistema está en solo-lectura por un incidente, tampoco se dan altas.
    if (await bloqueoSoloLectura()) {
      return { ok: false, error: "El sistema está en modo consulta por unos minutos. Probá de nuevo enseguida." };
    }

    const nombre = (input.nombre ?? "").trim();
    if (nombre.length < 2) return { ok: false, error: "Poné el nombre del cliente." };
    // Foto OPCIONAL desde 08-05 (decisión de Carlos): había clientes que no
    // querían la foto y el alta quedaba trabada. Sigue siendo lo recomendado
    // (anti cliente-fantasma): la pantalla pide confirmar el alta sin foto y
    // el faltante queda visible en la ficha para completarlo después.
    const documento = limpiar(input.documento);
    const telefono = limpiar(input.telefono);
    const direccion = limpiar(input.direccion);
    const notas = limpiar(input.notas)?.slice(0, 500) ?? null;
    const gpsCrudoLat = numeroValido(input.gpsLat);
    const gpsCrudoLng = numeroValido(input.gpsLng);
    const precisionAncla = numeroValido(input.gpsPrecision);
    // El ancla rige la geo-cerca de TODOS los cobros futuros del cliente, así que se
    // fija SOLO si el fix es confiable. Se descarta cuando:
    //  · es null / no numérico;
    //  · es 0,0 (fix ROTO en Uruguay, lat≈−34/lng≈−56);
    //  · la ACCURACY falta o supera MAX_PRECISION_ANCLA_M (=radio de la cerca): un
    //    ancla más incierta que el propio radio desplazaría el centro más que el radio
    //    → acusaría "fuera de zona" a cobros honestos por siempre (mejor sin ancla).
    // El cliente ya avisa "precisión baja"; esto BLINDA el servidor (el form es saltable).
    const anclaValida =
      gpsCrudoLat != null &&
      gpsCrudoLng != null &&
      !(Math.abs(gpsCrudoLat) < 0.5 && Math.abs(gpsCrudoLng) < 0.5) &&
      precisionAncla != null &&
      precisionAncla <= MAX_PRECISION_ANCLA_M;
    const gps_lat = anclaValida ? gpsCrudoLat : null;
    const gps_lng = anclaValida ? gpsCrudoLng : null;

    const db = createSupabaseAdmin();

    if (documento) {
      // Se compara por TODAS las formas de escribir la cédula (con y sin puntos):
      // el import de Disapp dejó los dos estilos conviviendo.
      const yaExiste = await getClientePorDocumentoFlexible(db, documento);
      if (yaExiste) {
        // ── LA FICHA YA EXISTE: SE SUMA, NO SE PELEA ─────────────────────────
        // Dos muros vivieron acá y los dos terminaron mal:
        //  · "Ese documento ya está registrado" — día 1: 0 clientes creados.
        //  · "Esa persona ya está en la ruta de un compañero" — contradecía la
        //    regla del negocio: un cliente PUEDE estar en dos rutas a la vez, con
        //    créditos de cobradores distintos (54 reales hoy, decisión de Carlos
        //    10-08: "eso no debería ser limitante, ni debería existir").
        //
        // La regla que queda: censar una ficha existente SUMA al cobrador a la
        // ruta del cliente y NO le saca nada a nadie — el compañero conserva su
        // asignación, sus créditos y su comisión (`asignaciones` admite varias
        // activas por cliente, y `consolidarRuta` protege al que tiene crédito
        // vivo). El único freno que sobrevive es el cliente dado de BAJA: esa es
        // una decisión de la oficina, no un empate de rutas.
        if (!yaExiste.activo) {
          return { ok: false, error: "Esa persona está dada de baja en el sistema. Avisale a tu supervisor para reactivarla." };
        }
        const { data: asigs } = await db
          .from("asignaciones")
          .select("cobrador_id")
          .eq("cliente_id", yaExiste.id)
          .eq("activo", true);
        const dueños = (asigs ?? []).map((a) => a.cobrador_id as string);
        if (dueños.includes(usuario.id)) {
          return { ok: true, id: yaExiste.id, adoptado: true }; // ya es suyo
        }
        const compartida = dueños.length > 0;
        const { error: errAdopt } = await db
          .from("asignaciones")
          .upsert(
            { cobrador_id: usuario.id, cliente_id: yaExiste.id, activo: true },
            { onConflict: "cobrador_id,cliente_id" },
          );
        if (errAdopt) throw errAdopt;
        await registrarBitacora(db, {
          actorId: usuario.id,
          actorNombre: usuario.nombre,
          rol: usuario.rol,
          accion: "censo",
          clienteId: yaExiste.id,
          // La bitácora dice si la ficha quedó COMPARTIDA: es el rastro que el
          // supervisor necesita para entender por qué un cliente está en dos
          // rutas — y la ficha ya le muestra al cobrador los créditos del
          // compañero ("Esa parte no la cobrás vos"), así que nadie cobra ajeno.
          detalle: compartida
            ? `${nombre} (ficha sumada a la ruta — COMPARTIDA con otro cobrador)`
            : `${nombre} (ficha existente adoptada a la ruta)`,
          gpsLat: gps_lat,
          gpsLng: gps_lng,
          gpsPrecision: precisionAncla,
          gpsDenegado: gps_lat == null || gps_lng == null,
        });
        revalidatePath("/cobrador");
        return { ok: true, id: yaExiste.id, adoptado: true };
      }
    } else {
      // Sin cédula el alta no es idempotente: si se corta la red al recibir el ACK (el
      // server ya commiteó) el cobrador re-tapea "Guardar" y crearía un 2º cliente
      // idéntico. Best-effort: si ESTE cobrador acaba de dar de alta (≤3 min) un cliente
      // con el MISMO nombre, se asume reintento → se devuelve el existente (idempotente).
      const reciente = await getClienteRecientePorNombre(db, usuario.id, nombre);
      if (reciente) return { ok: true, id: reciente };
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

    // Sube la foto del alta (si vino). Si el UPLOAD falla, se hace ROLLBACK del
    // cliente recién creado: se prometió "alta con foto" y no debe quedar a
    // medias en silencio. Sin foto (opcional, 08-05) no hay nada que subir.
    if (input.fotoDataUrl) {
      const foto = await subirFotoCliente(cliente.id, input.fotoDataUrl);
      if (!foto.ok) {
        await db.from("asignaciones").delete().eq("cliente_id", cliente.id);
        await db.from("clientes").delete().eq("id", cliente.id);
        return { ok: false, error: `${foto.error} No se guardó el cliente; probá de nuevo.` };
      }
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
      // Se guarda la accuracy CRUDA aunque el ancla se haya descartado por imprecisa:
      // deja rastro de por qué el cliente quedó sin geo-cerca (accuracy > umbral).
      gpsPrecision: precisionAncla,
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
  // `retryable`: el fallo es TEMPORAL → la cola offline NO debe envenenar el cobro
  // (marcarlo "atascado" y pedir descartarlo); hay que reintentar. Sin la marca, es un
  // fallo PERMANENTE (crédito finalizado/saldado). `sistemico`: el temporal afecta a
  // TODAS las ops por igual (kill switch, sesión) → la cola corta el batch y reintenta
  // todo, SIN acumular intentos. Un retryable SIN `sistemico` (catch-all: red/DB/timeout)
  // es AMBIGUO/per-op: la cola sigue con el resto y, si otras avanzan, lo escala a atascada.
  // `duplicado`: se frenó por el candado anti doble-toque (mismo crédito, mismo
  // monto, hace unos minutos). NO es un fallo del sistema ni plata perdida: el
  // primer cobro está guardado. La cola lo descarta sin marcarlo "atascado" —
  // pedirle al cobrador que "registre de nuevo" un duplicado sería el bug.
  | { ok: false; error: string; retryable?: boolean; sistemico?: boolean; duplicado?: boolean };

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
  /** El cobrador CONFIRMÓ que quiere registrarlo igual, sabiendo que hace un rato
   *  ya cargó el mismo monto en este crédito (el cliente pagó dos veces de verdad).
   *  Sin esto el servidor frena el duplicado — ver el candado más abajo. */
  adelanto?: boolean | null;
}): Promise<ResultadoCobro> {
  // Validación en el borde: rechaza input malformado antes de tocar la base.
  if (!validar(cobroSchema, input).ok) return { ok: false, error: "Datos del cobro inválidos." };
  try {
    const usuario = await getUsuarioActual();
    // Sesión: un blip de auth (no la culpa del cobro) → retryable + SISTÉMICO (afecta a
    // toda la cola por igual) → la cola reintenta todo, sin envenenar ningún cobro.
    if (!usuario || !usuario.activo) return { ok: false, error: "Se cerró tu sesión. Ingresá de nuevo con tu usuario — lo que ya cobraste está guardado y se sube solo.", retryable: true, sistemico: true };
    const bloqueo = await bloqueoSoloLectura(); // kill switch: congela escrituras de plata
    if (bloqueo) return bloqueo;

    const db = await createSupabaseServer();

    // IDEMPOTENCIA del reintento (exactly-once): si este op_id YA está en el libro
    // —el 1er intento commiteó pero se perdió el ACK de red (común en móvil rural)—
    // es un ÉXITO idempotente: devolver ok con el pago ya guardado, sin reprocesar.
    // Sin esto, el clamp anti-sobre-pago de abajo (min(monto, r.falta) con falta≈0 en
    // el pago que SALDA el crédito) cortaría el reintento y lo marcaría "no se pudo
    // subir" para un cobro que SÍ entró → el cobrador lo re-registra o lo descarta.
    // El insert idempotente (23505) nunca se alcanzaba en ese caso. Índice único op_id.
    //
    // ⚠️ Corre ANTES de resolver cliente/crédito: el select solo necesita el op_id.
    // Si entre el cobro y el reintento el cliente RENOVÓ (el crédito viejo pasa a
    // finalizado), resolver primero devolvía "ya no está activo" —error permanente—
    // para un cobro que SÍ está en el libro, y la pantalla de cierre invitaba a
    // re-registrarlo sobre el crédito nuevo: la misma plata dos veces.
    if (input.opId) {
      const { data: yaGuardado } = await db
        .from("pagos")
        .select("dia_credito, monto")
        .eq("op_id", input.opId)
        .limit(1);
      if (yaGuardado && yaGuardado.length > 0) {
        return { ok: true, dia: Number(yaGuardado[0].dia_credito), monto: Math.round(Number(yaGuardado[0].monto)), enZona: null };
      }
    }

    const cliente = await getClientePorId(db, input.clienteId);
    if (!cliente) return { ok: false, error: "Cliente no encontrado." };
    const prestamo = await resolverPrestamo(
      db,
      cliente.id,
      input.prestamoId,
      usuario.rol === "cobrador" ? usuario.id : null,
    );
    // Se ve sobre todo al vaciar la COLA OFFLINE: se cobró sin señal y mientras
    // tanto el crédito se renovó, se anuló o se saldó. El cobrador ya tiene el
    // efectivo del cliente encima, así que el mensaje tiene que decirle qué
    // hacer con esa plata, no solo qué pasó.
    if (!prestamo)
      return {
        ok: false,
        error:
          "Ese crédito ya no está activo (lo renovaron o se saldó). No entregues esa plata todavía: dejá una nota en la ficha del cliente y avisale a tu supervisor.",
      };

    // Imputar al primer día no cubierto (o al día de hoy).
    const pagos = await getPagosDePrestamo(db, prestamo.id);
    const r = calcularEstadosCarton(prestamo, pagos, hoyUY());
    // Tolerancia sub-peso (espejo del cartón): una cuota fraccionaria (351,04) pagada
    // completa queda en 351 (entero) → sin el −0,5 este día se re-elegiría como
    // objetivo en vez de avanzar FIFO al día siguiente.
    const objetivo =
      r.dias.find((d) => d.estado !== "futuro" && d.montoPagado < prestamo.cuota_diaria - 0.5) ??
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

    // ─────────────────────────────────────────────────────────────────────
    //  CANDADO ANTI DOBLE-COBRO — DEL LADO DEL SERVIDOR.
    //
    //  Hasta acá la única protección vivía en el navegador (`useState` en
    //  RegistroCobro). Un `useState` se evapora en cada remonte, y el componente
    //  remonta al cambiar de crédito (`key={prestamo.id}`); además el panel "Otro
    //  monto" y el botón de adelanto quedaban fuera de esa guarda. El servidor
    //  aceptaba el segundo cobro sin preguntar nada: la idempotencia por `op_id`
    //  solo reconoce el REINTENTO de la misma operación, y el clamp de arriba capa
    //  contra el SALDO del crédito, no contra la cuota del día.
    //
    //  Casos reales del piloto (misma visita a la ficha, sin navegar):
    //    · CARLOS SANTIAGO DA SILVA  $600 + $600 en 40 segundos
    //    · GUSTAVO DANIEL DORNELLS   $750 + $750 en 22 segundos
    //    · ARACELI RANGER            $600 + $600 sobre una cuota de $800
    //
    //  ⚠️ LA REGLA ES ESTRECHA A PROPÓSITO: mismo crédito, MISMO MONTO, dentro de
    //  unos minutos. Medido sobre los 4 días del piloto, los 21 pares de cobros al
    //  mismo crédito en el mismo día se parten en dos grupos limpios:
    //     · 2 pares a 40 y 50 SEGUNDOS  → el doble toque que hay que frenar;
    //     · 16 pares a 2,3–4,9 HORAS    → la SEGUNDA VUELTA de la ruta, legítima;
    //     · 3 pares de montos distintos → pagos parciales / saldar el crédito.
    //  Una regla más ancha ("ya cubrió la cuota de hoy") habría rechazado las 16
    //  vueltas legítimas de un solo día — el 10% de los cobros. El hueco entre 50
    //  segundos y 2,3 horas es enorme, así que la ventana no necesita ser fina.
    // ─────────────────────────────────────────────────────────────────────
    // La hora del cobro se SELLA una sola vez y la usan el candado Y el libro. Es
    // la misma verdad en los dos lados: si el reloj del teléfono está torcido,
    // sellarRegistroEn lo acota a "ahora" — y entonces el candado también compara
    // contra "ahora", nunca contra una hora que no va a existir en el libro.
    const registradoEn = sellarRegistroEn(input.registradoEn);
    if (!input.adelanto) {
      // ⚠️ LA VENTANA SE MIDE CONTRA LA HORA SELLADA DEL COBRO, Y DE DOS LADOS.
      //
      // Contra la hora del cobro (no la del servidor): la cola offline puede drenar
      // horas después, y dos toques a las 10:00 y 10:01 que suben a las 14:00
      // quedaban los dos fuera de una ventana medida desde `Date.now()`.
      //
      // De DOS lados: con un solo lado (`>= limite`, sin tope superior), un cobro
      // REAL que subía tarde encontraba como "gemelo" a un pago del mismo monto
      // registrado HORAS DESPUÉS de él — y la cola lo confirmaba como duplicado, o
      // sea que plata cobrada de verdad desaparecía del libro EN SILENCIO. Esta
      // semana 21 cobros subieron con más de 10 minutos de atraso (13 con más de
      // una hora): la ventana tiene que ser |Δ| ≤ 10 min, no "todo lo posterior".
      // El predicado vive en lib/candadoCobro y lo importan también los tests:
      // el "espejo" ya drifteó una vez (un solo lado) y casi borra plata real.
      const gemelo = gemeloReciente(pagos, monto, new Date(registradoEn).getTime());
      if (gemelo) {
        // Rastro del freno (tablero QA: "0 frenados/semana = candado muerto").
        // Best-effort con admin: la auditoría jamás rompe (ni habilita) el cobro.
        await registrarAuditoria(createSupabaseAdmin(), {
          actorId: usuario.id,
          actorNombre: usuario.nombre,
          accion: "Candado frenó un posible doble cobro",
          entidad: "prestamo",
          entidadId: prestamo.id,
          detalle: `${UYU(monto)} repetido dentro de los 10 min (gemelo de las ${new Date(gemelo.registrado_en as string).toISOString().slice(11, 16)} UTC).`,
        });
        return {
          ok: false,
          error: `Hace un momento ya registraste ${UYU(monto)} en este crédito. Si el cliente PAGÓ DOS VECES, tocá de nuevo para confirmarlo; si fue sin querer, cerrá esta pantalla — el primer cobro ya está guardado.`,
          duplicado: true,
        };
      }
    }

    if (monto <= 0) {
      // op_id NUEVO (no es reintento, ya se descartó arriba) sobre un crédito YA saldado
      // por otros pagos → intento de cobrar de más = posible DOBLE-COBRANZA FÍSICA (el
      // cobrador tiene efectivo de más que hay que devolver/reconciliar). Deja rastro
      // durable para que admin/supervisor lo vean (antes era invisible del lado servidor).
      reportarError("cobro.sobrepago.saldado", new Error("Cobro sobre crédito ya saldado"), {
        clienteId: input.clienteId, prestamoId: prestamo.id, opId: input.opId, solicitado,
      });
      // El cobrador tiene el efectivo EN LA MANO y hasta acá se le decía una
      // frase de tres palabras sin verbo. Con cuotas fraccionarias (351,04) el
      // último día se salda "antes de tiempo" y este caso aparece de verdad.
      return {
        ok: false,
        error:
          "Este crédito ya está saldado: no corresponde cobrar. Si ya recibiste la plata, devolvésela al cliente o dejá una nota en su ficha avisando a la oficina antes de entregarla.",
      };
    }
    const gps_lat = numeroValido(input.gpsLat);
    const gps_lng = numeroValido(input.gpsLng);

    // La precisión (accuracy) del fix del cobro entra a la geo-cerca: con señal mala
    // el resultado queda "indeterminado" (enZona=null) en vez de acusar falso "fuera
    // de zona" a un cobrador honesto.
    const zona = evaluarZona(
      { lat: gps_lat, lng: gps_lng, precision: numeroValido(input.gpsPrecision) },
      { lat: cliente.gps_lat, lng: cliente.gps_lng },
    );

    // (La hora sellada `registradoEn` viene de más arriba: se calcula UNA vez,
    // antes del candado anti doble-toque, y es la misma que entra al libro.)
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
        // El candado ATÓMICO del RPC (0147) respeta la misma confirmación
        // explícita que el candado de la acción: "pagó dos veces de verdad".
        permitir_gemelo: !!input.adelanto,
      });
    } catch (e) {
      // Reintento de una op ya guardada (flush cortado): idempotente → ok.
      if (esDuplicado(e)) {
        duplicado = true;
      } else if (esGemelo(e)) {
        // La carrera de dos dispositivos que el chequeo de arriba no ve: el
        // OTRO toque ganó adentro del lock. El primer cobro YA está en el
        // libro → mismo tratamiento que el candado de la acción (la cola lo
        // descarta sin marcarlo atascado; no es plata perdida).
        await registrarAuditoria(createSupabaseAdmin(), {
          actorId: usuario.id,
          actorNombre: usuario.nombre,
          accion: "Candado frenó un posible doble cobro",
          entidad: "prestamo",
          entidadId: prestamo.id,
          detalle: `${UYU(monto)} repetido — frenado ADENTRO del RPC (carrera de dos dispositivos).`,
        });
        return {
          ok: false,
          error: `Hace un momento ya registraste ${UYU(monto)} en este crédito. Si el cliente PAGÓ DOS VECES, tocá de nuevo para confirmarlo; si fue sin querer, cerrá esta pantalla — el primer cobro ya está guardado.`,
          duplicado: true,
        };
      } else if (esSobrePago(e)) {
        // La carrera perdió: otro pago saldó el crédito primero. PERMANENTE (sin
        // retryable → la cola NO reintenta en loop; se surfacea para reconciliar la
        // plata física si el cobro fue real). Nunca se descarta ni se duplica el libro.
        // Rastro durable: una doble-cobranza física real debe verla el admin.
        reportarError("cobro.sobrepago.carrera", e, {
          clienteId: input.clienteId, prestamoId: prestamo.id, opId: input.opId, monto,
        });
        return { ok: false, error: "Este crédito ya se saldó (entró otro pago). Revisá el cartón antes de reintentar." };
      } else {
        throw e;
      }
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
}): Promise<{ ok: true } | { ok: false; error: string; retryable?: boolean; sistemico?: boolean }> {
  if (!validar(noPagoSchema, input).ok) return { ok: false, error: "Datos inválidos." };
  try {
    const usuario = await getUsuarioActual();
    if (!usuario || !usuario.activo) return { ok: false, error: "Se cerró tu sesión. Ingresá de nuevo con tu usuario — lo que ya cobraste está guardado y se sube solo.", retryable: true, sistemico: true };
    const bloqueo = await bloqueoSoloLectura();
    if (bloqueo) return bloqueo;

    const db = await createSupabaseServer();
    const prestamo = await resolverPrestamo(
      db,
      input.clienteId,
      input.prestamoId,
      usuario.rol === "cobrador" ? usuario.id : null,
    );
    if (!prestamo)
      return { ok: false, error: "Ese crédito ya no está activo (lo renovaron o se saldó). Avisale a tu supervisor." };

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
  /** Cobrador que registra. Si viene, solo se imputa a créditos SUYOS. */
  cobradorId?: string | null,
): Promise<Prestamo | null> {
  // ⚠️ Un cliente puede tener créditos de DOS cobradores y estar en las dos rutas
  // (59 clientes hoy). Validar solo "que el crédito sea de este cliente" dejaba
  // que un cobrador imputara su cobro al crédito del compañero: la plata entra
  // igual (custodia por `registrado_por`) pero la cuota se le descuenta al otro y
  // la comisión se la lleva el otro. Ya pasó hoy: $1.600 de Karent Londoño
  // asentados sobre un crédito de Víctor Moralez.
  const mio = (p: Prestamo) => !cobradorId || !p.cobrador_id || p.cobrador_id === cobradorId;
  const activos = await getPrestamosActivosPorCliente(db, clienteId);
  const propios = activos.filter(mio);
  if (prestamoId) return propios.find((p) => p.id === prestamoId) ?? null;
  // Sin elección explícita: el principal DE LOS SUYOS (nunca el del compañero).
  if (propios.length > 0) return propios[0];
  return cobradorId ? null : getPrestamoActivoPorCliente(db, clienteId);
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
