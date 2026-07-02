"use client";
// ─────────────────────────────────────────────────────────────────────────
//  MASCOTA tamagotchi (vista de cliente). Elegir especie, ponerle nombre,
//  acariciar / peinar / jugar / dar un snack → la mascota REACCIONA (expresión,
//  meneo, corazones/brillos) y sube el "cariño" (vínculo, no deuda). El cariño
//  decae suave con el tiempo (te extraña). El crecimiento (etapa) viene de los
//  pagos reales. Persiste en la base (por token) con respaldo en localStorage.
// ─────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Criatura } from "./Criatura";
import {
  ESPECIES,
  accesoriosDisponibles,
  carinoActual,
  estadoAnimo,
  aplicarInteraccion,
  especiePorId,
  escenarioPorEtapa,
  estadoMascotaInicial,
  CARINO_MAX,
  type EstadoMascota,
  type Expresion,
} from "@/lib/mascota";
import { guardarMascota } from "@/app/c/[token]/actions";

type Accion = "acariciar" | "peinar" | "jugar" | "alimentar";
type Particula = { id: number; tipo: Accion; izq: number; dur: number };

const ACCIONES: { id: Accion; label: string; emoji: string; expresion: Expresion }[] = [
  { id: "acariciar", label: "Acariciar", emoji: "🫶", expresion: "feliz" },
  { id: "peinar", label: "Peinar", emoji: "🪮", expresion: "contento" },
  { id: "jugar", label: "Jugar", emoji: "🎾", expresion: "feliz" },
  { id: "alimentar", label: "Snack", emoji: "🍎", expresion: "contento" },
];

const EMOJI_PARTICULA: Record<Accion, string[]> = {
  acariciar: ["💛", "💗", "✨"],
  peinar: ["✨", "💫", "🫧"],
  jugar: ["🎾", "⭐", "🎉"],
  alimentar: ["🍎", "😋", "💛"],
};

export function MascotaTamagotchi({
  token,
  inicial,
  etapa,
  alDia = false,
}: {
  /** Token del link (persistencia real). Null en el demo (solo localStorage). */
  token: string | null;
  /** Estado guardado en la base (o null si no hay/tabla ausente). */
  inicial: EstadoMascota | null;
  /** Etapa de crecimiento (0..4), derivada de los pagos reales. */
  etapa: number;
  /** El cliente va al día → la mascota festeja al entrar. */
  alDia?: boolean;
}) {
  const claveLS = `py-mascota-${token ?? "demo"}`;

  const [estado, setEstado] = useState<EstadoMascota>(inicial ?? estadoMascotaInicial());
  const [reaccion, setReaccion] = useState<{ expresion: Expresion; anim: string } | null>(null);
  const [particulas, setParticulas] = useState<Particula[]>([]);
  const [panel, setPanel] = useState<"especie" | "accesorio" | "nombre" | null>(null);
  const [jugando, setJugando] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reacTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const particulaId = useRef(0);

  // Hidratar desde localStorage si no vino nada de la base (o para el demo).
  useEffect(() => {
    if (inicial) return;
    try {
      const raw = localStorage.getItem(claveLS);
      if (raw) setEstado({ ...estadoMascotaInicial(), ...JSON.parse(raw) });
    } catch {
      /* localStorage no disponible */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistencia: localStorage inmediato + base con debounce (best-effort).
  const persistir = useCallback(
    (next: EstadoMascota) => {
      try {
        localStorage.setItem(claveLS, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      if (!token) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        // Best-effort: si falla (tabla ausente/red), el localStorage ya guardó.
        guardarMascota({ token, ...next }).catch(() => {});
      }, 900);
    },
    [claveLS, token],
  );

  const actualizar = useCallback(
    (patch: Partial<EstadoMascota>) => {
      setEstado((prev) => {
        const next = { ...prev, ...patch };
        persistir(next);
        return next;
      });
    },
    [persistir],
  );

  // Cariño efectivo (con decaimiento). Se recalcula al renderizar.
  const carino = useMemo(
    () => carinoActual(estado.carino, estado.ultimaInteraccion),
    [estado.carino, estado.ultimaInteraccion],
  );
  const animo = estadoAnimo(carino, estado.nombre);
  const expresion: Expresion = reaccion?.expresion ?? animo.expresion;
  const especie = especiePorId(estado.especie);

  const interactuar = useCallback(
    (accion: Accion) => {
      const base = carinoActual(estado.carino, estado.ultimaInteraccion);
      const nuevo = aplicarInteraccion(base, accion);
      actualizar({ carino: nuevo, ultimaInteraccion: new Date().toISOString() });

      // Reacción visual transitoria.
      const meta = ACCIONES.find((a) => a.id === accion)!;
      const anim =
        accion === "jugar" ? "py-mascota-salta" : accion === "peinar" ? "py-mascota-brilla" : "py-mascota-mece";
      setReaccion({ expresion: meta.expresion, anim });
      if (reacTimer.current) clearTimeout(reacTimer.current);
      reacTimer.current = setTimeout(() => setReaccion(null), 1300);

      if (accion === "jugar") {
        setJugando(true);
        setTimeout(() => setJugando(false), 1100);
      }

      // Partículas.
      const nuevas: Particula[] = Array.from({ length: 5 }, () => ({
        id: particulaId.current++,
        tipo: accion,
        izq: 12 + Math.random() * 66,
        dur: 900 + Math.random() * 500,
      }));
      setParticulas((p) => [...p, ...nuevas]);
      const maxDur = Math.max(...nuevas.map((n) => n.dur));
      setTimeout(() => {
        const ids = new Set(nuevas.map((n) => n.id));
        setParticulas((p) => p.filter((x) => !ids.has(x.id)));
      }, maxDur + 100);
    },
    [estado.carino, estado.ultimaInteraccion, actualizar],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (reacTimer.current) clearTimeout(reacTimer.current);
    },
    [],
  );

  // Festejo al entrar si el cliente va al día (reconocimiento, tono amable).
  useEffect(() => {
    if (!alDia) return;
    const nuevas: Particula[] = Array.from({ length: 5 }, () => ({
      id: particulaId.current++,
      tipo: "jugar",
      izq: 14 + Math.random() * 64,
      dur: 1200 + Math.random() * 500,
    }));
    setParticulas((p) => [...p, ...nuevas]);
    const t = setTimeout(() => {
      const ids = new Set(nuevas.map((n) => n.id));
      setParticulas((p) => p.filter((x) => !ids.has(x.id)));
    }, 1800);
    return () => clearTimeout(t);
  }, [alDia]);

  const accDisponibles = accesoriosDisponibles(etapa);
  const nombreMostrar = estado.nombre.trim() || especie.nombre;
  const esc = escenarioPorEtapa(etapa);

  return (
    <section className="overflow-hidden rounded-[20px] border border-[#E3EAFB] bg-[linear-gradient(180deg,#F1F6FF,#FFFFFF)] p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Tu mascota</span>
        <button
          type="button"
          onClick={() => setPanel(panel === "nombre" ? null : "nombre")}
          className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12.5px] font-extrabold text-tinta shadow-[0_1px_2px_rgba(26,34,71,0.08)]"
        >
          {nombreMostrar} <span className="text-[11px] text-azul">✏️</span>
        </button>
      </div>

      {/* Escenario de la mascota (evoluciona con el nivel) */}
      <div className="relative flex flex-col items-center">
        <div
          className="relative flex w-full flex-col items-center overflow-hidden rounded-[16px] pt-2 pb-1"
          style={{ background: `linear-gradient(180deg, ${esc.cielo}, ${esc.suelo})` }}
        >
          {alDia && (
            <span className="absolute top-2 left-2 z-20 rounded-full bg-white/85 px-2 py-0.5 text-[10.5px] font-extrabold text-verde">
              ✨ Al día
            </span>
          )}
          <span className="absolute top-2 right-2 z-20 rounded-full bg-white/65 px-2 py-0.5 text-[9.5px] font-semibold text-gris">
            {esc.nombre}
          </span>

          {/* Partículas */}
          <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
            {particulas.map((p) => {
              const set = EMOJI_PARTICULA[p.tipo];
              return (
                <span
                  key={p.id}
                  className="py-particula absolute text-[18px]"
                  style={{ left: `${p.izq}%`, top: "56%", animationDuration: `${p.dur}ms` }}
                >
                  {set[p.id % set.length]}
                </span>
              );
            })}
            {jugando && <span className="py-pelota absolute text-[22px]" style={{ top: "60%" }}>🎾</span>}
          </div>

          <button
            type="button"
            onClick={() => interactuar("acariciar")}
            aria-label={`Acariciar a ${nombreMostrar}`}
            className={`relative z-0 transition-transform active:scale-95 ${reaccion?.anim ?? "py-mascota-idle"}`}
          >
            <Criatura
              especieId={estado.especie}
              etapa={etapa}
              expresion={expresion}
              accesorio={estado.accesorio}
              size={148}
            />
          </button>
        </div>

        {/* Ánimo */}
        <p className="mt-1.5 text-center text-[13px] font-semibold text-tinta">{animo.mensaje}</p>

        {/* Medidor de cariño */}
        <div className="mt-2 w-full max-w-[240px]">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-bold text-gris">💗 Cariño</span>
            <span className="text-[11px] font-bold text-[#C86B8E]">{Math.round((carino / CARINO_MAX) * 100)}%</span>
          </div>
          <div className="h-[9px] w-full overflow-hidden rounded-full bg-[#F0E1E8]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#F79AC0,#E86FA0)] transition-[width] duration-500"
              style={{ width: `${(carino / CARINO_MAX) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Acciones */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {ACCIONES.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => interactuar(a.id)}
            className="flex flex-col items-center gap-1 rounded-[14px] border border-[#E3EAFB] bg-white py-2 text-tinta transition-transform active:scale-90"
          >
            <span className="text-[20px]">{a.emoji}</span>
            <span className="text-[10.5px] font-bold">{a.label}</span>
          </button>
        ))}
      </div>

      {/* Personalización */}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={() => setPanel(panel === "especie" ? null : "especie")}
          className="flex-1 rounded-full border border-[#DCE3F4] bg-white py-1.5 text-[12px] font-bold text-azul active:scale-95"
        >
          🐾 Elegir mascota
        </button>
        <button
          type="button"
          onClick={() => setPanel(panel === "accesorio" ? null : "accesorio")}
          className="flex-1 rounded-full border border-[#DCE3F4] bg-white py-1.5 text-[12px] font-bold text-azul active:scale-95"
        >
          🎀 Accesorio
        </button>
      </div>

      {/* Panel: nombre */}
      {panel === "nombre" && (
        <div className="mt-2.5 flex gap-2">
          <input
            autoFocus
            defaultValue={estado.nombre}
            maxLength={16}
            placeholder={`¿Cómo se llama? (${especie.nombre})`}
            onChange={(e) => actualizar({ nombre: e.target.value })}
            className="flex-1 rounded-[12px] border border-[#DCE3F4] px-3 py-2 text-[13.5px] outline-none focus:border-azul"
          />
          <button
            type="button"
            onClick={() => setPanel(null)}
            className="rounded-[12px] bg-azul px-4 py-2 text-[13px] font-bold text-white active:scale-95"
          >
            Listo
          </button>
        </div>
      )}

      {/* Panel: elegir especie */}
      {panel === "especie" && (
        <div className="mt-2.5 grid grid-cols-4 gap-2">
          {ESPECIES.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                actualizar({ especie: e.id });
                setPanel(null);
              }}
              className={`flex flex-col items-center gap-1 rounded-[14px] border py-2 transition-transform active:scale-90 ${
                estado.especie === e.id ? "border-azul bg-[#EEF3FF]" : "border-[#E3EAFB] bg-white"
              }`}
            >
              <span className="text-[22px]">{e.emoji}</span>
              <span className="text-[10px] font-bold text-tinta">{e.nombre}</span>
            </button>
          ))}
        </div>
      )}

      {/* Panel: accesorio (se desbloquean por nivel) */}
      {panel === "accesorio" && (
        <div className="mt-2.5 grid grid-cols-5 gap-2">
          {accDisponibles.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                actualizar({ accesorio: a.id });
                setPanel(null);
              }}
              className={`flex flex-col items-center gap-1 rounded-[13px] border py-2 transition-transform active:scale-90 ${
                estado.accesorio === a.id ? "border-azul bg-[#EEF3FF]" : "border-[#E3EAFB] bg-white"
              }`}
            >
              <span className="text-[18px]">{a.emoji}</span>
              <span className="text-[9px] font-bold text-gris">{a.nombre}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
