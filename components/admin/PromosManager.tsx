"use client";
// Panel de juegos PROMOCIONALES (admin). Configura los premios de la raspadita
// (con sus pesos/probabilidad) y gestiona quinielas (abrir, cerrar con el número
// ganador, ver ganadores). ⚠️ Sin dinero real: premios = beneficios simbólicos.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PremioRaspa, SegmentoRaspa } from "@/lib/raspadita";
import type { Quiniela } from "@/lib/data/promos";
import type { DefinicionSegmento } from "@/lib/segmentos";
import { SelectorSegmento } from "@/components/admin/SelectorSegmento";
import { formatearSuerte, numeroGanadorAlAzar } from "@/lib/quiniela";
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
  /** Ganadores YA resueltos = los del número sorteado + los forzados por el admin. */
  ganadores: { clienteId: string; nombre: string; numero: number }[];
  /** Todos los participantes con su número (para la lista plegable / forzar ganador). */
  participantes: { clienteId: string; nombre: string; numero: number }[];
  /** cliente_ids que el admin forzó como ganadores (0090). */
  ganadoresForzados: string[];
}

export function PromosManager({
  premios,
  segmentos,
  quinielas,
  resumen,
  zonas = [],
}: {
  premios: PremioRaspa[];
  segmentos: SegmentoRaspa[];
  quinielas: Quiniela[];
  resumen: Record<string, ResumenQuiniela>;
  zonas?: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const refrescar = () => router.refresh();
  // Tramos ordenados: primero los específicos, el "Los demás" (default) al final.
  const tramos = [...segmentos].sort(
    (a, b) => Number(a.esDefault) - Number(b.esDefault) || a.orden - b.orden,
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Explicador simple de cómo funciona todo (arriba de todo). */}
      <div className="flex flex-col gap-2 rounded-[16px] border border-[#D9E4FF] bg-[#EEF3FF] p-4">
        <span className="text-[14px] font-extrabold text-[#1E47C8]">🎫 Cómo funciona la raspadita</span>
        <ol className="flex flex-col gap-1.5 text-[12.5px] font-medium text-cuerpo">
          <li><b>1.</b> Creás <b>tramos</b> por el score del cliente (ej.: “Clientes estrella”, score 90–100%).</li>
          <li><b>2.</b> A cada tramo le ponés su <b>chance de ganar</b>: 100% = gana siempre; 40% = gana 4 de cada 10.</li>
          <li><b>3.</b> Cargás <b>premios</b> y los asignás a un tramo. Cuando el cliente gana, se sortea uno por su “peso”.</li>
        </ol>
        <p className="rounded-[10px] bg-white/70 px-3 py-2 text-[11.5px] font-semibold text-[#3A4664]">
          Ejemplo: un cliente con score 95% cae en “Clientes estrella” → gana siempre → saca uno de los premios de ese tramo.
          Uno con 60% cae en “Los demás” → gana según el % que le pongas.
        </p>
      </div>

      {/* ── Tramos de scoring ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-extrabold text-tinta">🎯 Paso 1 · Tramos por scoring</h2>
        <p className="text-[12px] font-medium text-gris">
          Cada tramo es un rango de score (en %) con su <b>% de probabilidad de ganar</b>. “Los demás”
          cubre a quien no cae en ningún tramo (no se puede borrar ni apagar).
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
        <h2 className="text-[15px] font-extrabold text-tinta">🎟️ Paso 2 · Premios de cada tramo</h2>
        <p className="text-[12px] font-medium text-gris">
          Cargá los premios y asigná cada uno a un tramo (con el selector). Al ganar, se sortea CUÁL por
          su “peso” (mayor peso = más chance). El servidor decide el resultado (no se puede trucar).
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

        {/* Explicador del flujo de la quiniela */}
        <div className="flex flex-col gap-2 rounded-[16px] border border-[#D9E4FF] bg-[#EEF3FF] p-4">
          <span className="text-[14px] font-extrabold text-[#1E47C8]">🍀 Cómo funciona la quiniela</span>
          <ol className="flex flex-col gap-1.5 text-[12.5px] font-medium text-cuerpo">
            <li><b>1.</b> Cada cliente tiene su <b>número de la suerte</b>: los <b>últimos 3 dígitos</b> de su número de registro. No lo elige (se le asigna).</li>
            <li><b>2.</b> Participa <b>automáticamente</b> quien está <b>al día</b> (sin días atrasados) y tiene crédito activo.</li>
            <li><b>3.</b> Abrís una quiniela con un <b>título</b> y un <b>premio</b> (beneficio, sin dinero).</li>
            <li><b>4.</b> Para <b>cerrar</b>: cargás el <b>número ganador</b> (000 a 999) o tocás <b>“Al azar”</b> → ganan los clientes cuyo número coincide.</li>
          </ol>
          <p className="rounded-[10px] bg-white/70 px-3 py-2 text-[11.5px] font-semibold text-[#3A4664]">
            Solo puede haber <b>una quiniela abierta</b> a la vez. Se muestra al cliente si la <b>Zona de juego</b> está encendida (en “Zona de juego”).
          </p>
        </div>

        <NuevaQuiniela onDone={() => router.refresh()} zonas={zonas} />
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

function NuevaQuiniela({ onDone, zonas = [] }: { onDone: () => void; zonas?: { id: string; nombre: string }[] }) {
  const [titulo, setTitulo] = useState("");
  const [premioTexto, setPremio] = useState("");
  const [segmentoDef, setSegmentoDef] = useState<DefinicionSegmento | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const crear = async () => {
    setOcupado(true);
    // El número es siempre de 3 dígitos (000–999): los últimos 3 del registro.
    const r = await crearQuiniela({ titulo, premioTexto, rangoMin: 0, rangoMax: 999, segmentoDef });
    setOcupado(false);
    if (r.ok) { setTitulo(""); setPremio(""); setSegmentoDef(null); onDone(); }
  };

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-borde bg-tarjeta p-3">
      <span className="text-[13px] font-bold text-tinta">Abrir una quiniela</span>
      <input className={inputCls} placeholder="Título (ej. Quiniela de julio)" value={titulo}
        onChange={(e) => setTitulo(e.target.value)} />
      <input className={inputCls} placeholder="Premio (beneficio, sin dinero)" value={premioTexto}
        onChange={(e) => setPremio(e.target.value)} />
      {/* Audiencia (0089): quiénes participan. Vacío = todos los que estén al día. */}
      <SelectorSegmento value={segmentoDef} onChange={setSegmentoDef} zonas={zonas} />
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-tenue">Números del 000 al 999 (últimos 3 del registro).</span>
        <button onClick={crear} disabled={ocupado || !titulo.trim() || !premioTexto.trim()}
          className="ml-auto rounded-full bg-azul px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">
          Abrir
        </button>
      </div>
    </div>
  );
}

function QuinielaFila({ q, resumen, onDone }: { q: Quiniela; resumen?: ResumenQuiniela; onDone: () => void }) {
  const [ganador, setGanador] = useState<number>(q.numeroGanador ?? 0);
  const [ocupado, setOcupado] = useState(false);
  const [verParticipantes, setVerParticipantes] = useState(false);
  // cliente_ids que el admin fuerza como ganadores, además del número (0090).
  const [forzados, setForzados] = useState<Set<string>>(new Set());
  const count = resumen?.count ?? 0;
  const abierta = q.estado === "abierta";

  const acotar = (n: number) => Math.min(999, Math.max(0, Math.round(Number(n) || 0)));
  const toggleForzado = (id: string) =>
    setForzados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Sortea al azar entre los NÚMEROS de los participantes reales → garantiza
  // ganador (ver numeroGanadorAlAzar). Solo precarga el campo; cerrar es aparte.
  const sortearGanador = () => {
    const nums = resumen?.participantes.map((p) => p.numero) ?? [];
    const elegido = numeroGanadorAlAzar(nums);
    if (elegido != null) setGanador(elegido);
  };

  const cerrar = async () => {
    const g = acotar(ganador);
    const nForz = forzados.size;
    const msg =
      `Cerrar "${q.titulo}". Ganan los del número ${formatearSuerte(g)}` +
      (nForz ? ` MÁS ${nForz} persona${nForz === 1 ? "" : "s"} que elegiste a mano` : "") +
      `. Esto la CIERRA. ¿Confirmás?`;
    if (!confirm(msg)) return;
    setOcupado(true);
    await cerrarQuiniela({ id: q.id, rangoMin: 0, rangoMax: 999, numeroGanador: g, forzados: [...forzados] });
    setOcupado(false);
    onDone();
  };

  const forzadosSet = new Set(resumen?.ganadoresForzados ?? []);

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-borde bg-tarjeta p-3">
      <div className="flex items-center gap-2">
        <span className="text-[13.5px] font-bold text-tinta">{q.titulo}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${abierta ? "bg-verde-suave text-verde-osc" : "bg-linea text-gris"}`}>
          {q.estado}
        </span>
        <button
          type="button"
          onClick={() => setVerParticipantes((v) => !v)}
          className="ml-auto text-[11.5px] font-bold text-azul hover:underline"
        >
          {count} participante{count === 1 ? "" : "s"}
        </button>
      </div>
      <span className="text-[12px] font-medium text-gris">Premio: {q.premioTexto} · números 000–999</span>

      {/* Lista de participantes. Con la quiniela ABIERTA, tocar una persona la
          marca ⭐ como ganadora forzada (además del número). */}
      {verParticipantes && (
        <div className="flex flex-col gap-1">
          {abierta && count > 0 && (
            <span className="px-0.5 text-[11px] font-semibold text-azul">
              Tocá una persona para que gane sí o sí (⭐), además del número sorteado.
            </span>
          )}
          <div className="max-h-[200px] overflow-y-auto rounded-[10px] border border-borde bg-suave p-2">
            {resumen && resumen.participantes.length > 0 ? (
              <ul className="flex flex-col gap-0.5">
                {resumen.participantes.map((g) => {
                  const marcado = forzados.has(g.clienteId);
                  const contenido = (
                    <>
                      <span className={`truncate ${marcado ? "font-bold text-ambar-osc" : "text-cuerpo"}`}>
                        {marcado ? "⭐ " : ""}
                        {g.nombre}
                      </span>
                      <span className="font-bold text-tinta tabular-nums">{formatearSuerte(g.numero)}</span>
                    </>
                  );
                  return abierta ? (
                    <li key={g.clienteId}>
                      <button
                        type="button"
                        onClick={() => toggleForzado(g.clienteId)}
                        className={`flex w-full items-center justify-between gap-2 rounded-[7px] px-1.5 py-1 text-left text-[12px] transition-colors ${marcado ? "bg-ambar-suave" : "hover:bg-tarjeta"}`}
                      >
                        {contenido}
                      </button>
                    </li>
                  ) : (
                    <li key={g.clienteId} className="flex items-center justify-between px-1.5 py-1 text-[12px]">
                      {contenido}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <span className="text-[11.5px] font-medium text-gris">Todavía no hay participantes.</span>
            )}
          </div>
        </div>
      )}

      {abierta ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* "Sortear ganador" elige al azar ENTRE los participantes → siempre
                sale alguien (antes sorteaba en 000–999 y casi siempre no ganaba
                nadie). El campo manual queda para cargar un número específico. */}
            <button
              type="button"
              onClick={sortearGanador}
              disabled={count === 0}
              title={count === 0 ? "No hay participantes para sortear todavía." : undefined}
              className="rounded-full bg-azul px-4 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-40"
            >
              🎲 Sortear un ganador
            </button>
            <label className="flex items-center gap-1 text-[11px] font-semibold text-gris">
              o cargá el N.º
              <input type="number" min={0} max={999} className={`${inputCls} w-20 tabular-nums`}
                value={ganador} onChange={(e) => setGanador(acotar(Number(e.target.value)))} />
            </label>
            <button onClick={cerrar} disabled={ocupado}
              className="ml-auto rounded-full bg-verde-osc px-4 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50">
              Cerrar con {formatearSuerte(ganador)}
            </button>
          </div>
          <span className="text-[11px] font-medium text-tenue">
            {count === 0
              ? "Cuando haya participantes al día vas a poder sortear."
              : `“Sortear un ganador” elige al azar entre los ${count} participante${count === 1 ? "" : "s"} (siempre gana alguien).`}
            {forzados.size > 0 && ` · ${forzados.size} elegido${forzados.size === 1 ? "" : "s"} a mano ⭐`}
          </span>
        </div>
      ) : (
        <div className="rounded-[10px] bg-suave p-2.5">
          <span className="text-[12.5px] font-bold text-tinta">Número ganador: {formatearSuerte(q.numeroGanador)}</span>
          {resumen && resumen.ganadores.length > 0 ? (
            <p className="mt-1 text-[12px] font-medium text-verde-osc">
              🏆 {resumen.ganadores.map((g) => `${g.nombre}${forzadosSet.has(g.clienteId) ? " ⭐" : ""}`).join(", ")}
            </p>
          ) : (
            <p className="mt-1 text-[12px] font-medium text-gris">Sin ganadores esta vez.</p>
          )}
        </div>
      )}
    </div>
  );
}
