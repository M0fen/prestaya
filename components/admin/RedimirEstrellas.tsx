"use client";
// Canje DIRECTO de estrellas por el admin (en persona, sin esperar que el cliente
// lo pida desde su teléfono). Busca el cliente, muestra su saldo real y redime N
// estrellas (validado en el servidor: saldo + tope del ciclo). Queda en el historial.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saldoEstrellasCliente, redimirEstrellasAdmin } from "@/lib/acciones/estrellas";
import type { SaldoEstrellas } from "@/lib/estrellas";

type ClienteMin = { id: string; nombre: string; documento: string | null };

export function RedimirEstrellas() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ClienteMin[]>([]);
  const [sel, setSel] = useState<ClienteMin | null>(null);
  const [saldo, setSaldo] = useState<SaldoEstrellas | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buscar = (term: string) => {
    setQ(term);
    setSel(null);
    setSaldo(null);
    setOk(null);
    if (timer.current) clearTimeout(timer.current);
    if (term.trim().length < 2) {
      setResultados([]);
      return;
    }
    // Debounce 300ms (la API está rate-limited; no disparar por cada tecla).
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/buscar-clientes?q=${encodeURIComponent(term.trim())}`);
        const j = await r.json();
        setResultados(j.ok ? (j.clientes ?? []) : []);
      } catch {
        setResultados([]);
      }
    }, 300);
  };

  const elegir = (c: ClienteMin) => {
    setSel(c);
    setResultados([]);
    setQ(c.nombre);
    setError(null);
    setOk(null);
    startTransition(async () => {
      const res = await saldoEstrellasCliente(c.id);
      if (res.ok) {
        setSaldo(res.saldo);
        setCantidad(res.saldo.redimiblesCiclo > 0 ? 1 : 0);
      } else setError(res.error);
    });
  };

  const redimir = () => {
    if (!sel || cantidad < 1 || pendiente) return;
    setError(null);
    startTransition(async () => {
      const res = await redimirEstrellasAdmin({ clienteId: sel.id, estrellas: cantidad });
      if (res.ok) {
        setOk(`Canjeaste ${cantidad} ⭐ de ${sel.nombre}.`);
        setSel(null);
        setSaldo(null);
        setQ("");
        router.refresh();
      } else setError(res.error);
    });
  };

  const tope = saldo?.redimiblesCiclo ?? 0;

  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] font-extrabold text-tinta">Redimir estrellas</span>
        <span className="text-[11.5px] font-medium text-tenue">
          Canjeá en persona por un cliente. Se valida su saldo y el tope del mes.
        </span>
      </div>

      {/* Búsqueda de cliente */}
      <div className="relative">
        <input
          type="search"
          value={q}
          onChange={(e) => buscar(e.target.value)}
          placeholder="Buscar cliente por nombre o documento…"
          className="w-full rounded-[12px] border border-borde bg-tarjeta px-3 py-2.5 text-[13.5px] outline-none focus:border-azul"
        />
        {resultados.length > 0 && !sel && (
          <div className="absolute z-10 mt-1 flex w-full flex-col overflow-hidden rounded-[12px] border border-borde bg-tarjeta shadow-[0_8px_24px_rgba(26,34,71,0.12)]">
            {resultados.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => elegir(c)}
                className="flex flex-col items-start px-3 py-2 text-left hover:bg-suave"
              >
                <span className="text-[13px] font-semibold text-tinta">{c.nombre}</span>
                {c.documento && <span className="text-[11px] text-tenue">{c.documento}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Saldo + canje */}
      {sel && saldo && (
        <div className="flex flex-col gap-2.5 rounded-[12px] bg-suave p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] font-semibold text-cuerpo">
            <span className="font-extrabold text-tinta">{sel.nombre}</span>
            <span>Disponibles: <b className="text-[#B9770E]">{saldo.disponibles} ⭐</b></span>
            <span className="text-tenue">·</span>
            <span>Este mes podés canjear hasta <b className="text-tinta">{tope}</b></span>
          </div>
          {tope > 0 ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={tope}
                value={cantidad}
                onChange={(e) => setCantidad(Math.max(1, Math.min(tope, Math.round(Number(e.target.value) || 1))))}
                className="w-20 rounded-[10px] border border-borde px-3 py-2 text-[14px] font-bold outline-none focus:border-azul"
              />
              <button
                type="button"
                onClick={redimir}
                disabled={pendiente}
                className="flex-1 rounded-full bg-[#1FA971] px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-40"
              >
                {pendiente ? "Canjeando…" : `Canjear ${cantidad} ⭐`}
              </button>
            </div>
          ) : (
            <p className="text-[12px] font-medium text-gris">
              {saldo.disponibles === 0
                ? "No tiene estrellas disponibles para canjear."
                : "Ya llegó al tope de canjes de este mes."}
            </p>
          )}
        </div>
      )}

      {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}
      {ok && <span className="text-[11.5px] font-semibold text-[#157A50]">{ok} ✓</span>}
    </section>
  );
}
