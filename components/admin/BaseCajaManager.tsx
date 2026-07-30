"use client";
// Base de caja del día (gestor): con cuánto efectivo arranca cada cobrador (0105).
// AGRUPADA por ZONA → supervisor → cobradores, con subtotal por zona (antes era una
// tira plana de 52 inputs, poco práctica). La RLS acota al supervisor a su zona. Es
// efectivo bajo custodia que el cobrador DEVUELVE al cerrar (esperado = base +
// recaudado − gastos); acá solo se setea el número.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setApertura } from "@/lib/acciones/aperturas";
import { UYU } from "@/lib/format";

export interface CobradorBase {
  id: string;
  nombre: string;
  zonaId: string | null;
  zonaNombre: string | null;
  base: number;
}

const SIN_ZONA = "__sin_zona__";

type Grupo = {
  clave: string;
  zonaNombre: string;
  supervisores: string[];
  cobradores: CobradorBase[];
  subtotal: number;
};

/** Agrupa los cobradores por zona con su subtotal de base, ordenado por nombre de zona. */
function agrupar(cobradores: CobradorBase[], supervisoresPorZona: Record<string, string[]>): Grupo[] {
  const map = new Map<string, Grupo>();
  for (const c of cobradores) {
    const clave = c.zonaId ?? SIN_ZONA;
    let g = map.get(clave);
    if (!g) {
      g = {
        clave,
        zonaNombre: c.zonaId ? (c.zonaNombre ?? "Zona") : "Sin zona (interior)",
        supervisores: c.zonaId ? (supervisoresPorZona[c.zonaId] ?? []) : [],
        cobradores: [],
        subtotal: 0,
      };
      map.set(clave, g);
    }
    g.cobradores.push(c);
    g.subtotal += c.base;
  }
  for (const g of map.values()) g.cobradores.sort((a, b) => a.nombre.localeCompare(b.nombre));
  // Zonas reales primero (por nombre); "Sin zona" al final.
  return [...map.values()].sort((a, b) =>
    a.clave === SIN_ZONA ? 1 : b.clave === SIN_ZONA ? -1 : a.zonaNombre.localeCompare(b.zonaNombre),
  );
}

export function BaseCajaManager({
  cobradores,
  supervisoresPorZona = {},
}: {
  cobradores: CobradorBase[];
  supervisoresPorZona?: Record<string, string[]>;
}) {
  const total = cobradores.reduce((s, c) => s + c.base, 0);
  const grupos = agrupar(cobradores, supervisoresPorZona);
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
        <div className="flex flex-col gap-2">
          {grupos.map((g) => (
            <details key={g.clave} open className="group rounded-[12px] border border-linea">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[12px] bg-suave px-3 py-2 select-none">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[12.5px] font-extrabold text-tinta">📍 {g.zonaNombre}</span>
                  <span className="truncate text-[10.5px] font-medium text-tenue">
                    {g.supervisores.length ? `Sup: ${g.supervisores.join(", ")}` : "Sin supervisor"} · {g.cobradores.length} cobr.
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-[13px] font-black tabular-nums text-tinta">{UYU(g.subtotal)}</span>
                  <span aria-hidden className="text-[10px] text-gris transition-transform group-open:rotate-90">▶</span>
                </div>
              </summary>
              <ul className="flex flex-col divide-y divide-linea px-3">
                {g.cobradores.map((c) => (
                  <FilaBase key={c.id} c={c} />
                ))}
              </ul>
            </details>
          ))}
        </div>
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
    <li className="flex items-center gap-2 py-2.5">
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-tinta">{c.nombre}</span>
      <input
        inputMode="numeric"
        value={val}
        onChange={(e) => { setVal(e.target.value.replace(/[^\d]/g, "")); setMsg(null); }}
        placeholder="0"
        className="w-28 rounded-[9px] border border-borde px-2.5 py-1.5 text-right text-[16px] tabular-nums outline-none focus:border-azul"
      />
      <button
        type="button"
        onClick={guardar}
        disabled={pend}
        className="flex-shrink-0 rounded-full bg-azul px-3 py-2.5 text-[12px] font-bold text-white disabled:opacity-50"
      >
        {pend ? "…" : "Fijar"}
      </button>
      {msg && <span className="flex-shrink-0 text-[11px] font-bold text-verde">{msg}</span>}
    </li>
  );
}
