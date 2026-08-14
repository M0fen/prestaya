"use client";
// "Prometió pagar" — el cobrador deja registrado un compromiso del cliente en la
// calle. Alimenta el mini-CRM auto-verificado (el supervisor lo ve en Mi jornada).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { fechaISOUY } from "@/lib/fecha";
import { registrarCompromiso } from "@/lib/acciones/compromisos";

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
  const [fecha, setFecha] = useState(fechaISOUY(new Date(Date.now() + 864e5)));
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
        className="rounded-[14px] border border-campo bg-tarjeta px-4 py-3 text-[13.5px] font-bold text-violeta-osc active:scale-[0.99]"
      >
        🤝 Prometió pagar
      </button>
    );
  }

  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-violeta-suave bg-violeta-suave p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13.5px] font-extrabold text-violeta-osc">Compromiso de pago</span>
        <button type="button" onClick={() => setAbierto(false)} className="-mr-1 rounded-full px-3 py-1.5 text-[12px] font-bold text-gris active:bg-violeta-suave">
          Cerrar
        </button>
      </div>
      {ok ? (
        <span className="py-1 text-[13px] font-bold text-verde-osc">✓ Compromiso registrado. Lo verá tu supervisor.</span>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-violeta-osc">Monto</span>
              <div className="flex items-center gap-1 rounded-[12px] border border-violeta-suave bg-tarjeta px-3 py-2">
                <span className="text-[14px] font-bold text-gris">$</span>
                <input
                  inputMode="numeric"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder={String(Math.round(cuota))}
                  className="w-20 text-[16px] tabular-nums outline-none"
                  aria-label="Monto del compromiso"
                />
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-violeta-osc">Para cuándo</span>
              <input
                type="date"
                value={fecha}
                min={fechaISOUY()}
                onChange={(e) => setFecha(e.target.value)}
                className="rounded-[12px] border border-violeta-suave bg-tarjeta px-3 py-2 text-[16px] text-tinta outline-none"
              />
            </label>
            <button
              type="button"
              disabled={pendiente}
              onClick={enviar}
              className="rounded-[12px] bg-[#7A4DD6] px-4 py-2.5 text-[13.5px] font-bold text-white disabled:opacity-40"
            >
              {pendiente ? "…" : "Guardar"}
            </button>
          </div>
          <p className="text-[10.5px] font-medium text-violeta-osc">
            Se verifica solo contra los pagos: si cumple, queda saldado; si no, aparece como incumplido. Vacío = {UYU(cuota)}.
          </p>
          {error && <span className="text-[11.5px] font-bold text-rojo-osc">{error}</span>}
        </>
      )}
    </section>
  );
}
