"use client";
// Registro de cobro del cobrador — OFFLINE-FIRST. Captura GPS + hora real y
// encola la operación; el SyncEngine (en el layout) la sincroniza cuando hay
// señal. Nunca "no anduvo": registra siempre, con o sin conexión.
import { useRef, useState } from "react";
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
  const [undo, setUndo] = useState<{ opId: string; hasta: number } | null>(null);
  // Tras un cobro, el botón principal queda en "Cobro registrado ✓" durante el hold:
  // el cobrador ve el efecto y no re-toca por falta de feedback (un 2º toque encolaría
  // OTRA cuota con otro op_id → doble cobro). Se libera al vencer el hold o al deshacer.
  const [cobroReciente, setCobroReciente] = useState(false);
  const cobroTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Anti-doble-registro: un segundo toque instantáneo no encola otro cobro.
  const bloqueado = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Saldo del crédito ANTES de este cobro, redondeado. La "cuota efectiva" nunca
  // supera el saldo: en un crédito casi saldado NO se ofrece cobrar la cuota entera
  // (sería sobre-pago). El servidor igual capa —esta es la señal para el cobrador—.
  const saldoRedondeado = Math.max(0, Math.round(saldoActual));
  const cuotaEfectiva = Math.min(cuota, saldoRedondeado);
  const saldado = saldoRedondeado <= 0;

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
    extra: { monto: number | null; motivo: string | null },
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
        gpsLat: null,
        gpsLng: null,
      },
      { holdMs: HOLD_MS },
    );
    void pedirGps().then((g) => parchearGps(op.id, g.lat, g.lng, g.precision));
    return {
      offline: typeof navigator !== "undefined" && !navigator.onLine,
      op,
      persistido: op.persistido,
    };
  };

  const cobrar = (monto: number | null) => {
    if (!tomarTurno()) return;
    // Dinero SIEMPRE entero. Un abono tipeado se redondea acá; la "cuota completa"
    // manda null y el SERVIDOR resuelve el monto (cuota o saldo) y lo redondea
    // (chokepoint en registrarPago) → nunca entra un float al libro de pagos.
    const m = monto != null && monto > 0 ? Math.round(monto) : null;
    // Cuota completa = la cuota efectiva (topada al saldo, anti sobre-pago). El
    // servidor recalcula y capa contra el saldo real; esto es lo que ve el recibo.
    const montoCobrado = m ?? cuotaEfectiva;
    const esAbono = m != null && m < cuota;
    const { offline, op, persistido } = registrar("pago", { monto: m, motivo: null });
    vibrar(18);
    // Bloquea el botón principal por la ventana de hold (evita el doble-cobro por
    // re-tap cuando el celu tarda en refrescar). Se libera solo o al deshacer.
    if (cobroTimer.current) clearTimeout(cobroTimer.current);
    setCobroReciente(true);
    cobroTimer.current = setTimeout(() => setCobroReciente(false), HOLD_MS);
    setAbono(false);
    setMontoAbono("");
    // Comprobante profesional (recibo con trazabilidad), compartible por WhatsApp.
    const { fechaHora, folio } = partesUY();
    const saldoRestante = Math.max(0, Math.round(saldoActual) - montoCobrado);
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
      // La advertencia va DENTRO del comprobante (foreground): un toast quedaría
      // TAPADO por este modal y el cobrador daría el cobro por guardado.
      noGuardado: !persistido,
    });
    const hasta = op.holdHasta ?? Date.now() + HOLD_MS;
    setUndo({ opId: op.id, hasta });
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
      flash({ texto: "El cobro ya se registró", tono: "info" });
      return;
    }
    quitar(undo.opId);
    vibrar(30);
    if (cobroTimer.current) clearTimeout(cobroTimer.current);
    setCobroReciente(false); // deshecho: se puede volver a cobrar ya
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
          Sin ubicación guardada del cliente: no se podrá validar la geo-cerca.
        </p>
      )}

      <button
        type="button"
        disabled={ocupado || saldado || cobroReciente}
        onClick={() => cobrar(null)}
        className="rounded-full bg-[#1FA971] px-5 py-3.5 text-[15px] font-extrabold text-white shadow-[0_8px_20px_rgba(31,169,113,0.35)] active:scale-[0.98] disabled:opacity-60"
        style={{ transition: "transform .1s" }}
      >
        {saldado
          ? "Crédito saldado ✓"
          : cobroReciente
            ? "Cobro registrado ✓"
            : ocupado
              ? "Registrando…"
              : `Registrar pago · ${UYU(cuotaEfectiva)}`}
      </button>

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
          Abono parcial {abono ? "▴" : "▾"}
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
            <span className="text-[13.5px] font-extrabold text-[#B9770E]">Abono parcial</span>
            <span className="text-[11.5px] leading-[1.5] font-medium text-gris">
              El cliente paga <b>menos que la cuota</b> de {UYU(cuota)}. El día queda <b>pendiente</b> hasta
              que la complete.
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
          {abonoValido && montoAbonoNum >= cuota && (
            <span className="text-[11.5px] font-semibold text-[#157A50] tabular-nums">
              Eso cubre la cuota completa — se registra como pago del día ✓.
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
            className="flex items-center gap-2.5 rounded-full px-4 py-2.5 text-white shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
            style={{
              background:
                toast.tono === "ok" ? "#157A50" : toast.tono === "alerta" ? "#C0392B" : "#13308C",
            }}
          >
            <span className="text-[15px]">{toast.tono === "alerta" ? "⚠️" : "✓"}</span>
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-bold">{toast.texto}</span>
              {toast.sub && (
                <span className="text-[11px] font-medium text-white/70">{toast.sub}</span>
              )}
            </div>
            {toast.acciones && (
              <div className="ml-1.5 flex items-center gap-1.5">
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
