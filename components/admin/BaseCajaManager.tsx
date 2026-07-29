"use client";
// Base de caja del día (gestor): con cuánto efectivo arranca cada cobrador (0105).
// La RLS acota al supervisor a su zona. Es efectivo bajo custodia que el cobrador
// DEVUELVE al cerrar (esperado = base + recaudado − gastos). Solo setea un número;
// el money-path (cierre) ya calcula y guarda con esa base.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setApertura } from "@/lib/acciones/aperturas";
import { UYU } from "@/lib/format";

export interface CobradorBase {
  id: string;
  nombre: string;
  zonaNombre: string | null;
  base: number;
}

export function BaseCajaManager({ cobradores }: { cobradores: CobradorBase[] }) {
  const total = cobradores.reduce((s, c) => s + c.base, 0);
  return (
    <section className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13.5px] font-extrabold text-tinta">💵 Base de caja de hoy</span>
          <span className="text-[11px] font-medium text-tenue">
            Con cuánto efectivo arranca cada cobrador. La devuelve junto con lo cobrado al cerrar.
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] font-bold uppercase tracking-wide text-gris">En la calle</span>
          <span className="text-[16px] font-black tabular-nums text-[#1E47C8]">{UYU(total)}</span>
        </div>
      </div>
      {cobradores.length === 0 ? (
        <p className="py-2 text-center text-[12px] font-medium text-gris">No hay cobradores en tu alcance.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-linea">
          {cobradores.map((c) => (
            <FilaBase key={c.id} c={c} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FilaBase({ c }: { c: CobradorBase }) {
  const router = useRouter();
  const [val, setVal] = useState(c.base > 0 ? String(c.base) : "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, start] = useTransition();
  const guardar = () =>
    start(async () => {
      setMsg(null);
      const r = await setApertura({ cobradorId: c.id, base: Math.max(0, Math.round(Number(val) || 0)) });
      setMsg(r.ok ? "✓ Guardado" : r.error);
      if (r.ok) router.refresh();
    });
  return (
    <li className="flex items-center gap-2 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-bold text-tinta">{c.nombre}</span>
        {c.zonaNombre && <span className="text-[10.5px] font-medium text-tenue">{c.zonaNombre}</span>}
      </div>
      <input
        inputMode="numeric"
        value={val}
        onChange={(e) => { setVal(e.target.value.replace(/[^\d]/g, "")); setMsg(null); }}
        placeholder="0"
        className="w-24 rounded-[9px] border border-borde px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none focus:border-azul"
      />
      <button
        type="button"
        onClick={guardar}
        disabled={pend}
        className="flex-shrink-0 rounded-full bg-azul px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
      >
        {pend ? "…" : "Fijar"}
      </button>
      {msg && <span className="flex-shrink-0 text-[11px] font-bold text-verde">{msg}</span>}
    </li>
  );
}
