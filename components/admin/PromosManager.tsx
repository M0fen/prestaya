"use client";
// Panel de juegos PROMOCIONALES (admin). Configura los premios de la raspadita
// (con sus pesos/probabilidad) y gestiona quinielas (abrir, cerrar con el número
// ganador, ver ganadores). ⚠️ Sin dinero real: premios = beneficios simbólicos.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PremioRaspa } from "@/lib/raspadita";
import type { Quiniela } from "@/lib/data/promos";
import {
  guardarPremioRaspa,
  eliminarPremioRaspa,
  crearQuiniela,
  cerrarQuiniela,
} from "@/lib/acciones/promos";

export interface ResumenQuiniela {
  count: number;
  ganadores: { nombre: string; numero: number }[];
}

export function PromosManager({
  premios,
  quinielas,
  resumen,
}: {
  premios: PremioRaspa[];
  quinielas: Quiniela[];
  resumen: Record<string, ResumenQuiniela>;
}) {
  const router = useRouter();
  const pesoTotal = premios.filter((p) => p.activo).reduce((s, p) => s + p.peso, 0) || 1;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Raspadita ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-extrabold text-tinta">🎟️ Raspadita — premios</h2>
        <p className="text-[12px] font-medium text-gris">
          El “peso” es la probabilidad relativa: a mayor peso, más chance de salir. El servidor
          decide el resultado (no se puede trucar).
        </p>
        <div className="flex flex-col gap-2">
          {premios.map((p) => (
            <PremioFila
              key={p.id}
              premio={p}
              probabilidad={p.activo ? Math.round((p.peso / pesoTotal) * 100) : 0}
              onChange={() => router.refresh()}
            />
          ))}
        </div>
        <PremioFila nuevo onChange={() => router.refresh()} />
      </section>

      {/* ── Quiniela ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-extrabold text-tinta">🍀 Quiniela</h2>
        <NuevaQuiniela onDone={() => router.refresh()} />
        <div className="flex flex-col gap-2">
          {quinielas.length === 0 && (
            <p className="rounded-[14px] bg-white p-4 text-center text-[13px] font-medium text-gris">
              No hay quinielas todavía.
            </p>
          )}
          {quinielas.map((q) => (
            <QuinielaFila key={q.id} q={q} resumen={resumen[q.id]} onDone={() => router.refresh()} />
          ))}
        </div>
      </section>
    </div>
  );
}

const inputCls =
  "rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[13px] text-tinta outline-none focus:border-azul";

function PremioFila({
  premio,
  probabilidad,
  nuevo = false,
  onChange,
}: {
  premio?: PremioRaspa;
  probabilidad?: number;
  nuevo?: boolean;
  onChange: () => void;
}) {
  const [label, setLabel] = useState(premio?.label ?? "");
  const [peso, setPeso] = useState(premio?.peso ?? 10);
  const [tipo, setTipo] = useState(premio?.tipo ?? "beneficio");
  const [activo, setActivo] = useState(premio?.activo ?? true);
  const [ocupado, setOcupado] = useState(false);

  const guardar = async () => {
    setOcupado(true);
    await guardarPremioRaspa({ id: premio?.id ?? null, label, tipo, peso, activo, orden: 0 });
    setOcupado(false);
    if (nuevo) { setLabel(""); setPeso(10); }
    onChange();
  };
  const borrar = async () => {
    if (!premio) return;
    if (!confirm(`¿Borrar "${premio.label}"?`)) return;
    await eliminarPremioRaspa(premio.id);
    onChange();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-[#E6EAF4] bg-white p-2.5">
      <input className={`${inputCls} min-w-0 flex-1`} placeholder={nuevo ? "Nuevo premio…" : ""}
        value={label} onChange={(e) => setLabel(e.target.value)} />
      <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as PremioRaspa["tipo"])}>
        <option value="beneficio">Beneficio</option>
        <option value="nada">Nada</option>
      </select>
      <label className="flex items-center gap-1 text-[11px] font-semibold text-gris">
        Peso
        <input type="number" min={0} className={`${inputCls} w-16`} value={peso}
          onChange={(e) => setPeso(Number(e.target.value))} />
      </label>
      {!nuevo && (
        <span className="w-12 text-center text-[12px] font-bold text-azul tabular-nums">{probabilidad}%</span>
      )}
      <label className="flex items-center gap-1 text-[12px] font-semibold text-tinta">
        <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo
      </label>
      <button onClick={guardar} disabled={ocupado || !label.trim()}
        className="rounded-full bg-azul px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
        {nuevo ? "Agregar" : "Guardar"}
      </button>
      {!nuevo && (
        <button onClick={borrar} aria-label="Borrar" className="text-[15px] text-[#C7D2EC] hover:text-[#D64545]">✕</button>
      )}
    </div>
  );
}

function NuevaQuiniela({ onDone }: { onDone: () => void }) {
  const [titulo, setTitulo] = useState("");
  const [premioTexto, setPremio] = useState("");
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(99);
  const [ocupado, setOcupado] = useState(false);

  const crear = async () => {
    setOcupado(true);
    const r = await crearQuiniela({ titulo, premioTexto, rangoMin: min, rangoMax: max });
    setOcupado(false);
    if (r.ok) { setTitulo(""); setPremio(""); onDone(); }
  };

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-[#E6EAF4] bg-white p-3">
      <span className="text-[13px] font-bold text-tinta">Abrir una quiniela</span>
      <input className={inputCls} placeholder="Título (ej. Quiniela de julio)" value={titulo}
        onChange={(e) => setTitulo(e.target.value)} />
      <input className={inputCls} placeholder="Premio (beneficio, sin dinero)" value={premioTexto}
        onChange={(e) => setPremio(e.target.value)} />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-[11px] font-semibold text-gris">
          Del <input type="number" className={`${inputCls} w-16`} value={min} onChange={(e) => setMin(Number(e.target.value))} />
        </label>
        <label className="flex items-center gap-1 text-[11px] font-semibold text-gris">
          al <input type="number" className={`${inputCls} w-16`} value={max} onChange={(e) => setMax(Number(e.target.value))} />
        </label>
        <button onClick={crear} disabled={ocupado || !titulo.trim() || !premioTexto.trim()}
          className="ml-auto rounded-full bg-azul px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">
          Abrir
        </button>
      </div>
    </div>
  );
}

function QuinielaFila({ q, resumen, onDone }: { q: Quiniela; resumen?: ResumenQuiniela; onDone: () => void }) {
  const [ganador, setGanador] = useState<number>(q.numeroGanador ?? q.rangoMin);
  const [ocupado, setOcupado] = useState(false);
  const count = resumen?.count ?? 0;

  const cerrar = async () => {
    if (!confirm(`Sortear "${q.titulo}" con el número ${ganador}. ¿Confirmás?`)) return;
    setOcupado(true);
    await cerrarQuiniela({ id: q.id, rangoMin: q.rangoMin, rangoMax: q.rangoMax, numeroGanador: ganador });
    setOcupado(false);
    onDone();
  };

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-[#E6EAF4] bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="text-[13.5px] font-bold text-tinta">{q.titulo}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${q.estado === "abierta" ? "bg-[#E7F7EF] text-[#157A50]" : "bg-[#EEF1F8] text-gris"}`}>
          {q.estado}
        </span>
        <span className="ml-auto text-[11.5px] font-medium text-gris">{count} participante{count === 1 ? "" : "s"}</span>
      </div>
      <span className="text-[12px] font-medium text-gris">Premio: {q.premioTexto} · números {q.rangoMin}–{q.rangoMax}</span>

      {q.estado === "abierta" ? (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] font-semibold text-gris">
            N.º ganador
            <input type="number" min={q.rangoMin} max={q.rangoMax} className={`${inputCls} w-20`}
              value={ganador} onChange={(e) => setGanador(Number(e.target.value))} />
          </label>
          <button onClick={cerrar} disabled={ocupado}
            className="ml-auto rounded-full bg-[#1FA971] px-4 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50">
            Sortear y cerrar
          </button>
        </div>
      ) : (
        <div className="rounded-[10px] bg-[#F4F6FB] p-2.5">
          <span className="text-[12.5px] font-bold text-tinta">Número ganador: {q.numeroGanador}</span>
          {resumen && resumen.ganadores.length > 0 ? (
            <p className="mt-1 text-[12px] font-medium text-[#157A50]">
              🏆 {resumen.ganadores.map((g) => g.nombre).join(", ")}
            </p>
          ) : (
            <p className="mt-1 text-[12px] font-medium text-gris">Sin ganadores esta vez.</p>
          )}
        </div>
      )}
    </div>
  );
}
