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
  /** Ya cerró su jornada de hoy → la base quedó SELLADA con su rendición y el
   *  servidor rechaza el cambio. Saberlo ANTES evita tipear al pepe y, sobre todo,
   *  evita la sospecha: bajarle la base a alguien después de contarle la plata es
   *  la forma de fabricarle un faltante, y por eso la base se congela al rendir. */
  yaRindio?: boolean;
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

  /** Filtro por nombre: con 47 cobradores, encontrar a uno para corregirle el
   *  monto era scrollear. Solo filtra la VISTA; lo tipeado en los ocultos se
   *  guarda igual (por eso el botón dice cuántos cambios hay en total). */
  const [q, setQ] = useState("");
  /** Fotos previas para DESHACER: aplicar a todos pisa lo tipeado, y sin vuelta
   *  atrás eso es un botón que da miedo tocar. */
  const [pila, setPila] = useState<{ vals: Record<string, string>; ceros: Set<string> }[]>([]);
  /** Declarados EXPLÍCITAMENTE en $0 ("hoy arranca sin base"). Un campo vacío y un
   *  cero declarado se ven igual y NO son lo mismo: uno es "nadie la cargó" y el
   *  otro es "salió sin plata", que es una decisión con dueño. La invariante que
   *  reclama las bases sin rendir necesita esa diferencia para no gritar al pedo. */
  const [ceros, setCeros] = useState<Set<string>>(new Set());

  const parsed = (id: string) => Math.max(0, Math.round(Number(vals[id]) || 0));
  const grupos = useMemo(() => agrupar(cobradores, supervisoresPorZona), [cobradores, supervisoresPorZona]);
  // Total EN VIVO (lo que va tipeado), no solo lo ya guardado: el supervisor ve
  // cuánta plata está por poner en la calle ANTES de confirmar.
  const total = cobradores.reduce((s, c) => s + parsed(c.id), 0);
  const editables = cobradores.filter((c) => !c.yaRindio);
  // ⚠️ "FALTA CARGAR" NO ES "EL MONTO ES CERO". `ceros` vive solo en este montaje
  // de React: al recargar la página se pierde, y una base declarada en $0 —que ESTÁ
  // guardada, con nombre y hora— volvía a contarse como faltante. Con los 52 en cero
  // el cartel decía "Ninguna base cargada todavía" arriba de 52 filas que dicen
  // "base cargada por vos". La verdad persistida es `origen`, que distingue
  // "alguien la declaró" de "nadie la cargó" — que es justamente para lo que existe.
  const declarada = (c: CobradorBase) => c.origen === "cargada" || ceros.has(c.id);
  const sinCargar = editables.filter((c) => parsed(c.id) <= 0 && !declarada(c)).length;
  // Un cambio es: un monto distinto al guardado, o un $0 DECLARADO sobre alguien
  // que todavía no tenía base. Los que ya rindieron no entran: el servidor los
  // rechaza y contarlos haría que el botón prometa lo que no puede hacer.
  const cambios = editables.filter(
    (c) => parsed(c.id) !== c.base || (ceros.has(c.id) && c.origen !== "cargada"),
  );
  const hayAyer = cobradores.some((c) => (c.baseAyer ?? 0) > 0);
  const listas = editables.length - sinCargar;
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const visible = (c: CobradorBase) => !q.trim() || norm(c.nombre).includes(norm(q.trim()));

  /** Guarda una foto antes de pisar valores, para poder volver. */
  const conDeshacer = (fn: (v: Record<string, string>) => Record<string, string>) => {
    setMsg(null);
    // Se guarda TAMBIÉN el set de ceros declarados: si solo se revirtieran los
    // montos, "Deshacer" dejaba los campos vacíos con el semáforo en verde
    // diciendo "las 52 bases están cargadas". Una pantalla inconsistente sobre
    // plata es peor que no tener el botón.
    setPila((p) => [...p.slice(-4), { vals, ceros }]);
    setVals(fn);
  };
  const deshacer = () => {
    const previo = pila[pila.length - 1];
    if (!previo) return;
    setPila((p) => p.slice(0, -1));
    setVals(previo.vals);
    setCeros(previo.ceros);
    setMsg(null);
  };

  const usarAyer = () =>
    conDeshacer((v) => {
      const n = { ...v };
      for (const c of editables) {
        // Solo llena los VACÍOS: no pisa un monto ya tipeado hoy.
        if ((Number(n[c.id]) || 0) <= 0 && (c.baseAyer ?? 0) > 0) n[c.id] = String(c.baseAyer);
      }
      return n;
    });

  // ── CARGA MASIVA: el mismo monto para todos, de un toque ─────────────────
  //  A las 7 de la mañana el supervisor entrega el MISMO efectivo de arranque a
  //  casi todo el equipo. Tipear 18 veces el mismo número, con el equipo esperando
  //  en la puerta, es la razón por la que la base no se carga: el 06-08 se cargaron
  //  10 de 47, y los otros 5 días del piloto NINGUNA. Un monto + un toque.
  const [montoTodos, setMontoTodos] = useState("");
  /** ⚠️ EL CERO TAMBIÉN ES UN MONTO. La primera versión salía con `if (m <= 0) return`
   *  y dejaba fuera justo el caso que el negocio necesita: "mañana TODOS arrancan sin
   *  efectivo". Con 47 cobradores eso eran 47 toques del botón "sin base", uno por
   *  fila — o sea, el mismo trabajo manual que esta herramienta vino a borrar, y la
   *  razón medida por la que las bases no se cargaban. Escribir 0 y tocar "A los 47"
   *  tiene que declarar los 47 en cero, con dueño y con auditoría. */
  const aplicarATodos = (soloVacios: boolean, forzado?: string) => {
    // El monto llega EXPLÍCITO cuando lo dispara un botón con valor propio: leerlo
    // del estado ahí devolvería el valor viejo (setState no es inmediato) y el
    // "Todos en $0" habría aplicado lo que hubiera escrito antes. Con plata, un
    // botón que hace algo distinto de lo que dice su etiqueta no es aceptable.
    const txt = (forzado ?? montoTodos).trim();
    if (txt === "") return; // vacío ≠ cero: sin número no se hace nada
    const m = Math.max(0, Math.round(Number(txt) || 0));
    conDeshacer((v) => {
      const n = { ...v };
      for (const c of editables) {
        if (soloVacios && (Number(n[c.id]) || 0) > 0) continue;
        n[c.id] = String(m);
      }
      return n;
    });
    // Un cero aplicado en masa es una DECLARACIÓN ("hoy salen sin base"), igual que
    // el botón por fila: se marcan todos los alcanzados para que el guardado los
    // mande y no los confunda con "el campo quedó vacío".
    if (m === 0) {
      setCeros((s) => {
        const n = new Set(s);
        for (const c of editables) {
          if (soloVacios && parsed(c.id) > 0) continue;
          n.add(c.id);
        }
        return n;
      });
    }
  };

  /** "Hoy sale sin base": un $0 con dueño, distinto de un campo que nadie llenó. */
  const declararCero = (id: string) => {
    setMsg(null);
    setVals((v) => ({ ...v, [id]: "0" }));
    setCeros((s) => new Set(s).add(id));
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
          {sinCargar > 0 ? (
            <span className="mt-1 w-fit rounded-full bg-ambar-suave px-2.5 py-1 text-[11px] font-bold text-ambar-osc tabular-nums">
              ⚠️ {sinCargar === editables.length
                ? "Ninguna base cargada todavía — fijalas antes de que salga el equipo."
                : `${listas} lista${listas === 1 ? "" : "s"} · faltan ${sinCargar}`}
            </span>
          ) : (
            <span className="mt-1 w-fit rounded-full bg-verde-suave px-2.5 py-1 text-[11px] font-bold text-verde tabular-nums">
              ✓ Las {editables.length} bases están cargadas
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
            <div className="flex items-center gap-1 rounded-[12px] border border-borde bg-tarjeta px-2">
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
              disabled={pend || montoTodos.trim() === ""}
              className="min-h-9 rounded-full bg-azul px-3.5 text-[12px] font-bold text-white disabled:opacity-40"
            >
              A los {editables.length}
            </button>
            {sinCargar > 0 && sinCargar < editables.length && (
              <button
                type="button"
                onClick={() => aplicarATodos(true)}
                disabled={pend || montoTodos.trim() === ""}
                className="min-h-9 rounded-full border border-borde bg-tarjeta px-3.5 text-[12px] font-bold text-cuerpo disabled:opacity-40"
              >
                Solo a los {sinCargar} sin base
              </button>
            )}
            {/* El caso "hoy salen todos sin efectivo", que es una decisión frecuente
                del negocio y no un error de tipeo: un toque, sin escribir nada. */}
            <button
              type="button"
              onClick={() => {
                setMontoTodos("0");
                aplicarATodos(false, "0");
              }}
              disabled={pend}
              className="min-h-9 rounded-full border border-borde bg-tarjeta px-3.5 text-[12px] font-bold text-cuerpo disabled:opacity-40"
              title="Dejar constancia de que hoy el equipo arranca sin efectivo"
            >
              Todos en $0
            </button>
            {/* Aplicar a todos PISA lo que ya estaba tipeado. Sin vuelta atrás es un
                botón que da miedo tocar, y el que da miedo no se usa. */}
            {pila.length > 0 && (
              <button
                type="button"
                onClick={deshacer}
                disabled={pend}
                className="min-h-9 rounded-full border border-borde bg-tarjeta px-3 text-[12px] font-bold text-cuerpo disabled:opacity-40"
              >
                ↶ Deshacer
              </button>
            )}
            <span className="ml-auto text-[11px] font-medium text-tenue">
              Después corregís uno por uno · <b>Enter</b> salta al siguiente
            </span>
          </div>

          {/* Con 47 cobradores, encontrar a uno para corregirle el monto era
              scrollear. Filtra la VISTA; lo tipeado en los ocultos se guarda igual. */}
          {cobradores.length > 8 && (
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="🔍 Buscar cobrador…"
              className="w-full rounded-[12px] border border-borde bg-tarjeta px-3 py-2 text-[16px] outline-none focus:border-azul"
            />
          )}

          <div className="flex flex-col gap-2">
            {grupos.map((g) => {
              const subtotal = g.cobradores.reduce((s, c) => s + parsed(c.id), 0);
              const visibles = g.cobradores.filter(visible);
              if (visibles.length === 0) return null;
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
                    {visibles.map((c) => {
                      const cambiado =
                        !c.yaRindio && (parsed(c.id) !== c.base || (ceros.has(c.id) && c.origen !== "cargada"));
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

                          {/* ⚠️ YA RINDIÓ: la base quedó SELLADA con su rendición y el
                              servidor rechaza el cambio. Antes se descubría recién al
                              guardar. Se congela acá y se dice por qué — porque
                              bajarle la base a alguien después de contarle la plata es
                              justamente cómo se le fabrica un faltante. */}
                          {c.yaRindio ? (
                            <span className="flex flex-shrink-0 items-center gap-2">
                              <span className="text-[13px] font-bold text-tinta tabular-nums">{UYU(c.base)}</span>
                              <span className="rounded-full bg-suave px-2 py-1 text-[10px] font-bold text-gris">
                                🔒 ya rindió
                              </span>
                            </span>
                          ) : (
                            <></>
                          )}
                          {cambiado && (
                            <span aria-hidden className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#E8A317]" title="Sin guardar" />
                          )}
                          {/* "Sale sin base": un $0 CON DUEÑO. Un campo vacío y un cero
                              declarado se ven igual y no son lo mismo — uno es "nadie
                              la cargó" y el otro es una decisión. */}
                          {!c.yaRindio && parsed(c.id) <= 0 && !declarada(c) && (
                            <button
                              type="button"
                              onClick={() => declararCero(c.id)}
                              className="flex-shrink-0 rounded-full border border-borde px-2 py-1 text-[10.5px] font-bold text-gris"
                              title="Dejar constancia de que hoy arranca sin efectivo"
                            >
                              sin base
                            </button>
                          )}
                          {/* Copiar SU base de ayer, sin tocar las de los demás:
                              casi siempre es la misma y así no hay que tipearla. */}
                          {!c.yaRindio && (c.baseAyer ?? 0) > 0 && parsed(c.id) !== c.baseAyer && (
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
                          {!c.yaRindio && (
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
                              className="w-28 rounded-[12px] border border-borde px-2.5 py-1.5 text-right text-[16px] tabular-nums outline-none focus:border-azul"
                            />
                          )}
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
