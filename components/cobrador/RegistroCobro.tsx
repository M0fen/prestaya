"use client";
// Registro de cobro del cobrador — OFFLINE-FIRST. Captura GPS + hora real y
// encola la operación; el SyncEngine (en el layout) la sincroniza cuando hay
// señal. Nunca "no anduvo": registra siempre, con o sin conexión.
import { useState } from "react";
import { encolar, type OpTipo } from "@/lib/cobrador/colaOffline";
import { MOTIVOS_NOPAGO, type MotivoNoPago } from "@/app/cobrador/(app)/actions";
import { UYU } from "@/lib/format";
import { Comprobante, type DatosComprobante } from "@/components/cobrador/Comprobante";

type Toast = { texto: string; sub?: string; tono: "ok" | "info" } | null;

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

function pedirGps(): Promise<{ lat: number | null; lng: number | null }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return resolve({ lat: null, lng: null });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 },
    );
  });
}

export function RegistroCobro({
  clienteId,
  clienteNombre,
  clienteTelefono = null,
  cobradorNombre,
  cuota,
  saldoActual,
  tieneGps,
}: {
  clienteId: string;
  clienteNombre: string;
  clienteTelefono?: string | null;
  cobradorNombre: string;
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

  const flash = (t: Exclude<Toast, null>) => {
    setToast(t);
    setTimeout(() => setToast(null), 2800);
  };

  const registrar = async (
    tipo: OpTipo,
    extra: { monto: number | null; motivo: string | null },
  ): Promise<boolean> => {
    setOcupado(true);
    const gps = await pedirGps();
    encolar({
      tipo,
      clienteId,
      clienteNombre,
      monto: extra.monto,
      motivo: extra.motivo,
      gpsLat: gps.lat,
      gpsLng: gps.lng,
    });
    setOcupado(false);
    return typeof navigator !== "undefined" && !navigator.onLine;
  };

  const cobrar = async (monto: number | null) => {
    const montoCobrado = monto && monto > 0 ? Math.round(monto) : cuota;
    const offline = await registrar("pago", { monto, motivo: null });
    setAbono(false);
    setMontoAbono("");
    // Comprobante profesional (recibo con trazabilidad), compartible por WhatsApp.
    const { fechaHora, folio } = partesUY();
    setComprobante({
      folio,
      clienteNombre,
      clienteTelefono,
      cobradorNombre,
      monto: montoCobrado,
      saldoRestante: Math.max(0, Math.round(saldoActual) - montoCobrado),
      tipo: monto && monto > 0 && monto < cuota ? "abono" : "cuota",
      fechaHora,
      offline,
    });
  };

  const noPago = async (m: MotivoNoPago) => {
    const offline = await registrar("no_pago", { monto: null, motivo: m });
    setMotivos(false);
    flash({
      texto: `No pago registrado${offline ? " (offline)" : ""}`,
      tono: "info",
    });
  };

  const montoAbonoNum = Number(montoAbono);
  const abonoValido = Number.isFinite(montoAbonoNum) && montoAbonoNum > 0;

  return (
    <div className="flex flex-col gap-2.5">
      {!tieneGps && (
        <p className="text-[11.5px] font-medium text-[#8A93AD]">
          Sin ubicación guardada del cliente: no se podrá validar la geo-cerca.
        </p>
      )}

      <button
        type="button"
        disabled={ocupado}
        onClick={() => cobrar(null)}
        className="rounded-full bg-[#1FA971] px-5 py-3.5 text-[15px] font-extrabold text-white shadow-[0_8px_20px_rgba(31,169,113,0.35)] active:scale-[0.98] disabled:opacity-60"
        style={{ transition: "transform .1s" }}
      >
        {ocupado ? "Registrando…" : `Registrar pago · ${UYU(cuota)}`}
      </button>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={ocupado}
          onClick={() => {
            setAbono((v) => !v);
            setMotivos(false);
          }}
          className="flex-1 rounded-full border border-[#DCE3F4] bg-white px-4 py-2.5 text-[13px] font-bold text-[#6B7494] disabled:opacity-60"
        >
          Abono parcial
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => {
            setMotivos((v) => !v);
            setAbono(false);
          }}
          className="flex-1 rounded-full border border-[#DCE3F4] bg-white px-4 py-2.5 text-[13px] font-bold text-[#6B7494] disabled:opacity-60"
        >
          No pago
        </button>
      </div>

      {abono && (
        <div className="flex items-center gap-2 rounded-[14px] bg-white p-3 shadow-[0_1px_3px_rgba(26,34,71,0.06)]">
          <span className="text-[15px] font-bold text-tinta">$</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={montoAbono}
            onChange={(e) => setMontoAbono(e.target.value)}
            placeholder="Monto del abono"
            className="min-w-0 flex-1 rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[14px] outline-none focus:border-azul"
          />
          <button
            type="button"
            disabled={ocupado || !abonoValido}
            onClick={() => cobrar(montoAbonoNum)}
            className="rounded-full bg-[#1FA971] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40"
          >
            Registrar
          </button>
        </div>
      )}

      {motivos && (
        <div className="grid grid-cols-2 gap-2 rounded-[16px] bg-white p-3 shadow-[0_1px_3px_rgba(26,34,71,0.06)]">
          {MOTIVOS_NOPAGO.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={ocupado}
              onClick={() => noPago(m.id)}
              className="flex items-center gap-2 rounded-[11px] bg-[#F4F6FB] px-3 py-2.5 text-[13px] font-semibold text-tinta active:scale-95 disabled:opacity-60"
              style={{ transition: "transform .1s" }}
            >
              <span>{m.emoji}</span>
              {m.label}
            </button>
          ))}
        </div>
      )}

      {comprobante && (
        <Comprobante datos={comprobante} onCerrar={() => setComprobante(null)} />
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center px-4" role="status">
          <div
            className="flex items-center gap-2.5 rounded-full px-4 py-2.5 text-white shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
            style={{ background: toast.tono === "ok" ? "#157A50" : "#13308C" }}
          >
            <span className="text-[15px]">✓</span>
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-bold">{toast.texto}</span>
              {toast.sub && (
                <span className="text-[11px] font-medium text-white/70">{toast.sub}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
