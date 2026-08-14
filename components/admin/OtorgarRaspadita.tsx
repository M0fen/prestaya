"use client";
// Regalar raspaditas a una PERSONA buscándola por su NOMBRE (o documento). Conecta
// la acción otorgarRaspaditasAction (que existía sin UI). Reusa /api/buscar-clientes
// (RLS por zona: un supervisor solo ve/otorga a clientes de su zona). El premio de
// cada raspadita sale del sorteo configurado arriba (el servidor decide; anti-trampa).
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { otorgarRaspaditasAction } from "@/lib/acciones/promos";

type ClienteMin = { id: string; nombre: string; documento: string | null };
type PremioMin = { id: string; label: string; costo?: number };

export function OtorgarRaspadita({
  premios = [],
  /** Costo promedio de UNA jugada al azar (del tramo por defecto). Sirve para
   *  decir cuánto se está dejando en la calle ANTES de confirmar el regalo. */
  costoPromedioAzar = 0,
}: {
  premios?: PremioMin[];
  costoPromedioAzar?: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ClienteMin[]>([]);
  const [sel, setSel] = useState<ClienteMin | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [motivo, setMotivo] = useState("");
  const [premioId, setPremioId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pendiente, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buscar = (term: string) => {
    setQ(term);
    setSel(null);
    setOk(null);
    setError(null);
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
    setOk(null);
    setError(null);
  };

  const otorgar = () => {
    if (!sel || cantidad < 1 || pendiente) return;
    setError(null);
    start(async () => {
      const res = await otorgarRaspaditasAction({ clienteId: sel.id, cantidad, motivo: motivo.trim() || null, premioId: premioId || null });
      if (res.ok) {
        const premioNombre = premios.find((p) => p.id === premioId)?.label;
        setOk(
          `Le regalaste ${cantidad} raspadita${cantidad === 1 ? "" : "s"} a ${sel.nombre}` +
            (premioNombre ? ` (le va a tocar: ${premioNombre}).` : "."),
        );
        setSel(null);
        setQ("");
        setMotivo("");
        setCantidad(1);
        setPremioId("");
        router.refresh();
      } else setError(res.error);
    });
  };

  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] font-extrabold text-tinta">🎁 Regalar una raspadita a alguien</span>
        <span className="text-[11.5px] font-medium text-tenue">
          Buscá a la persona por su nombre y regalale raspaditas. Las juega en su cartón. Podés
          dejar el premio al azar del sorteo, o FIJAR uno para que le toque sí o sí.
        </span>
      </div>

      {/* Búsqueda de cliente por nombre */}
      <div className="relative">
        <input
          type="search"
          value={q}
          onChange={(e) => buscar(e.target.value)}
          placeholder="Buscar persona por nombre o documento…"
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

      {sel && (
        <div className="flex flex-col gap-2.5 rounded-[12px] bg-suave p-3">
          <span className="text-[13px] font-extrabold text-tinta">{sel.nombre}</span>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10.5px] font-bold text-gris">Cantidad</span>
              <input
                type="number"
                min={1}
                max={50}
                value={cantidad}
                onChange={(e) => setCantidad(Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 1))))}
                className="w-20 rounded-[12px] border border-borde px-3 py-2 text-[14px] font-bold outline-none focus:border-azul"
              />
            </label>
            <label className="flex flex-1 flex-col gap-0.5">
              <span className="text-[10.5px] font-bold text-gris">Motivo (opcional)</span>
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={120}
                placeholder="Ej: cumpleaños, cliente fiel…"
                className="w-full rounded-[12px] border border-borde px-3 py-2 text-[13px] outline-none focus:border-azul"
              />
            </label>
          </div>
          {premios.length > 0 && (
            <label className="flex flex-col gap-0.5">
              <span className="text-[10.5px] font-bold text-gris">¿Qué premio le va a tocar?</span>
              <select
                value={premioId}
                onChange={(e) => setPremioId(e.target.value)}
                className="w-full rounded-[12px] border border-borde bg-tarjeta px-3 py-2 text-[13px] outline-none focus:border-azul"
              >
                <option value="">🎲 Al azar (según el sorteo que configuraste)</option>
                {premios.map((p) => (
                  <option key={p.id} value={p.id}>🎯 Siempre: {p.label}</option>
                ))}
              </select>
            </label>
          )}
          {/* Cuánto cuesta ESTE regalo, antes de confirmarlo (0130). Con premio
              fijado el costo es exacto (siempre toca ese); al azar es el
              promedio del sorteo. Si no hay costos cargados, se dice en vez de
              mostrar un $0 que parece "gratis". */}
          {(() => {
            const fijado = premios.find((p) => p.id === premioId);
            const unit = premioId ? (fijado?.costo ?? 0) : costoPromedioAzar;
            const total = Math.round(unit * cantidad);
            if (unit <= 0) {
              return (
                <span className="text-[11.5px] leading-[1.5] font-semibold text-[#8A6D1F]">
                  ⚠️ Este premio no tiene costo cargado, así que no puedo decirte cuánto te sale.
                  Cargalo en la lista de premios para que entre al presupuesto.
                </span>
              );
            }
            return (
              <span className="rounded-[12px] bg-[#EEF3FF] px-3 py-2 text-[12px] leading-[1.5] font-semibold text-[#3A4664]">
                Este regalo te va a costar{" "}
                <b className="tabular-nums text-[#1E47C8]">
                  ${total.toLocaleString("es-UY")}
                </b>{" "}
                {premioId ? "(premio fijo)" : "en promedio (premio al azar)"}.
              </span>
            );
          })()}
          <button
            type="button"
            onClick={otorgar}
            disabled={pendiente}
            className="rounded-full bg-[#1E47C8] px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-40"
          >
            {pendiente ? "Regalando…" : `Regalar ${cantidad} raspadita${cantidad === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}
      {ok && <span className="text-[11.5px] font-semibold text-[#157A50]">{ok} ✓</span>}
    </section>
  );
}
