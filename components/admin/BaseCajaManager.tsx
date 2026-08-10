"use client";
// Base de caja del día (gestor): con cuánto efectivo arranca cada cobrador (0105).
// AGRUPADA por ZONA → supervisor → cobradores, con subtotal por zona. La RLS
// acota al supervisor a su zona. Es efectivo bajo custodia que el cobrador
// DEVUELVE al cerrar (esperado = base + recaudado − gastos).
//
// Rediseño 08-05 (el flujo tiene que ser FLUIDO a las 7 de la mañana):
//  · UN solo botón "Guardar todas" (antes: 14 taps con 14 recargas de la
//    página pesada de la jornada — el equipo esperando en la puerta).
//  · "Usar las de ayer": la base suele repetirse día a día → prellena.
//  · Solo se envían las filas que CAMBIARON (una corrección al mediodía no
//    re-escribe las otras 13).
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAperturasLote } from "@/lib/acciones/aperturas";
import { UYU } from "@/lib/format";

export interface CobradorBase {
  id: string;
  nombre: string;
  zonaId: string | null;
  zonaNombre: string | null;
  base: number;
  /** Base que arrancó AYER (prellenado de "Usar las de ayer"). */
  baseAyer?: number;
  /** De dónde salió la base de hoy: la cargó el supervisor, o vino sola de la
   *  cuadra de ayer (regla: la caja final amanece como base). */
  origen?: "cargada" | "arrastre" | "sin_base";
  /** Solo con `arrastre`: el día del que viene y cómo se llegó al número. */
  desdeFecha?: string;
  detalleAyer?: { base: number; recaudado: number; gastos: number; entregado: number; colocado: number };
}

const SIN_ZONA = "__sin_zona__";

type Grupo = {
  clave: string;
  zonaNombre: string;
  supervisores: string[];
  cobradores: CobradorBase[];
};

/** Agrupa los cobradores por zona, ordenado por nombre de zona. */
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
      };
      map.set(clave, g);
    }
    g.cobradores.push(c);
  }
  for (const g of map.values()) g.cobradores.sort((a, b) => a.nombre.localeCompare(b.nombre));
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
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(cobradores.map((c) => [c.id, c.base > 0 ? String(c.base) : ""])),
  );
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pend, start] = useTransition();

  const parsed = (id: string) => Math.max(0, Math.round(Number(vals[id]) || 0));
  const grupos = useMemo(() => agrupar(cobradores, supervisoresPorZona), [cobradores, supervisoresPorZona]);
  // Total EN VIVO (lo que va tipeado), no solo lo ya guardado: el supervisor ve
  // cuánta plata está por poner en la calle ANTES de confirmar.
  const total = cobradores.reduce((s, c) => s + parsed(c.id), 0);
  const sinCargar = cobradores.filter((c) => parsed(c.id) <= 0).length;
  const cambios = cobradores.filter((c) => parsed(c.id) !== c.base);
  const hayAyer = cobradores.some((c) => (c.baseAyer ?? 0) > 0);

  const usarAyer = () => {
    setMsg(null);
    setVals((v) => {
      const n = { ...v };
      for (const c of cobradores) {
        // Solo llena los VACÍOS: no pisa un monto ya tipeado hoy.
        if ((Number(n[c.id]) || 0) <= 0 && (c.baseAyer ?? 0) > 0) n[c.id] = String(c.baseAyer);
      }
      return n;
    });
  };

  // ── CARGA MASIVA: el mismo monto para todos, de un toque ─────────────────
  //  A las 7 de la mañana el supervisor entrega el MISMO efectivo de arranque a
  //  casi todo el equipo. Tipear 18 veces el mismo número, con el equipo esperando
  //  en la puerta, es la razón por la que la base no se carga: el 06-08 se cargaron
  //  10 de 47, y los otros 5 días del piloto NINGUNA. Un monto + un toque.
  const [montoTodos, setMontoTodos] = useState("");
  const aplicarATodos = (soloVacios: boolean) => {
    const m = Math.max(0, Math.round(Number(montoTodos) || 0));
    if (m <= 0) return;
    setMsg(null);
    setVals((v) => {
      const n = { ...v };
      for (const c of cobradores) {
        if (soloVacios && (Number(n[c.id]) || 0) > 0) continue;
        n[c.id] = String(m);
      }
      return n;
    });
  };

  /** Enter salta al siguiente campo: cargar de a uno sin soltar el teclado. */
  const saltarAlSiguiente = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const inputs = [...(e.currentTarget.closest("section")?.querySelectorAll<HTMLInputElement>("input[data-base]") ?? [])];
    const i = inputs.indexOf(e.currentTarget);
    (inputs[i + 1] ?? inputs[0])?.focus();
    inputs[i + 1]?.select();
  };

  const guardarTodas = () =>
    start(async () => {
      setMsg(null);
      const items = cambios.map((c) => ({ cobradorId: c.id, base: parsed(c.id) }));
      if (items.length === 0) {
        setMsg({ ok: true, texto: "No hay cambios para guardar." });
        return;
      }
      try {
        const r = await setAperturasLote({ items });
        if (!r.ok) {
          setMsg({ ok: false, texto: r.error });
          return;
        }
        const extra =
          r.rechazadas.length > 0
            ? ` · ${r.rechazadas.length} no (ya cerraron su jornada)`
            : "";
        setMsg({ ok: true, texto: `✓ ${r.guardadas} base${r.guardadas === 1 ? "" : "s"} guardada${r.guardadas === 1 ? "" : "s"}${extra}` });
        router.refresh();
      } catch {
        setMsg({ ok: false, texto: "Sin conexión: no se guardó. Probá de nuevo." });
      }
    });

  return (
    <section className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13.5px] font-extrabold text-tinta">💵 Base de caja de hoy</span>
          <span className="text-[11px] font-medium text-tenue">
            Con cuánto efectivo arranca cada cobrador. La devuelve junto con lo cobrado al cerrar.
          </span>
          {sinCargar > 0 && (
            <span className="mt-1 w-fit rounded-full bg-ambar-suave px-2.5 py-1 text-[11px] font-bold text-ambar-osc">
              ⚠️ {sinCargar === cobradores.length
                ? "Ninguna base cargada todavía — fijalas antes de que salga el equipo."
                : `${sinCargar} cobrador${sinCargar === 1 ? "" : "es"} sin base.`}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] font-bold uppercase tracking-wide text-gris">En la calle</span>
          <span className="text-[16px] font-black tabular-nums text-[#1E47C8]">{UYU(total)}</span>
        </div>
      </div>

      {cobradores.length === 0 ? (
        <p className="py-2 text-center text-[12px] font-medium text-gris">No hay cobradores en tu alcance.</p>
      ) : (
        <>
          {/* ⚠️ LA CARGA MASIVA. A las 7 de la mañana casi todo el equipo arranca con
              el MISMO efectivo, y tipear 18 veces el mismo número con la gente
              esperando en la puerta es la razón por la que la base no se carga: el
              06-08 se cargaron 10 de 47, y los otros cinco días del piloto, ninguna.
              Un monto y un toque. */}
          <div className="flex flex-wrap items-center gap-2 rounded-[12px] bg-suave px-3 py-2.5">
            <span className="text-[11.5px] font-bold text-cuerpo">Ponerle a todos</span>
            <div className="flex items-center gap-1 rounded-[9px] border border-borde bg-tarjeta px-2">
              <span className="text-[13px] font-bold text-gris">$</span>
              <input
                inputMode="numeric"
                value={montoTodos}
                onChange={(e) => setMontoTodos(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="0"
                className="w-24 bg-transparent py-1.5 text-right text-[16px] font-bold tabular-nums outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => aplicarATodos(false)}
              disabled={pend || !(Number(montoTodos) > 0)}
              className="min-h-9 rounded-full bg-azul px-3.5 text-[12px] font-bold text-white disabled:opacity-40"
            >
              A los {cobradores.length}
            </button>
            {sinCargar > 0 && sinCargar < cobradores.length && (
              <button
                type="button"
                onClick={() => aplicarATodos(true)}
                disabled={pend || !(Number(montoTodos) > 0)}
                className="min-h-9 rounded-full border border-borde bg-tarjeta px-3.5 text-[12px] font-bold text-cuerpo disabled:opacity-40"
              >
                Solo a los {sinCargar} sin base
              </button>
            )}
            <span className="ml-auto text-[11px] font-medium text-tenue">
              Después podés corregir uno por uno · <b>Enter</b> salta al siguiente
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {grupos.map((g) => {
              const subtotal = g.cobradores.reduce((s, c) => s + parsed(c.id), 0);
              return (
                <details key={g.clave} open className="group rounded-[12px] border border-linea">
                  <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[12px] bg-suave px-3 py-2 select-none">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[12.5px] font-extrabold text-tinta">📍 {g.zonaNombre}</span>
                      <span className="truncate text-[10.5px] font-medium text-tenue">
                        {g.supervisores.length ? `Sup: ${g.supervisores.join(", ")}` : "Sin supervisor"} · {g.cobradores.length} cobr.
                      </span>
                    </div>
                    <div className="ml-auto flex items-center gap-1.5">
                      <span className="text-[13px] font-black tabular-nums text-tinta">{UYU(subtotal)}</span>
                      <span aria-hidden className="text-[10px] text-gris transition-transform group-open:rotate-90">▶</span>
                    </div>
                  </summary>
                  <ul className="flex flex-col divide-y divide-linea px-3">
                    {g.cobradores.map((c) => {
                      const cambiado = parsed(c.id) !== c.base;
                      return (
                        <li key={c.id} className="flex items-center gap-2 py-2.5">
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-[13px] font-semibold text-tinta">{c.nombre}</span>
                            {/* De dónde salió el número que está viendo. Sin esto el
                                supervisor no puede distinguir "esta plata se la di yo"
                                de "esto es lo que le quedó ayer" — que es justo lo que
                                tiene que saber ANTES de recibirle el efectivo. */}
                            {c.origen === "arrastre" && c.detalleAyer ? (
                              <span className="text-[10px] leading-[1.35] font-medium text-[#8A6D1E] tabular-nums">
                                {/* La cuenta COMPLETA, empezando por la base de ese
                                    día: sin ella los números no cerraban y el
                                    supervisor no podía seguir de dónde salió. */}
                                🔁 le quedó de {c.desdeFecha ?? "ayer"}: base {UYU(c.detalleAyer.base)}
                                {" + cobró "}{UYU(c.detalleAyer.recaudado)}
                                {c.detalleAyer.gastos > 0 && ` − gastos ${UYU(c.detalleAyer.gastos)}`}
                                {c.detalleAyer.colocado > 0 && ` − colocó ${UYU(c.detalleAyer.colocado)}`}
                                {" − entregó "}{UYU(c.detalleAyer.entregado)}
                              </span>
                            ) : c.origen === "cargada" ? (
                              <span className="text-[10px] font-medium text-[#157A50] tabular-nums">
                                ✓ base cargada por vos
                              </span>
                            ) : (c.baseAyer ?? 0) > 0 ? (
                              <span className="text-[10px] font-medium text-tenue tabular-nums">
                                ayer {UYU(c.baseAyer!)}
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium text-tenue">arranca sin base</span>
                            )}
                          </div>
                          {cambiado && (
                            <span aria-hidden className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#E8A317]" title="Sin guardar" />
                          )}
                          {/* Copiar SU base de ayer, sin tocar las de los demás:
                              casi siempre es la misma y así no hay que tipearla. */}
                          {(c.baseAyer ?? 0) > 0 && parsed(c.id) !== c.baseAyer && (
                            <button
                              type="button"
                              onClick={() => {
                                setMsg(null);
                                setVals((v) => ({ ...v, [c.id]: String(c.baseAyer) }));
                              }}
                              className="flex-shrink-0 rounded-full border border-borde px-2 py-1 text-[10.5px] font-bold text-cuerpo tabular-nums"
                              title={`Poner ${UYU(c.baseAyer!)}, la de ayer`}
                            >
                              = ayer
                            </button>
                          )}
                          <input
                            data-base
                            inputMode="numeric"
                            value={vals[c.id] ?? ""}
                            onChange={(e) => {
                              setMsg(null);
                              setVals((v) => ({ ...v, [c.id]: e.target.value.replace(/[^\d]/g, "") }));
                            }}
                            onFocus={(e) => e.currentTarget.select()}
                            onKeyDown={saltarAlSiguiente}
                            placeholder="0"
                            className="w-28 rounded-[9px] border border-borde px-2.5 py-1.5 text-right text-[16px] tabular-nums outline-none focus:border-azul"
                          />
                        </li>
                      );
                    })}
                  </ul>
                </details>
              );
            })}
          </div>

          {/* Barra de acciones: TODO se guarda de un toque. */}
          <div className="flex flex-wrap items-center gap-2">
            {hayAyer && (
              <button
                type="button"
                onClick={usarAyer}
                disabled={pend}
                className="min-h-10 rounded-full border border-borde bg-tarjeta px-3.5 text-[12px] font-bold text-cuerpo disabled:opacity-50"
              >
                ↩️ Usar las de ayer
              </button>
            )}
            <button
              type="button"
              onClick={guardarTodas}
              disabled={pend || cambios.length === 0}
              className="min-h-10 flex-1 rounded-full bg-azul px-4 text-[13px] font-extrabold text-white disabled:opacity-50"
            >
              {pend
                ? "Guardando…"
                : cambios.length > 0
                  ? `💾 Guardar ${cambios.length === cobradores.length ? "todas" : cambios.length === 1 ? "1 base" : `${cambios.length} bases`}`
                  : "Sin cambios"}
            </button>
          </div>
          {msg && (
            <p className={`text-[12px] leading-[1.4] font-bold ${msg.ok ? "text-verde" : "text-[#C0392B]"}`}>
              {msg.ok ? "" : "✗ "}{msg.texto}
            </p>
          )}
        </>
      )}
    </section>
  );
}
