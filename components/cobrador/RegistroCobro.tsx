"use client";
// Registro de cobro del cobrador — OFFLINE-FIRST. Captura GPS + hora real y
// encola la operación; el SyncEngine (en el layout) la sincroniza cuando hay
// señal. Nunca "no anduvo": registra siempre, con o sin conexión.
import { useEffect, useRef, useState } from "react";
import { PedirAyuda } from "./PedirAyuda";
import { configurarUsuario, encolar, parchearGps, quitar, pendientes, type OpCobro, type OpTipo } from "@/lib/cobrador/colaOffline";
import { MOTIVOS_NOPAGO, type MotivoNoPago } from "@/app/cobrador/(app)/motivos";
import { UYU } from "@/lib/format";
import { Comprobante, type DatosComprobante } from "@/components/cobrador/Comprobante";

type Toast = {
  texto: string;
  sub?: string;
  tono: "ok" | "info" | "alerta";
  /** Acciones inline (Deshacer / Recibo) para el toast de cobro sin fricción. */
  acciones?: { deshacer?: () => void; recibo?: () => void };
} | null;

// Ventana en la que el cobro queda retenido en la cola (no sincroniza): habilita
// "Deshacer" ante un mis-tap (los pagos NO se editan, solo se anulan) y le da
// margen al GPS asíncrono para adjuntarse antes de enviar. Cubre el timeout del
// fix GPS (8s) para que la precisión alcance a adjuntarse antes del flush.
const HOLD_MS = 9000;

// Confirmación háptica: el cobrador "siente" que el cobro entró sin mirar la
// pantalla (está frente al cliente). Silencioso si el dispositivo no lo soporta.
function vibrar(patron: number | number[]): void {
  try {
    navigator.vibrate?.(patron);
  } catch {
    /* no soportado: sin vibración */
  }
}

// Fecha+hora y folio en hora de Uruguay (comprobante consistente en toda la app).
function partesUY(): { fechaHora: string; folio: string } {
  const ahora = new Date();
  const fechaHora = new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(ahora);
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Montevideo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  })
    .formatToParts(ahora)
    .reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {});
  const folio = `PY-${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
  return { fechaHora, folio };
}

// Fix GPS: además de lat/lng, capturamos `precision` (accuracy en metros) — antes
// se pedía alta precisión pero se DESCARTABA, dejando el campo anti-fuga
// `bitacora.gps_precision` siempre vacío. `maximumAge` bajo (8s, antes 30s) evita
// sellar un fix viejo como fresco (el cobro de un cliente heredaba la ubicación del
// anterior); `timeout` más holgado (8s) mejora el lock en frío / offline, que es
// justo cuando el anti-fuga más importa. El HOLD de la cola cubre el timeout.
function pedirGps(): Promise<{ lat: number | null; lng: number | null; precision: number | null }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return resolve({ lat: null, lng: null, precision: null });
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          precision: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
        }),
      () => resolve({ lat: null, lng: null, precision: null }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 8000 },
    );
  });
}

export function RegistroCobro({
  clienteId,
  prestamoId = null,
  clienteNombre,
  clienteTelefono = null,
  cobradorNombre,
  cobradorId,
  cuota,
  saldoActual,
  tieneGps,
  cuotasCubiertas = null,
  totalCuotas = null,
  cuotasAtrasadas = null,
  pagadoHoyServidor = 0,
}: {
  clienteId: string;
  /** Crédito al que se imputa (si el cliente tiene varios activos). null = principal. */
  prestamoId?: string | null;
  clienteNombre: string;
  clienteTelefono?: string | null;
  cobradorNombre: string;
  /** Cobrador logueado: particiona la cola offline por usuario (teléfono compartido). */
  cobradorId: string;
  cuota: number;
  /** Saldo del crédito ANTES de este cobro (para mostrar el restante). */
  saldoActual: number;
  tieneGps: boolean;
  /** Avance del cartón ANTES de este cobro (para el "lleva N de M" del recibo). */
  cuotasCubiertas?: number | null;
  totalCuotas?: number | null;
  cuotasAtrasadas?: number | null;
  /** Cobrado HOY en la APP sobre este crédito, según el SERVIDOR (QA 08-05):
   *  el candado hoyCobrado se rehidrataba solo de la cola offline — con señal,
   *  la op sincroniza a los ~9s y al re-entrar a la ficha el CTA verde volvía
   *  idéntico (variante online del doble-cobro del día 1). */
  pagadoHoyServidor?: number;
}) {
  const [toast, setToast] = useState<Toast>(null);
  const [motivos, setMotivos] = useState(false);
  const [abono, setAbono] = useState(false);
  const [montoAbono, setMontoAbono] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [comprobante, setComprobante] = useState<DatosComprobante | null>(null);
  // ¿Se muestra el comprobante a pantalla completa? Una cuota completa NO lo abre
  // (toast liviano + recibo on-demand): en una ruta de 40 cobros, 40 modales a
  // descartar son fricción. El modal queda para ABONOS y para cobros NO guardados.
  const [modalAbierto, setModalAbierto] = useState(false);
  // Op recién encolada, para poder deshacerla desde el comprobante durante el hold.
  // `hoyCobradoAntes` = cómo estaba el candado ANTES de ese cobro: deshacer un
  // ADELANTO no debe soltar el candado que ganó el PRIMER cobro del día (si lo
  // soltara, el CTA verde volvería idéntico y un re-tap cobraría la cuota de
  // hoy DE NUEVO — el doble-cobro que este candado existe para impedir).
  const [undo, setUndo] = useState<{ opId: string; hasta: number; hoyCobradoAntes: boolean } | null>(null);
  // Tras un cobro, el botón principal queda en "Cobro registrado ✓" durante el hold:
  // el cobrador ve el efecto y no re-toca por falta de feedback (un 2º toque encolaría
  // OTRA cuota con otro op_id → doble cobro). Se libera al vencer el hold o al deshacer.
  const [cobroReciente, setCobroReciente] = useState(false);
  const cobroTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tras cobrar la cuota COMPLETA, el saldo/cartón no se refresca sin router.refresh
  // (imposible offline) → el botón volvía idéntico a "Registrar pago" y un re-tap
  // cobraba OTRA cuota. Marcamos localmente que la cuota de hoy ya se cobró y pedimos
  // una confirmación extra para "adelantar" la próxima (no repetir el CTA verde).
  // Arranca en "ya cobrado" si el SERVIDOR dice que la cuota de hoy está
  // cubierta con trabajo de la app (además de la rehidratación offline de abajo).
  const [hoyCobrado, setHoyCobrado] = useState(() => cuota > 0 && pagadoHoyServidor >= cuota - 0.5);
  const [confirmarAdelanto, setConfirmarAdelanto] = useState(false);
  // Se quiso deshacer un cobro pasada la ventana: hay que darle una salida.
  const [cobroTarde, setCobroTarde] = useState(false);
  // Último monto cobrado, para redactarle el aviso sin que tenga que recordarlo.
  const ultimoMonto = useRef<number | null>(null);
  // El estado de arriba vive en memoria del COMPONENTE: si el cobrador vuelve a
  // la lista y entra de nuevo al mismo cliente, se re-monta en cero y el botón
  // ofrece "Registrar pago" otra vez como si nada — un segundo toque encola un
  // op_id distinto = DOS pagos reales por un solo cobro. Offline el servidor
  // tampoco lo sabe (el pago sigue en la cola, no en `pagos`). Se rehidrata
  // desde la cola: si ya hay un cobro de HOY para este cliente/crédito, se
  // arranca en "ya cobrado".
  useEffect(() => {
    const hoy = new Date().toDateString();
    const yaHay = pendientes().some(
      (o) =>
        o.tipo === "pago" &&
        o.clienteId === clienteId &&
        (o.prestamoId ?? null) === (prestamoId ?? null) &&
        new Date(o.deviceTs).toDateString() === hoy,
    );
    if (yaHay) setHoyCobrado(true);
  }, [clienteId, prestamoId]);
  // Anti-doble-registro: un segundo toque instantáneo no encola otro cobro.
  const bloqueado = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // CUÁNTAS cuotas cobra en esta visita (± , decisión 08-05): el cliente atrasado
  // o el que adelanta paga N cuotas en UN registro, sin tipear el monto.
  const [nCuotas, setNCuotas] = useState(1);
  // Confirmación explícita del cobro (decisión 08-05): primer toque arma el botón
  // ("Sí, cobrar $X"), segundo toque registra. Se desarma solo a los 6 s.
  const [confirmarCobro, setConfirmarCobro] = useState(false);
  const confirmarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Saldo del crédito ANTES de este cobro, redondeado. La "cuota efectiva" nunca
  // supera el saldo: en un crédito casi saldado NO se ofrece cobrar la cuota entera
  // (sería sobre-pago). El servidor igual capa —esta es la señal para el cobrador—.
  const saldoRedondeado = Math.max(0, Math.round(saldoActual));
  const cuotaEfectiva = Math.min(cuota, saldoRedondeado);
  const saldado = saldoRedondeado <= 0;
  // Tope del ±: nunca más cuotas de las que le quedan al crédito (anti sobre-pago),
  // y con un techo sano de 30 (más que eso se tipea en "Otro monto"). El +0,5 es
  // la tolerancia sub-peso: con cuota fraccionaria (351,04) y deuda de 5 cuotas
  // exactas, el floor "seco" solo dejaba llegar a 4.
  const maxCuotas =
    cuota > 0 ? Math.max(1, Math.min(30, Math.floor((saldoRedondeado + 0.5) / cuota))) : 1;
  // Monto del CTA según el ±. Con 1 cuota se manda null (el SERVIDOR resuelve
  // cuota-o-saldo, chokepoint de siempre); con N se manda cuota×N topado al saldo.
  const montoSeleccion =
    nCuotas <= 1 ? cuotaEfectiva : Math.min(Math.round(cuota * nCuotas), saldoRedondeado);

  // ⚠️ ¿Este toque CANCELA el crédito entero? Llevar el ± hasta el tope deja el
  // saldo en cero, y la confirmación decía exactamente lo mismo que para una cuota
  // normal. El día 1 pasó 6 veces ($303.260): tres salieron del ± al máximo y tres
  // del campo libre; ninguno estaba en Disapp. El cobrador NO puede deshacerlo
  // (solo un gestor anula), así que la única defensa es que lea antes de confirmar.
  // Se exige más de 2 cuotas para no molestar en el pago final normal de un crédito.
  const cancelaCredito =
    saldoRedondeado > 0 &&
    montoSeleccion >= saldoRedondeado - 0.5 &&
    cuotaEfectiva > 0 &&
    montoSeleccion > cuotaEfectiva * 2;

  const armadoEn = useRef(0);
  const tocarCobrar = () => {
    if (!confirmarCobro) {
      setConfirmarCobro(true);
      armadoEn.current = Date.now();
      if (confirmarTimer.current) clearTimeout(confirmarTimer.current);
      confirmarTimer.current = setTimeout(() => setConfirmarCobro(false), 6000);
      return;
    }
    // Refractario: un DOBLE-TAP accidental (dos toques en <650 ms) atravesaba la
    // confirmación como si fuera un solo gesto — justo el escenario del que la
    // confirmación protege. El segundo toque tiene que ser un gesto SEPARADO.
    if (Date.now() - armadoEn.current < 650) return;
    if (confirmarTimer.current) clearTimeout(confirmarTimer.current);
    setConfirmarCobro(false);
    cobrar(nCuotas <= 1 ? null : montoSeleccion);
    setNCuotas(1);
  };

  const flash = (t: Exclude<Toast, null>, ms = 2800) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  };

  // Aviso money-critical: el registro NO pudo persistirse en el dispositivo
  // (cuota llena / navegación privada). En memoria sirve para reintentar ahora,
  // pero si se cierra la app se pierde → hay que avisar, nunca simular éxito.
  const avisarNoGuardado = () =>
    flash({
      texto: "⚠️ No quedó guardado en este teléfono",
      sub: "Mantené señal o reintentá: aún no está a salvo.",
      tono: "alerta",
    });

  // Reserva el registro por un instante (evita doble-tap) sin bloquear en el GPS.
  const tomarTurno = (): boolean => {
    if (bloqueado.current) return false;
    bloqueado.current = true;
    setOcupado(true);
    setTimeout(() => {
      bloqueado.current = false;
      setOcupado(false);
    }, 700);
    return true;
  };

  // Encola YA (sin esperar el GPS) y adjunta el GPS cuando llega, en segundo
  // plano y dentro de la ventana de hold. Antes se bloqueaba hasta 6 s esperando
  // el GPS frente al cliente; ahora el registro es instantáneo.
  const registrar = (
    tipo: OpTipo,
    extra: { monto: number | null; motivo: string | null; adelanto?: boolean },
  ): { offline: boolean; op: OpCobro; persistido: boolean } => {
    // Asegura que la cola esté particionada bajo ESTE cobrador antes de encolar
    // (el SyncEngine también lo hace; esto blinda contra un tap muy temprano).
    configurarUsuario(cobradorId);
    const op = encolar(
      {
        tipo,
        clienteId,
        prestamoId,
        clienteNombre,
        monto: extra.monto,
        motivo: extra.motivo,
        // ⚠️ SIN esta línea la bandera se perdía acá: `cobrar()` la recibía, pero
        // el objeto que se encola no la llevaba (es opcional en OpCobro, así que
        // TS no chistaba) y el servidor recibía SIEMPRE adelanto=false. El candado
        // rechazaba el cobro confirmado y no había forma de registrarlo nunca.
        adelanto: extra.adelanto ?? false,
        gpsLat: null,
        gpsLng: null,
      },
      { holdMs: HOLD_MS },
    );
    void pedirGps().then((g) => parchearGps(op.id, g.lat, g.lng, g.precision));
    if (tipo === "pago") ultimoMonto.current = extra.monto ?? cuotaEfectiva;
    return {
      offline: typeof navigator !== "undefined" && !navigator.onLine,
      op,
      persistido: op.persistido,
    };
  };

  // `adelanto` viaja al SERVIDOR: es la intención explícita de cobrar por encima de
  // lo que toca hoy. El servidor rechaza el 2º cobro del día sobre el mismo crédito
  // salvo que venga esta bandera — así el candado deja de depender de un `useState`
  // que se evapora al remontar el componente (cambio de crédito, `key={prestamo.id}`).
  const cobrar = (monto: number | null, adelanto = false) => {
    if (!tomarTurno()) return;
    // Dinero SIEMPRE entero. Un abono tipeado se redondea acá; la "cuota completa"
    // manda null y el SERVIDOR resuelve el monto (cuota o saldo) y lo redondea
    // (chokepoint en registrarPago) → nunca entra un float al libro de pagos.
    const m = monto != null && monto > 0 ? Math.round(monto) : null;
    // Cuota completa = la cuota efectiva (topada al saldo, anti sobre-pago). El
    // servidor recalcula y capa contra el saldo real; esto es lo que ve el recibo.
    const montoCobrado = m ?? cuotaEfectiva;
    const esAbono = m != null && m < cuota;
    const { offline, op, persistido } = registrar("pago", { monto: m, motivo: null, adelanto });
    vibrar(18);
    // Snapshot del candado ANTES de este cobro (para que "deshacer" lo RESTAURE,
    // no lo borre: deshacer un adelanto no libera la cuota de hoy ya cobrada).
    const hoyCobradoAntes = hoyCobrado;
    // Bloquea el botón principal por la ventana de hold (evita el doble-cobro por
    // re-tap cuando el celu tarda en refrescar). Se libera solo o al deshacer.
    if (cobroTimer.current) clearTimeout(cobroTimer.current);
    setCobroReciente(true);
    cobroTimer.current = setTimeout(() => setCobroReciente(false), HOLD_MS);
    // Cobro de cuota COMPLETA → la de hoy quedó cubierta (para el botón anti doble-cobro).
    if (!esAbono) setHoyCobrado(true);
    setConfirmarAdelanto(false);
    setAbono(false);
    setMontoAbono("");
    // Comprobante profesional (recibo con trazabilidad), compartible por WhatsApp.
    const { fechaHora, folio } = partesUY();
    const saldoRestante = Math.max(0, Math.round(saldoActual) - montoCobrado);
    // Avance en CUOTAS tras este pago: los pagos se imputan FIFO (a la cuota
    // pendiente más vieja), así que cada cuota completa cubre un día más y
    // descuenta una atrasada. Es el "lleva N de M" del recibo/WhatsApp.
    // Tolerancia sub-peso (+0,5, espejo del cartón): con cuota fraccionaria
    // (351,04) el stepper manda round(351,04×3)=1053 y el floor "seco" contaba
    // 2 cuotas — el recibo le mentía al cliente. Con la tolerancia cuenta 3.
    const cuotasDeEstePago = cuota > 0 ? Math.floor((montoCobrado + 0.5) / cuota) : 0;
    // Crédito SALDADO con este pago → el recibo dice la verdad completa (M de M,
    // 0 atrasadas): el pago final capado al saldo puede ser < 1 cuota y sin esto
    // el recibo mostraba "Saldo $0" junto a "1 atrasada" — combinación imposible.
    const quedaSaldado = saldoRestante <= 0;
    const cubiertasDespues =
      cuotasCubiertas != null && totalCuotas
        ? quedaSaldado
          ? totalCuotas
          : Math.min(totalCuotas, cuotasCubiertas + cuotasDeEstePago)
        : null;
    const atrasadasDespues =
      cuotasAtrasadas != null
        ? quedaSaldado
          ? 0
          : Math.max(0, cuotasAtrasadas - cuotasDeEstePago)
        : null;
    setComprobante({
      folio,
      clienteNombre,
      clienteTelefono,
      cobradorNombre,
      monto: montoCobrado,
      saldoRestante,
      tipo: esAbono ? "abono" : "cuota",
      fechaHora,
      offline,
      cuotasCubiertas: cubiertasDespues,
      totalCuotas,
      cuotasAtrasadas: atrasadasDespues,
      // La advertencia va DENTRO del comprobante (foreground): un toast quedaría
      // TAPADO por este modal y el cobrador daría el cobro por guardado.
      noGuardado: !persistido,
    });
    const hasta = op.holdHasta ?? Date.now() + HOLD_MS;
    setUndo({ opId: op.id, hasta, hoyCobradoAntes });
    // Abono o cobro NO guardado → abrir el comprobante (recibo del parcial / aviso
    // que hay que ver sí o sí). Cuota completa y guardada → SIN modal: toast liviano
    // con Deshacer + Recibo on-demand, durante la ventana de "Deshacer".
    if (esAbono || !persistido) {
      setModalAbierto(true);
    } else {
      flash(
        {
          texto: `Cobrado ${UYU(montoCobrado)}${offline ? " (offline)" : ""}`,
          sub: `Saldo ${UYU(saldoRestante)}`,
          tono: "ok",
          acciones: { deshacer: deshacerCobro, recibo: () => { setToast(null); setModalAbierto(true); } },
        },
        HOLD_MS,
      );
    }
  };

  const noPago = (m: MotivoNoPago) => {
    if (!tomarTurno()) return;
    const { offline, op, persistido } = registrar("no_pago", { monto: null, motivo: m });
    vibrar(12);
    setMotivos(false);
    if (!persistido) {
      avisarNoGuardado();
    } else {
      // Igual que el cobro: la visita queda retenida el hold (9s) → se puede DESHACER
      // un mis-tap de motivo/cliente antes de que llegue al libro (contamina el score
      // de campo / bitácora). Simetría con el cobro, sin fricción real.
      const hasta = op.holdHasta ?? Date.now() + HOLD_MS;
      flash(
        {
          texto: `No pago registrado${offline ? " (offline)" : ""}`,
          tono: "info",
          acciones: { deshacer: () => deshacerVisita(op.id, hasta) },
        },
        HOLD_MS,
      );
    }
  };

  // Deshacer una VISITA (no_pago): saca la op de la cola dentro del hold, igual que
  // deshacerCobro pero sin comprobante/modal. Fuera de la ventana ya no se puede.
  const deshacerVisita = (opId: string, hasta: number) => {
    if (Date.now() >= hasta || !pendientes().some((o) => o.id === opId)) {
      flash({ texto: "El registro ya se sincronizó", tono: "info" });
      return;
    }
    quitar(opId);
    vibrar(30);
    flash({ texto: "No pago deshecho", tono: "info" });
  };

  // Deshacer: saca la op de la cola ANTES de que sincronice (nunca llegó al
  // libro de pagos). Solo disponible dentro de la ventana de hold.
  const deshacerCobro = () => {
    if (!undo) return;
    // La ventana de "Deshacer" ES la de hold: el flush no envía la op antes de
    // `holdHasta` (useSync filtra por holdHasta<=ahora). Si la ventana ya venció, o la
    // op ya no está en la cola, el flush pudo haberla capturado y estar insertándola
    // en el libro → NO afirmar "deshecho" (sería un mensaje falso con el pago ya hecho).
    if (Date.now() >= undo.hasta || !pendientes().some((o) => o.id === undo.opId)) {
      setUndo(null);
      setModalAbierto(false);
      setComprobante(null);
      // Acá terminaba TODO: "El cobro ya se registró" y el cobrador quedaba sin
      // ninguna acción posible (los pagos no se editan, y la app del cobrador no
      // tiene anulación ni forma de pedirla). Con un dedazo de 10× eso son miles
      // de pesos mal cargados y nadie enterado. Ahora se ofrece la salida.
      setCobroTarde(true);
      flash({ texto: "El cobro ya se registró", tono: "info" }, 4000);
      return;
    }
    quitar(undo.opId);
    vibrar(30);
    if (cobroTimer.current) clearTimeout(cobroTimer.current);
    setCobroReciente(false); // deshecho: se puede volver a cobrar ya
    // RESTAURAR (no borrar) el candado del día: si lo deshecho era un ADELANTO,
    // la cuota de hoy sigue cobrada — soltar el candado acá reabría el CTA verde
    // idéntico y un re-tap la cobraba de nuevo (doble-cobro).
    setHoyCobrado(undo.hoyCobradoAntes);
    setConfirmarAdelanto(false);
    setConfirmarCobro(false);
    setUndo(null);
    setModalAbierto(false);
    setComprobante(null);
    flash({ texto: "Cobro deshecho", tono: "info" });
  };

  const montoAbonoNum = Number(montoAbono);
  // Un abono NO puede superar el saldo del crédito: un dedazo ($50.000 a quien debe
  // $500) metería un sobre-pago en el libro inmutable, que después hay que anular a
  // mano. Se bloquea (los pagos no se editan; mejor prevenir).
  const excedeSaldo = montoAbonoNum > saldoActual;
  const abonoValido = Number.isFinite(montoAbonoNum) && montoAbonoNum > 0 && !excedeSaldo;

  return (
    <div className="flex flex-col gap-2.5">
      {!tieneGps && (
        <p className="text-[11.5px] font-medium text-[#8A93AD]">
          Este cliente no tiene ubicación guardada — al censarlo cerca de su casa queda registrada.
        </p>
      )}

      {hoyCobrado && !cobroReciente && !saldado && !ocupado ? (
        // La cuota de hoy YA se cobró: el botón deja de ser el CTA verde idéntico.
        // Requiere una confirmación extra para "adelantar" otra cuota (anti doble-cobro).
        <button
          type="button"
          onClick={() => (confirmarAdelanto ? cobrar(null, true) : setConfirmarAdelanto(true))}
          className={`rounded-full px-5 py-3.5 text-[14px] font-extrabold active:scale-[0.98] ${
            confirmarAdelanto
              ? "bg-[#1FA971] text-white shadow-[0_8px_20px_rgba(31,169,113,0.35)]"
              : "border border-[#BFE6D2] bg-[#F1FBF6] text-[#157A50]"
          }`}
          style={{ transition: "transform .1s" }}
        >
          {confirmarAdelanto ? `Sí, adelantar otra cuota · ${UYU(cuotaEfectiva)}` : "✓ Cuota de hoy cobrada · adelantar próxima"}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          {/* ± de cuotas: atrasados o adelantos de N cuotas en UN registro, sin
              tipear. El monto exacto distinto de la cuota va por "Otro monto". */}
          {!saldado && maxCuotas > 1 && (
            <div className="flex items-center justify-between rounded-[14px] border border-[#E4E8F4] bg-white px-2 py-1.5">
              <button
                type="button"
                disabled={ocupado || cobroReciente || nCuotas <= 1}
                onClick={() => setNCuotas((n) => Math.max(1, n - 1))}
                aria-label="Una cuota menos"
                className="flex h-11 w-11 items-center justify-center rounded-[11px] bg-[#EEF1F8] text-[20px] font-black text-tinta active:scale-95 disabled:opacity-30"
              >
                −
              </button>
              <div className="flex flex-col items-center leading-tight">
                <span className="text-[14px] font-extrabold text-tinta tabular-nums">
                  {nCuotas} cuota{nCuotas === 1 ? "" : "s"} · {UYU(montoSeleccion)}
                </span>
                <span className="text-[10.5px] font-medium text-[#8A93AD]">
                  {nCuotas === 1
                    ? "Tocá + si paga varias cuotas juntas"
                    : "Se adelantan / cubren en orden, desde la más vieja"}
                </span>
              </div>
              <button
                type="button"
                disabled={ocupado || cobroReciente || nCuotas >= maxCuotas}
                onClick={() => setNCuotas((n) => Math.min(maxCuotas, n + 1))}
                aria-label="Una cuota más"
                className="flex h-11 w-11 items-center justify-center rounded-[11px] bg-[#EEF1F8] text-[20px] font-black text-tinta active:scale-95 disabled:opacity-30"
              >
                +
              </button>
            </div>
          )}
          {/* Aviso ANTES de confirmar: este toque no cobra una cuota, cancela el
              crédito. Se pregunta por la plata en la mano, que es lo único que
              importa y lo que distingue un pago total de un dedazo. */}
          {cancelaCredito && !cobroReciente && (
            <p className="rounded-[12px] bg-[#FDF3E2] px-3.5 py-2.5 text-[12.5px] leading-[1.45] font-bold text-[#8A6D1E]">
              ⚠️ Esto <b>cancela el crédito entero</b>, no cobra una cuota.
              <br />
              ¿El cliente te entregó los {UYU(montoSeleccion)} en la mano? Si te
              pasaste con el <b>+</b>, bajalo antes de confirmar.
            </p>
          )}
          <button
            type="button"
            disabled={ocupado || saldado || cobroReciente}
            onClick={tocarCobrar}
            className={`rounded-full px-5 py-3.5 text-[15px] font-extrabold text-white active:scale-[0.98] disabled:opacity-60 ${
              confirmarCobro
                ? cancelaCredito
                  ? "bg-[#C0392B] shadow-[0_8px_20px_rgba(192,57,43,0.35)]"
                  : "bg-[#13308C] shadow-[0_8px_20px_rgba(19,48,140,0.35)]"
                : "bg-[#1FA971] shadow-[0_8px_20px_rgba(31,169,113,0.35)]"
            }`}
            style={{ transition: "transform .1s" }}
          >
            {saldado
              ? "Crédito saldado ✓"
              : cobroReciente
                ? "Cobro registrado ✓"
                : ocupado
                  ? "Registrando…"
                  : confirmarCobro
                    ? cancelaCredito
                      ? `Sí, CANCELAR el crédito · ${UYU(montoSeleccion)}`
                      : `Sí, cobrar ${UYU(montoSeleccion)} ✓`
                    : `Registrar pago · ${UYU(montoSeleccion)}${nCuotas > 1 ? ` (${nCuotas} cuotas)` : ""}`}
          </button>
          {confirmarCobro && !cobroReciente && !ocupado && (
            <p className="text-center text-[11px] font-medium text-[#8A93AD]">
              Tocá de nuevo para confirmar — o esperá y no se registra nada.
            </p>
          )}
        </div>
      )}

      {/* Quiso deshacer y la ventana ya había pasado. Antes el mensaje terminaba
          ahí; ahora se le da la salida real: dejar el aviso escrito en la ficha
          del cliente, que el supervisor y la oficina ven. */}
      {cobroTarde && (
        <div className="flex flex-col gap-2 rounded-[14px] border border-[#F5C6C2] bg-[#FDF1F0] p-3">
          <span className="text-[12.5px] leading-[1.45] font-bold text-[#C0392B]">
            Ese cobro ya quedó registrado y no se puede borrar desde acá.
          </span>
          <span className="text-[11.5px] leading-[1.45] font-medium text-gris">
            Si el monto está mal, avisá ahora: la oficina lo corrige y queda constancia de que
            fuiste vos quien lo reportó.
          </span>
          <PedirAyuda
            clienteId={clienteId}
            etiqueta="Está mal · avisar a la oficina"
            tono="alerta"
            textoSugerido={`Registré un cobro con el monto equivocado${
              ultimoMonto.current ? ` (quedó ${UYU(ultimoMonto.current)})` : ""
            }. El monto correcto es $____. Por favor corregirlo.`}
          />
        </div>
      )}

      <div className="flex gap-2.5">
        {/* Botón que CAMBIA de estado al abrirse (antes quedaba gris y no se
            entendía que había desplegado el panel de abono). */}
        <button
          type="button"
          disabled={ocupado || cobroReciente}
          onClick={() => {
            setAbono((v) => !v);
            setMotivos(false);
          }}
          className={`flex-1 min-h-11 rounded-full border px-4 py-3 text-[13px] font-bold transition-transform active:scale-[0.98] disabled:opacity-60 ${
            abono
              ? "border-[#E8A317] bg-[#FDF3E2] text-[#B9770E]"
              : "border-[#DCE3F4] bg-white text-[#6B7494]"
          }`}
        >
          Otro monto {abono ? "▴" : "▾"}
        </button>
        <button
          type="button"
          disabled={ocupado || cobroReciente}
          onClick={() => {
            setMotivos((v) => !v);
            setAbono(false);
          }}
          className={`flex-1 min-h-11 rounded-full border px-4 py-3 text-[13px] font-bold transition-transform active:scale-[0.98] disabled:opacity-60 ${
            motivos
              ? "border-[#D64545] bg-[#FBE4E2] text-[#C0392B]"
              : "border-[#DCE3F4] bg-white text-[#6B7494]"
          }`}
        >
          No pago {motivos ? "▴" : "▾"}
        </button>
      </div>

      {abono && (
        <div className="flex flex-col gap-2.5 rounded-[16px] border border-[#F0D9A8] bg-[#FDF9F0] p-3.5">
          <div className="flex flex-col gap-0.5">
            {/* Se llamaba "Abono parcial" y decía "paga menos que la cuota": el
                cobrador que tenía enfrente a alguien pagando de MÁS no abría este
                panel, aunque es el único lugar para tipear un monto libre. */}
            <span className="text-[13.5px] font-extrabold text-[#B9770E]">Otro monto</span>
            <span className="text-[11.5px] leading-[1.5] font-medium text-gris">
              El cliente paga un monto <b>distinto</b> a la cuota de {UYU(cuota)}. Si paga menos, el día
              queda <b>pendiente</b>; si paga más, se <b>adelantan cuotas</b>.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-bold text-tinta">$</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={montoAbono}
              onChange={(e) => setMontoAbono(e.target.value)}
              placeholder="¿Cuánto abona?"
              autoFocus
              className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-[#E7D4A6] bg-white px-3 py-3 text-[16px] font-semibold outline-none focus:border-[#E8A317]"
            />
            <button
              type="button"
              disabled={ocupado || cobroReciente || !abonoValido}
              onClick={() => cobrar(montoAbonoNum)}
              className="min-h-11 rounded-full bg-[#1FA971] px-4 py-3 text-[13px] font-extrabold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
            >
              {ocupado ? "…" : "Registrar abono"}
            </button>
          </div>
          {/* Aviso: el abono no puede superar el saldo del crédito (anti sobre-pago). */}
          {excedeSaldo && (
            <span className="text-[11.5px] font-bold text-[#C0392B] tabular-nums">
              Es más que el saldo del crédito ({UYU(saldoActual)}). Cobrá como máximo eso.
            </span>
          )}
          {/* Pista en vivo: cuánto le queda faltando, o si ya cubre la cuota. */}
          {abonoValido && montoAbonoNum < cuota && (
            <span className="text-[11.5px] font-semibold text-[#B9770E] tabular-nums">
              Le quedará faltando {UYU(cuota - montoAbonoNum)} de la cuota de hoy.
            </span>
          )}
          {/* Verde SOLO para montos cercanos a una cuota. Un dedazo de 10× (500
              tipeado como 5.000) pasaba la única validación que había —no superar
              el saldo— y encima recibía este mensaje tranquilizador: el cobrador
              veía verde y confirmaba. Desde 2 cuotas se avisa en ámbar con el
              número de cuotas, que es la forma en que el cobrador piensa. */}
          {abonoValido && montoAbonoNum >= cuota && montoAbonoNum < cuota * 2 && (
            <span className="text-[11.5px] font-semibold text-[#157A50] tabular-nums">
              Eso cubre la cuota completa — se registra como pago del día ✓.
            </span>
          )}
          {abonoValido && cuota > 0 && montoAbonoNum >= cuota * 2 &&
            montoAbonoNum < saldoRedondeado - 0.5 && (
              <span className="text-[11.5px] leading-[1.45] font-bold text-[#B9770E] tabular-nums">
                ⚠️ Son {Math.floor(montoAbonoNum / cuota)} cuotas de {UYU(cuota)}. Revisá el monto
                antes de confirmar.
              </span>
            )}
          {/* El monto tipeado alcanza para CANCELAR el crédito. Es el mismo aviso
              que el del ±: el día 1 tres de los seis casos entraron por acá. */}
          {abonoValido && cuota > 0 && montoAbonoNum >= saldoRedondeado - 0.5 &&
            montoAbonoNum > cuotaEfectiva * 2 && (
              <span className="rounded-[10px] bg-[#FDF3E2] px-3 py-2 text-[11.5px] leading-[1.45] font-bold text-[#8A6D1E] tabular-nums">
                ⚠️ Con eso <b>cancelás el crédito entero</b> ({UYU(saldoRedondeado)}), no cobrás
                una cuota. ¿El cliente te entregó esa plata en la mano?
              </span>
            )}
        </div>
      )}

      {motivos && (
        <div className="grid grid-cols-2 gap-2 rounded-[16px] bg-white p-3 shadow-[0_1px_3px_rgba(26,34,71,0.06)]">
          {MOTIVOS_NOPAGO.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={ocupado || cobroReciente}
              onClick={() => noPago(m.id)}
              className="flex min-h-11 items-center gap-2 rounded-[11px] bg-[#F4F6FB] px-3 py-3 text-[13px] font-semibold text-tinta active:scale-95 disabled:opacity-60"
              style={{ transition: "transform .1s" }}
            >
              <span>{m.emoji}</span>
              {m.label}
            </button>
          ))}
        </div>
      )}

      {comprobante && modalAbierto && (
        <Comprobante
          datos={comprobante}
          onCerrar={() => {
            setModalAbierto(false);
            setComprobante(null);
            setUndo(null);
          }}
          deshacer={undo ? { hasta: undo.hasta, onDeshacer: deshacerCobro } : undefined}
        />
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center px-4" role="status">
          <div
            className="flex max-w-[calc(100vw-2rem)] items-center gap-2.5 rounded-full px-4 py-2.5 text-white shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
            style={{
              background:
                toast.tono === "ok" ? "#157A50" : toast.tono === "alerta" ? "#C0392B" : "#13308C",
            }}
          >
            <span className="shrink-0 text-[15px]">{toast.tono === "alerta" ? "⚠️" : "✓"}</span>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[13px] font-bold">{toast.texto}</span>
              {toast.sub && (
                <span className="truncate text-[11px] font-medium text-white/70">{toast.sub}</span>
              )}
            </div>
            {toast.acciones && (
              <div className="ml-1.5 flex shrink-0 items-center gap-1.5">
                {toast.acciones.recibo && (
                  <button
                    type="button"
                    onClick={toast.acciones.recibo}
                    className="flex min-h-11 items-center rounded-full bg-white/20 px-3 py-2 text-[12.5px] font-bold active:scale-95"
                  >
                    Recibo
                  </button>
                )}
                {toast.acciones.deshacer && (
                  <button
                    type="button"
                    onClick={toast.acciones.deshacer}
                    className="flex min-h-11 items-center rounded-full bg-white/20 px-3 py-2 text-[12.5px] font-bold active:scale-95"
                  >
                    Deshacer
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
