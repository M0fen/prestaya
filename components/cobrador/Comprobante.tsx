"use client";
// Comprobante de pago (recibo digital) que aparece al registrar un cobro.
// Es la pieza que dan por sentada los apps de cobro diario ("recibo en 3 toques
// con trazabilidad"): confirma al cliente y al cobrador qué se pagó, cuándo y a
// quién. Se puede COMPARTIR por WhatsApp / compartir nativo. Derivado del pago,
// no toca la base. Funciona offline (se marca "se sincroniza al recuperar señal").
import { UYU } from "@/lib/format";

export type DatosComprobante = {
  folio: string;
  clienteNombre: string;
  clienteTelefono: string | null;
  cobradorNombre: string;
  monto: number;
  saldoRestante: number;
  tipo: "cuota" | "abono";
  fechaHora: string;
  offline: boolean;
};

// Deja solo dígitos y arma un teléfono uruguayo válido para wa.me (prefijo 598).
function telWhatsApp(tel: string | null): string {
  const d = (tel ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("598")) return d;
  return "598" + d.replace(/^0+/, "");
}

function textoComprobante(c: DatosComprobante): string {
  return [
    "🧾 *Comprobante de pago — Presta Ya*",
    "",
    `Cliente: ${c.clienteNombre}`,
    `Monto: ${UYU(c.monto)}${c.tipo === "abono" ? " (abono parcial)" : ""}`,
    `Saldo restante: ${UYU(c.saldoRestante)}`,
    `Fecha: ${c.fechaHora}`,
    `Cobrador: ${c.cobradorNombre}`,
    `Comprobante: ${c.folio}`,
    "",
    "¡Gracias por tu pago! 💙",
  ].join("\n");
}

export function Comprobante({
  datos,
  onCerrar,
}: {
  datos: DatosComprobante;
  onCerrar: () => void;
}) {
  const compartir = async () => {
    const texto = textoComprobante(datos);
    // 1) Compartir nativo (elige WhatsApp, etc.) si el dispositivo lo soporta.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Comprobante de pago", text: texto });
        return;
      } catch {
        /* si cancela, seguimos al fallback */
      }
    }
    // 2) Fallback: abrir WhatsApp con el mensaje (al cliente si hay teléfono).
    const tel = telWhatsApp(datos.clienteTelefono);
    const url = `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank");
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-[#0F1B3D]/50 p-3 sm:items-center"
      onClick={onCerrar}
    >
      <div
        className="w-full max-w-[380px] overflow-hidden rounded-[20px] bg-white shadow-[0_24px_60px_rgba(19,48,140,0.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="flex items-center gap-3 bg-[linear-gradient(150deg,#2453DC,#13308C)] px-5 py-4 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-white/15 text-[20px] font-black">
            P
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-extrabold">Comprobante de pago</span>
            <span className="text-[11.5px] font-medium text-white/70">Presta Ya</span>
          </div>
          <span className="ml-auto rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold tracking-wide uppercase">
            ✓ Registrado
          </span>
        </div>

        {/* Monto grande */}
        <div className="flex flex-col items-center gap-1 px-5 pt-5 pb-3">
          <span className="text-[11px] font-semibold tracking-wide text-gris uppercase">
            {datos.tipo === "abono" ? "Abono parcial" : "Cuota pagada"}
          </span>
          <span className="text-[34px] font-black text-[#1FA971] tabular-nums">
            {UYU(datos.monto)}
          </span>
        </div>

        {/* Detalle */}
        <div className="mx-5 border-t border-dashed border-[#DCE3F4]" />
        <dl className="flex flex-col gap-2.5 px-5 py-4 text-[13px]">
          <Fila k="Cliente" v={datos.clienteNombre} />
          <Fila k="Saldo restante" v={UYU(datos.saldoRestante)} />
          <Fila k="Fecha y hora" v={datos.fechaHora} />
          <Fila k="Cobrador" v={datos.cobradorNombre} />
          <Fila k="Comprobante" v={datos.folio} mono />
        </dl>

        {datos.offline && (
          <p className="mx-5 mb-3 rounded-[10px] bg-[#FFF7E6] px-3 py-2 text-[11.5px] font-medium text-[#9A6B00]">
            Guardado sin conexión: se sincroniza al recuperar señal.
          </p>
        )}

        {/* Acciones */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={compartir}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#1FA971] px-4 py-3 text-[14px] font-extrabold text-white active:scale-[0.98]"
          >
            <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="currentColor" aria-hidden="true">
              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.16c-.24.68-1.42 1.32-1.95 1.36-.52.05-.99.24-3.35-.7-2.83-1.12-4.63-4.02-4.77-4.21-.14-.19-1.14-1.52-1.14-2.9 0-1.38.72-2.06.98-2.34.24-.26.53-.33.71-.33.18 0 .35 0 .5.01.16.01.38-.06.59.45.24.56.79 1.94.86 2.08.07.14.12.3.02.49-.09.19-.14.3-.28.47-.14.16-.29.36-.42.48-.14.14-.28.29-.12.57.16.28.72 1.19 1.55 1.93 1.06.95 1.96 1.24 2.24 1.38.28.14.44.12.6-.07.19-.21.7-.81.88-1.09.19-.28.37-.23.62-.14.26.09 1.62.77 1.9.91.28.14.46.21.53.32.07.12.07.66-.17 1.34Z" />
            </svg>
            Compartir
          </button>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-full border border-[#DCE3F4] bg-white px-5 py-3 text-[14px] font-bold text-gris active:scale-[0.98]"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}

function Fila({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex-shrink-0 text-[12px] font-medium text-gris">{k}</dt>
      <dd
        className={`text-right font-semibold text-tinta ${mono ? "font-mono text-[12px]" : "text-[13px]"}`}
      >
        {v}
      </dd>
    </div>
  );
}
