"use client";
// Panel de juegos PROMOCIONALES (admin). Configura los premios de la raspadita
// (con sus pesos/probabilidad) y gestiona quinielas (abrir, cerrar con el número
// ganador, ver ganadores). ⚠️ Sin dinero real: premios = beneficios simbólicos.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PremioRaspa, SegmentoRaspa } from "@/lib/raspadita";
import type { Quiniela } from "@/lib/data/promos";
import {
  guardarPremioRaspa,
  eliminarPremioRaspa,
  guardarSegmentoRaspa,
  eliminarSegmentoRaspa,
  crearQuiniela,
  cerrarQuiniela,
} from "@/lib/acciones/promos";

export interface ResumenQuiniela {
  count: number;
  ganadores: { nombre: string; numero: number }[];
}

export function PromosManager({
  premios,
  segmentos,
  quinielas,
  resumen,
}: {
  premios: PremioRaspa[];
  segmentos: SegmentoRaspa[];
  quinielas: Quiniela[];
  resumen: Record<string, ResumenQuiniela>;
}) {
  const router = useRouter();
  const refrescar = () => router.refresh();
  // Tramos ordenados: primero los específicos, el "Los demás" (default) al final.
  const tramos = [...segmentos].sort(
    (a, b) => Number(a.esDefault) - Number(b.esDefault) || a.orden - b.orden,
  );

  return (
    <div className="flex flex-col gap-6">
      {/* ── Tramos de scoring ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-extrabold text-tinta">🎯 Tramos por scoring</h2>
        <p className="text-[12px] font-medium text-gris">
          Premiá distinto según el score del cliente. Cada tramo es un rango de score (en %) con su{" "}
          <b>% de probabilidad de ganar</b>: 100% = siempre gana (premio “regalado”), 40% = gana 4 de
          cada 10. Los premios se reparten por tramo. “Los demás” cubre a quien no cae en ningún tramo.
        </p>
        <div className="flex flex-col gap-2">
          {tramos.map((s) => (
            <SegmentoFila key={s.id} segmento={s} onChange={refrescar} />
          ))}
        </div>
        <SegmentoFila nuevo onChange={refrescar} />
      </section>

      {/* ── Raspadita: premios (asignados a un tramo) ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-extrabold text-tinta">🎟️ Raspadita — premios por tramo</h2>
        <p className="text-[12px] font-medium text-gris">
          Cada premio pertenece a un tramo. Cuando el cliente <b>gana</b> (según el % del tramo), se
          sortea CUÁL premio por su “peso” (mayor peso, más chance). El servidor decide (no se truca).
        </p>
        {tramos.map((t) => {
          const delTramo = premios.filter(
            (p) => p.segmentoId === t.id || (t.esDefault && !p.segmentoId),
          );
          const pesoTotal =
            delTramo.filter((p) => p.activo && p.tipo === "beneficio").reduce((s, p) => s + p.peso, 0) || 1;
          return (
            <div key={t.id} className="flex flex-col gap-2 rounded-[14px] border border-borde bg-suave p-3">
              <span className="text-[12.5px] font-bold text-tinta">
                {t.nombre} <span className="font-medium text-gris">· {t.scoreMin}–{t.scoreMax}% · gana {t.probGanar}%</span>
              </span>
              {delTramo.length === 0 && (
                <span className="text-[11.5px] font-medium text-tenue">Sin premios en este tramo todavía.</span>
              )}
              {delTramo.map((p) => (
                <PremioFila
                  key={p.id}
                  premio={p}
                  segmentos={tramos}
                  probabilidad={p.activo && p.tipo === "beneficio" ? Math.round((p.peso / pesoTotal) * 100) : 0}
                  onChange={refrescar}
                />
              ))}
              <PremioFila nuevo segmentos={tramos} segmentoInicial={t.id} onChange={refrescar} />
            </div>
          );
        })}
        {tramos.length === 0 && (
          <p className="rounded-[14px] bg-tarjeta p-4 text-center text-[12.5px] font-medium text-gris">
            Creá un tramo arriba para empezar a cargar premios.
          </p>
        )}
      </section>

      {/* ── Quiniela ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-extrabold text-tinta">🍀 Quiniela</h2>
        <NuevaQuiniela onDone={() => router.refresh()} />
        <div className="flex flex-col gap-2">
          {quinielas.length === 0 && (
            <p className="rounded-[14px] bg-tarjeta p-4 text-center text-[13px] font-medium text-gris">
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
  "rounded-[10px] border border-borde px-3 py-2 text-[13px] text-tinta outline-none focus:border-azul";

function PremioFila({
  premio,
  probabilidad,
  segmentos = [],
  segmentoInicial = null,
  nuevo = false,
  onChange,
}: {
  premio?: PremioRaspa;
  probabilidad?: number;
  segmentos?: SegmentoRaspa[];
  segmentoInicial?: string | null;
  nuevo?: boolean;
  onChange: () => void;
}) {
  const [label, setLabel] = useState(premio?.label ?? "");
  const [peso, setPeso] = useState(premio?.peso ?? 10);
  const [tipo, setTipo] = useState(premio?.tipo ?? "beneficio");
  const [activo, setActivo] = useState(premio?.activo ?? true);
  const [segmentoId, setSegmentoId] = useState<string>(premio?.segmentoId ?? segmentoInicial ?? "");
  const [ocupado, setOcupado] = useState(false);

  const guardar = async () => {
    setOcupado(true);
    await guardarPremioRaspa({
      id: premio?.id ?? null,
      label, tipo, peso, activo, orden: 0,
      segmentoId: segmentoId || null,
    });
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
    <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-borde bg-tarjeta p-2.5">
      <input className={`${inputCls} min-w-0 flex-1`} placeholder={nuevo ? "Nuevo premio…" : ""}
        value={label} onChange={(e) => setLabel(e.target.value)} />
      {/* Selector de tramo (a qué segmento de scoring pertenece el premio). */}
      {segmentos.length > 0 && (
        <select className={inputCls} value={segmentoId} onChange={(e) => setSegmentoId(e.target.value)}>
          {segmentos.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}
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

// Fila de un TRAMO de scoring (rango + % de ganar). El tramo "Los demás" no se
// puede borrar ni cambiar su rango (es el catch-all), pero sí su % de ganar.
function SegmentoFila({
  segmento,
  nuevo = false,
  onChange,
}: {
  segmento?: SegmentoRaspa;
  nuevo?: boolean;
  onChange: () => void;
}) {
  const [nombre, setNombre] = useState(segmento?.nombre ?? "");
  const [min, setMin] = useState(segmento?.scoreMin ?? 90);
  const [max, setMax] = useState(segmento?.scoreMax ?? 100);
  const [prob, setProb] = useState(segmento?.probGanar ?? 100);
  const [activo, setActivo] = useState(segmento?.activo ?? true);
  const [ocupado, setOcupado] = useState(false);
  const esDefault = segmento?.esDefault ?? false;

  const guardar = async () => {
    setOcupado(true);
    await guardarSegmentoRaspa({
      id: segmento?.id ?? null,
      nombre, scoreMin: min, scoreMax: max, probGanar: prob, activo, orden: segmento?.orden ?? 0,
    });
    setOcupado(false);
    if (nuevo) { setNombre(""); setMin(90); setMax(100); setProb(100); }
    onChange();
  };
  const borrar = async () => {
    if (!segmento) return;
    if (!confirm(`¿Borrar el tramo "${segmento.nombre}"?`)) return;
    await eliminarSegmentoRaspa(segmento.id);
    onChange();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-borde bg-tarjeta p-2.5">
      <input className={`${inputCls} min-w-0 flex-1`} placeholder={nuevo ? "Nuevo tramo (ej. VIP)…" : ""}
        value={nombre} onChange={(e) => setNombre(e.target.value)} />
      {esDefault ? (
        <span className="text-[11px] font-bold text-tenue">todo lo no asignado</span>
      ) : (
        <label className="flex items-center gap-1 text-[11px] font-semibold text-gris">
          Score
          <input type="number" min={0} max={100} className={`${inputCls} w-14`} value={min}
            onChange={(e) => setMin(Number(e.target.value))} />
          <span>a</span>
          <input type="number" min={0} max={100} className={`${inputCls} w-14`} value={max}
            onChange={(e) => setMax(Number(e.target.value))} />
          <span>%</span>
        </label>
      )}
      <label className="flex items-center gap-1 text-[11px] font-semibold text-gris">
        Gana
        <input type="number" min={0} max={100} className={`${inputCls} w-14`} value={prob}
          onChange={(e) => setProb(Number(e.target.value))} />
        <span>%</span>
      </label>
      <label
        className="flex items-center gap-1 text-[12px] font-semibold text-tinta"
        title={esDefault ? "El tramo 'Los demás' no se puede desactivar (dejaría clientes sin premio)." : undefined}
      >
        {/* El default NO se puede desactivar: es el catch-all; sin él, quien no
            cae en un tramo se queda siempre sin premio. */}
        <input
          type="checkbox"
          checked={esDefault ? true : activo}
          disabled={esDefault}
          onChange={(e) => setActivo(e.target.checked)}
        />{" "}
        Activo
      </label>
      <button onClick={guardar} disabled={ocupado || !nombre.trim()}
        className="rounded-full bg-azul px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
        {nuevo ? "Agregar tramo" : "Guardar"}
      </button>
      {!nuevo && !esDefault && (
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
    <div className="flex flex-col gap-2 rounded-[14px] border border-borde bg-tarjeta p-3">
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
    <div className="flex flex-col gap-2 rounded-[14px] border border-borde bg-tarjeta p-3">
      <div className="flex items-center gap-2">
        <span className="text-[13.5px] font-bold text-tinta">{q.titulo}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${q.estado === "abierta" ? "bg-[#E7F7EF] text-[#157A50]" : "bg-linea text-gris"}`}>
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
        <div className="rounded-[10px] bg-suave p-2.5">
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
