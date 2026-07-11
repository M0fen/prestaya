"use client";
// "Prometió pagar" — el cobrador deja registrado un compromiso del cliente en la
// calle. Alimenta el mini-CRM auto-verificado (el supervisor lo ve en Mi jornada).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { registrarCompromiso } from "@/lib/acciones/compromisos";

/** "YYYY-MM-DD" de mañana en Uruguay (default sensato para el compromiso). */
function mananaUY(): string {
  const m = new Date(Date.now() + 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(m);
}
function hoyUYStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(new Date());
}

export function RegistrarCompromiso({
  clienteId,
  prestamoId,
  cuota,
}: {
  clienteId: string;
  prestamoId: string;
  cuota: number;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(mananaUY());
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pendiente, startTransition] = useTransition();

  const enviar = () => {
    setError(null);
    setOk(false);
    const m = Math.round(Number(monto) || 0) || Math.round(cuota);
    if (m <= 0) {
      setError("Poné un monto.");
      return;
    }
    startTransition(async () => {
      const r = await registrarCompromiso({ clienteId, prestamoId, monto: m, fecha });
      if (!r.ok) setError(r.error);
      else {
        setOk(true);
        setMonto("");
        router.refresh();
        setTimeout(() => setAbierto(false), 1400);
      }
    });
  };

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => {
          setAbierto(true);
          setOk(false);
          setError(null);
        }}
        className="rounded-[14px] border border-[#DCE3F4] bg-white px-4 py-3 text-[13.5px] font-bold text-[#7A4DD6] active:scale-[0.99]"
      >
        🤝 Prometió pagar
      </button>
    );
  }

  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-[#E4DDF6] bg-[#FAF8FF] p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13.5px] font-extrabold text-[#5B3FA8]">Compromiso de pago</span>
        <button type="button" onClick={() => setAbierto(false)} className="text-[12px] font-bold text-gris hover:underline">
          Cerrar
        </button>
      </div>
      {ok ? (
        <span className="py-1 text-[13px] font-bold text-[#157A50]">✓ Compromiso registrado. Lo verá tu supervisor.</span>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-[#8A7BB5]">Monto</span>
              <div className="flex items-center gap-1 rounded-[11px] border border-[#DCD2F0] bg-white px-3 py-2">
                <span className="text-[14px] font-bold text-gris">$</span>
                <input
                  inputMode="numeric"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder={String(Math.round(cuota))}
                  className="w-20 text-[15px] tabular-nums outline-none"
                  aria-label="Monto del compromiso"
                />
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-[#8A7BB5]">Para cuándo</span>
              <input
                type="date"
                value={fecha}
                min={hoyUYStr()}
                onChange={(e) => setFecha(e.target.value)}
                className="rounded-[11px] border border-[#DCD2F0] bg-white px-3 py-2 text-[13.5px] text-tinta outline-none"
              />
            </label>
            <button
              type="button"
              disabled={pendiente}
              onClick={enviar}
              className="rounded-[11px] bg-[#7A4DD6] px-4 py-2.5 text-[13.5px] font-bold text-white disabled:opacity-40"
            >
              {pendiente ? "…" : "Guardar"}
            </button>
          </div>
          <p className="text-[10.5px] font-medium text-[#8A7BB5]">
            Se verifica solo contra los pagos: si cumple, queda saldado; si no, aparece como incumplido. Vacío = {UYU(cuota)}.
          </p>
          {error && <span className="text-[11.5px] font-bold text-[#C0392B]">{error}</span>}
        </>
      )}
    </section>
  );
}
