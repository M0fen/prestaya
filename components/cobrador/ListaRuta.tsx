"use client";
// Lista de la ruta del cobrador con CUATRO órdenes: "Mi orden" (el recorrido que
// el cobrador se armó y GUARDÓ — asignaciones.orden, 0132), cercanía (GPS,
// vecino más cercano), prioridad de cobro y A-Z. Los ya cobrados / no-pago bajan
// al final. Progressive enhancement: sin permiso o sin JS, queda el orden del
// servidor (por nombre).
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ordenarPorCercania } from "@/lib/ruta";
import { guardarOrdenRuta } from "@/lib/acciones/preferenciasCobrador";
import type { EstadoHoy } from "@/lib/data/ruta";
import { UYU } from "@/lib/format";
import { OjitoCliente } from "./OjitoCliente";
import { CobroRapido } from "./CobroRapido";

export interface ItemRutaVista {
  id: string;
  nombre: string;
  direccion: string | null;
  /** Cédula: el dato que el cliente muestra y que no admite errores de tipeo.
   *  Buscar solo por nombre obligaba a adivinar cómo quedó escrito en la
   *  importación de Disapp ("GONSALEZ" vs "GONZÁLEZ"). */
  documento?: string | null;
  cuota: number;
  estadoHoy: EstadoHoy;
  /** Abonado HOY (para mostrar el parcial en el chip "Abonó $X"). */
  pagadoHoy: number;
  lat: number | null;
  lng: number | null;
  /** Calificación del cliente (para el orden por prioridad de cobro). */
  calificacion: string;
  /** Cartera vencida: todos sus créditos activos pasaron el plazo. Visible para
   *  recuperar, pero fuera del target/orden del día (no cuenta como "pendiente"). */
  plazoVencido?: boolean;
  /** Plata recuperada hoy sobre este cliente de cartera vencida (0 = no). Se muestra
   *  para que el cobrador no lo re-visite (su cobro no cuenta en la cuota del día). */
  recuperadoHoy?: number;
  /** Posición guardada en el recorrido del cobrador (asignaciones.orden, 0132).
   *  null = sin ordenar → va al final del "Mi orden", por nombre. */
  orden?: number | null;
  /** Al día y SIN cuota que venza hoy → chip "Hoy no toca" (no "Cobrado"). Aplica
   *  a cualquier frecuencia: el semanal entre cuotas, y también el DIARIO los
   *  domingos o cuando pagó por adelantado (06-08). */
  sinCuotaHoy?: boolean;
  /** Crédito al que se imputa el cobro rápido. null = no hay uno solo claro. */
  prestamoId?: string | null;
  /** Cuántos créditos activos PROPIOS tiene. Con más de uno, el cobro de un toque
   *  no aparece: elegir a cuál se imputa es una decisión, no un atajo. */
  creditosPropios?: number;
  /** La cuota_diaria del crédito. Si difiere de `cuota` (el objetivo de hoy), el
   *  atajo no se ofrece: el botón diría un número y el libro registraría otro. */
  cuotaCredito?: number;
  /** De `cuota`, cuánto es ATRASO de días anteriores. Si `atraso === cuota`, hoy
   *  no le vence nada pero debe: se muestra "Atrasado", no como cuota del día. */
  atraso?: number;
}

// Peso de prioridad: cobrar PRIMERO a los de mayor riesgo (menor peso = antes).
const PRIO: Record<string, number> = { riesgo: 0, regular: 1, nuevo: 2, bueno: 3, excelente: 4 };
const pesoPrio = (c: string): number => PRIO[c] ?? 2;

// `barra` = franja de color a la izquierda de la tarjeta (jerarquía de un vistazo).
const CHIP: Record<EstadoHoy, { label: string; bg: string; fg: string; barra: string }> = {
  pagado: { label: "Cobrado", bg: "#E4F5EC", fg: "#157A50", barra: "#1FA971" },
  abono: { label: "Abonó", bg: "#FDF3E2", fg: "#B9770E", barra: "#E8A317" },
  no_pago: { label: "No pago", bg: "#FBE4E2", fg: "#C0392B", barra: "#D64545" },
  pendiente: { label: "Pendiente", bg: "#EEF1F8", fg: "#6B7494", barra: "#C7D0E4" },
  sin_credito: { label: "Sin crédito", bg: "#F2F0FA", fg: "#7A6BA8", barra: "#C9BEE6" },
};

/** Una parada "cerrada" (ya visitada: cobró, abonó parcial o marcó no-pago) baja al final. */
const cerrado = (e: EstadoHoy): boolean => e === "pagado" || e === "abono" || e === "no_pago";

type Origen = { lat: number; lng: number } | null;

// Cuántas paradas se muestran antes de plegar el resto.
const TOPE_RUTA = 7;

// Normaliza para buscar sin distinguir mayúsculas ni acentos.
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").split("").filter((c) => {
    const n = c.charCodeAt(0);
    return n < 0x300 || n > 0x36f;
  }).join("");

// Orden "Mi recorrido": posición guardada primero (menor arriba); los sin
// posición van al final, en el orden del servidor (por nombre).
function porMiOrden<T extends { orden?: number | null }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => (a.orden ?? Infinity) - (b.orden ?? Infinity));
}

export function ListaRuta({ items, cobradorId }: { items: ItemRutaVista[]; cobradorId?: string | null }) {
  const [origen, setOrigen] = useState<Origen>(null);
  // Cuántos clientes tienen ubicación guardada. HOY el 93% NO la tiene: ordenar
  // "por cercanía" con eso numera 1,2,3 a los poquitos con GPS y manda al fondo
  // a todos los demás — una ruta física falsa, presentada como si fuera real.
  // Si la mayoría no tiene ubicación, el orden por defecto NO es cercanía.
  const nConUbicacion = useMemo(
    () => items.filter((i) => i.lat != null && i.lng != null).length,
    [items],
  );
  const gpsPobre = items.length > 0 && nConUbicacion / items.length < 0.5;
  // ¿El cobrador ya se armó su recorrido? Entonces ESE es el orden por defecto:
  // la ruta abre como él la dejó, sin tocar nada (decisión 08-05).
  const hayOrdenGuardado = items.some((i) => i.orden != null);
  const [modo, setModo] = useState<"ruta" | "cercania" | "prioridad" | "nombre">(
    hayOrdenGuardado ? "ruta" : gpsPobre ? "prioridad" : "cercania",
  );
  // Editor del recorrido: lista completa de ids en el orden que se está armando.
  const [editando, setEditando] = useState<string[] | null>(null);
  const [guardando, startGuardar] = useTransition();
  const [errorOrden, setErrorOrden] = useState<string | null>(null);
  // Buscador DENTRO del editor (QA 08-05): con 97 clientes, llevar al del fondo
  // a la primera parada eran decenas de taps. Buscás, ⏫ y listo.
  const [qEdit, setQEdit] = useState("");
  const router = useRouter();
  const [estadoGeo, setEstadoGeo] = useState<"idle" | "pidiendo" | "ok" | "no">("idle");
  const [verTodos, setVerTodos] = useState(false);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "pendiente" | "cobrado" | "no_pago">("todos");

  // Conteos por estado (para las chips) — la pregunta central del cobrador en la
  // calle es "¿a quién me falta cobrar?".
  const cuenta = useMemo(
    () => ({
      todos: items.length,
      // La cartera vencida no cuenta en las cuentas del DÍA (coincide con el arqueo,
      // que la excluye por completo): ni pendiente, ni cobrado, ni no-pago.
      // Los "Hoy no toca" (semanal sin cuota hoy) tampoco: no son cobros.
      pendiente: items.filter((i) => i.estadoHoy === "pendiente" && !i.plazoVencido).length,
      cobrado: items.filter((i) => (i.estadoHoy === "pagado" || i.estadoHoy === "abono") && !i.plazoVencido && !i.sinCuotaHoy).length,
      no_pago: items.filter((i) => i.estadoHoy === "no_pago" && !i.plazoVencido).length,
    }),
    [items],
  );

  const pedirUbicacion = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setEstadoGeo("no");
      return;
    }
    setEstadoGeo("pidiendo");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setOrigen({ lat: p.coords.latitude, lng: p.coords.longitude });
        setEstadoGeo("ok");
      },
      () => setEstadoGeo("no"),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  };

  // Intento al montar SOLO si el modo inicial es cercanía (QA 08-05): con GPS
  // pobre o recorrido guardado, el primer contacto del día 1 con la app era el
  // diálogo de permiso de ubicación tapando la ruta — sin que nada lo usara.
  // Al tocar "📍 Cercanía" se pide igual (ver onClick del toggle).
  useEffect(() => {
    if (modo === "cercania") pedirUbicacion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ordenados = useMemo(() => {
    // "Hoy no toca" (semanal sin cuota hoy) baja al fondo con los visitados:
    // no es una parada del día, pero sigue visible por si el cliente aparece.
    // SIN CRÉDITO también: la ficha está en su cartera pero HOY no hay nada que
    // cobrarle, así que no es una parada pendiente. Mezclarlos con los que sí
    // deben hacía que el cobrador contara mal su día y caminara de más (reporte
    // de campo 08-05, caso 9: "los no activos aparecen junto con los activos").
    const fueraDelDia = (i: ItemRutaVista) => !!i.sinCuotaHoy || i.estadoHoy === "sin_credito";
    const pendientes = items.filter((i) => !cerrado(i.estadoHoy) && !fueraDelDia(i));
    const cerrados = items.filter((i) => cerrado(i.estadoHoy) || fueraDelDia(i));
    let base = pendientes;
    if (modo === "ruta") base = porMiOrden(pendientes);
    else if (modo === "cercania" && origen) base = ordenarPorCercania(pendientes, origen);
    else if (modo === "prioridad")
      base = [...pendientes].sort((a, b) => pesoPrio(a.calificacion) - pesoPrio(b.calificacion));
    // "nombre" (o cercanía sin ubicación) → orden del servidor (por nombre).
    // Los cerrados también respetan "Mi orden" (se reconoce el recorrido aunque
    // ya estén cobrados); en los demás modos quedan como vienen.
    return [...base, ...(modo === "ruta" ? porMiOrden(cerrados) : cerrados)];
  }, [items, modo, origen]);
  // ¿Hay un orden de recorrido significativo (para numerar pasos + camino en Maps)?
  const ordenActivo =
    (modo === "ruta" && hayOrdenGuardado) || (modo === "cercania" && !!origen) || modo === "prioridad";

  // Filtro por estado (chips): recorta la ruta a la categoría elegida.
  const porEstado =
    filtro === "todos"
      ? ordenados
      : filtro === "cobrado"
        ? ordenados.filter((i) => (i.estadoHoy === "pagado" || i.estadoHoy === "abono") && !i.plazoVencido && !i.sinCuotaHoy)
        : ordenados.filter((i) => i.estadoHoy === filtro && !i.plazoVencido);

  // BUSCAR IGNORA LA CHIP: antes se buscaba dentro del filtro activo, así que
  // teclear el apellido del cliente que tenés ENFRENTE devolvía "ningún cliente
  // coincide" solo porque la chip "Pendientes" seguía puesta y a ese ya le
  // habías cobrado. El cobrador concluía que el cliente no era suyo. Cuando hay
  // término, se busca sobre TODA la ruta.
  const buscando = q.trim().length > 0;
  const filtrados = buscando
    ? ordenados.filter((i) => {
        // Nombre, dirección o CÉDULA. La cédula se compara sin puntos ni guiones
        // (la base convive con los dos formatos por el import de Disapp).
        const texto = `${norm(i.nombre ?? "")} ${norm(i.direccion ?? "")}`;
        if (texto.includes(norm(q))) return true;
        const soloDigitos = q.replace(/\D/g, "");
        return soloDigitos.length >= 3 && (i.documento ?? "").replace(/\D/g, "").includes(soloDigitos);
      })
    : porEstado;
  // Plegado: solo con "Todos" y sin búsqueda se pliega a TOPE_RUTA; con una chip
  // activa o buscando, se ve la lista completa de esa categoría.
  const sinPliegue = buscando || filtro !== "todos";
  const visibles = verTodos || sinPliegue ? filtrados : filtrados.slice(0, TOPE_RUTA);
  const restantes = filtrados.length - visibles.length;

  // Camino óptimo: link a Google Maps con las primeras ~10 paradas PENDIENTES en
  // el orden actual como waypoints (la última = destino). Sin dependencias ni backend.
  const conGps = ordenados.filter((i) => !cerrado(i.estadoHoy) && !i.plazoVencido && i.lat != null && i.lng != null).slice(0, 10);
  const mapsUrl =
    conGps.length > 0
      ? (() => {
          const pts = conGps.map((i) => `${i.lat},${i.lng}`);
          const destino = pts[pts.length - 1];
          const waypoints = pts.slice(0, -1).join("|");
          return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}${
            waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""
          }&travelmode=driving`;
        })()
      : null;

  // ── Editor del recorrido (0132): acomodar la ruta con ↑ / ↓ / al principio ──
  const itemDe = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const abrirEditor = () => {
    setErrorOrden(null);
    // Se parte del recorrido guardado (o del orden por nombre si no hay).
    setEditando(porMiOrden(items).map((i) => i.id));
  };
  const mover = (id: string, delta: number) => {
    setEditando((lista) => {
      if (!lista) return lista;
      const i = lista.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= lista.length) return lista;
      const n = [...lista];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  };
  const alPrincipio = (id: string) =>
    setEditando((lista) => (lista ? [id, ...lista.filter((x) => x !== id)] : lista));
  const guardarOrden = () => {
    if (!editando) return;
    setErrorOrden(null);
    startGuardar(async () => {
      try {
        const r = await guardarOrdenRuta({ clienteIds: editando });
        if (!r.ok) {
          setErrorOrden(r.error);
          return;
        }
        setEditando(null);
        setModo("ruta");
        router.refresh();
      } catch {
        setErrorOrden("No se pudo guardar (¿sin señal?). Probá de nuevo con conexión.");
      }
    });
  };

  if (editando) {
    const buscandoEdit = qEdit.trim().length > 0;
    const visiblesEdit = buscandoEdit
      ? editando.filter((id) => {
          const it = itemDe.get(id);
          return it && norm(`${it.nombre ?? ""} ${it.direccion ?? ""}`).includes(norm(qEdit));
        })
      : editando;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="flex flex-col">
            <span className="text-[14px] font-extrabold text-tinta">Acomodá tu recorrido</span>
            <span className="text-[11.5px] font-medium text-gris">
              El 1 es tu primera parada. Se guarda y la ruta abre así todos los días.
            </span>
          </div>
        </div>
        {/* Buscar y mandar al principio: la forma rápida de armar el recorrido. */}
        <input
          type="search"
          value={qEdit}
          onChange={(e) => setQEdit(e.target.value)}
          placeholder="🔍 Buscá un cliente y mandalo al principio…"
          className="rounded-[12px] border border-[#DCE3F4] bg-white px-3.5 py-2.5 text-[16px] outline-none focus:border-azul"
        />
        {buscandoEdit && visiblesEdit.length === 0 && (
          <p className="px-0.5 py-2 text-center text-[12px] font-medium text-[#8A93AD]">
            Nadie coincide con “{qEdit}”.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          {visiblesEdit.map((id) => {
            const it = itemDe.get(id);
            if (!it) return null;
            const idx = editando.indexOf(id);
            return (
              <div
                key={id}
                className="flex items-center gap-2 rounded-[14px] bg-white py-2 pr-2 pl-3 shadow-[0_1px_3px_rgba(26,34,71,0.05)]"
              >
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#0F1B3D] text-[12px] font-black text-white tabular-nums">
                  {idx + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13.5px] font-bold text-tinta">{it.nombre}</span>
                  <span className="truncate text-[11px] font-medium text-[#8A93AD]">
                    {it.direccion ?? "Sin dirección"}
                  </span>
                </div>
                {idx > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      alPrincipio(id);
                      setQEdit(""); // volver a la lista completa: se lo ve arriba de todo
                    }}
                    aria-label="Mover al principio"
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#EEF3FF] text-[14px] font-black text-azul active:scale-95"
                  >
                    ⏫
                  </button>
                )}
                {/* Con búsqueda activa, ↑/↓ mueven de a un lugar en la lista COMPLETA
                    (invisible) — confunde. Solo ⏫ mientras se busca. */}
                {!buscandoEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() => mover(id, -1)}
                      disabled={idx === 0}
                      aria-label="Subir"
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#EEF1F8] text-[15px] font-black text-tinta active:scale-95 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(id, 1)}
                      disabled={idx === editando.length - 1}
                      aria-label="Bajar"
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#EEF1F8] text-[15px] font-black text-tinta active:scale-95 disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {errorOrden && (
          <p className="px-0.5 text-[12px] font-semibold text-[#C0392B]">{errorOrden}</p>
        )}
        {/* Barra fija abajo: guardar/cancelar siempre a mano en listas largas. */}
        <div className="sticky bottom-20 z-30 flex gap-2 rounded-[16px] bg-white p-2 shadow-[0_-4px_18px_rgba(15,27,61,0.12)]">
          <button
            type="button"
            onClick={() => setEditando(null)}
            className="min-h-11 rounded-full border border-[#DCE3F4] bg-white px-4 text-[13px] font-bold text-gris active:scale-[0.98]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardarOrden}
            disabled={guardando}
            className="min-h-11 flex-1 rounded-full bg-[#1E47C8] px-4 text-[14px] font-extrabold text-white active:scale-[0.98] disabled:opacity-60"
          >
            {guardando ? "Guardando…" : "Guardar mi recorrido"}
          </button>
        </div>
      </div>
    );
  }

  const CHIPS: { id: typeof filtro; label: string; n: number }[] = [
    { id: "todos", label: "Todos", n: cuenta.todos },
    { id: "pendiente", label: "Pendientes", n: cuenta.pendiente },
    // "Con pago" (no "Cobrados") porque incluye los abonos parciales — así no choca
    // con el arqueo, que separa "Cobrados" de "Abonos".
    { id: "cobrado", label: "Con pago", n: cuenta.cobrado },
    { id: "no_pago", label: "No pago", n: cuenta.no_pago },
  ];

  return (
    <div className="flex flex-col gap-2">
      {/* Filtro por estado: la ruta segmentada de un toque. */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {CHIPS.map((f) => {
          const activo = filtro === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold tabular-nums transition-transform active:scale-95 ${
                activo ? "bg-[#2453DC] text-white" : "border border-[#DCE3F4] bg-white text-gris"
              }`}
            >
              {f.label}
              <span className={activo ? "text-white/85" : "text-[#8A93AD]"}> · {f.n}</span>
            </button>
          );
        })}
      </div>

      {/* Buscar cliente por nombre */}
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="🔍 Buscar por nombre, cédula o dirección…"
        className="rounded-[12px] border border-[#DCE3F4] bg-white px-3.5 py-2.5 text-[16px] outline-none focus:border-azul"
      />

      {/* Orden de la ruta (mi recorrido / cercanía / prioridad / A-Z) + Maps + editor */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
        <div className="flex gap-0.5 overflow-x-auto rounded-full bg-[#EEF1F8] p-0.5">
          {(
            [
              ["ruta", "📌 Mi orden"],
              ["cercania", estadoGeo === "pidiendo" ? "📍…" : "📍 Cercanía"],
              ["prioridad", "⚡ Prioridad"],
              ["nombre", "A-Z"],
            ] as const
          ).map(([id, label]) => {
            const activo = modo === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  if (id === "cercania" && !origen) pedirUbicacion();
                  // "Mi orden" sin recorrido guardado → derecho al editor a armarlo.
                  if (id === "ruta" && !hayOrdenGuardado) {
                    abrirEditor();
                    return;
                  }
                  setModo(id);
                }}
                className={`flex-shrink-0 rounded-full px-2.5 py-2 text-[12px] font-bold whitespace-nowrap transition-colors ${
                  activo ? "bg-white text-azul shadow-[0_1px_2px_rgba(26,34,71,0.12)]" : "text-gris"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={abrirEditor}
            className="rounded-full border border-[#DCE3F4] bg-white px-3 py-1.5 text-[11.5px] font-bold text-azul active:scale-95"
            style={{ transition: "transform .1s" }}
          >
            ✏️ Ordenar
          </button>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-[#1FA971] px-3 py-1.5 text-[11.5px] font-bold text-white active:scale-95"
              style={{ transition: "transform .1s" }}
            >
              🗺️ Ir en Maps
            </a>
          )}
        </div>
      </div>

      {modo === "cercania" && estadoGeo === "no" && (
        <p className="px-0.5 text-[11px] font-medium text-[#AEB6CC]">
          Sin ubicación: se usa el orden por nombre. Probá <b>⚡ Prioridad</b> para cobrar primero a los de riesgo.
        </p>
      )}

      {/* Honestidad sobre el orden por cercanía: si casi nadie tiene ubicación
          guardada, el "camino" que dibuja son 7 clientes de 100 y el resto va al
          fondo por nombre. Antes no se decía en ningún lado. */}
      {modo === "cercania" && gpsPobre && (
        <p className="px-0.5 text-[11px] leading-[1.45] font-medium text-[#B9770E]">
          Solo {nConUbicacion} de {items.length} clientes tienen ubicación guardada — el resto va al
          final por nombre. Se va llenando a medida que los censás.
        </p>
      )}

      {buscando && filtrados.length === 0 && (
        <p className="px-0.5 py-3 text-center text-[12.5px] font-medium text-[#8A93AD]">
          Ningún cliente de tu ruta coincide con “{q}”.
        </p>
      )}

      {/* Lista vacía por la CHIP (no por búsqueda). Antes quedaba en blanco sin
          una palabra: tocar "Cobrado" a las 8 de la mañana parecía que la app se
          había roto o que el cobrador había perdido su ruta. */}
      {!buscando && filtrados.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-0.5 py-5 text-center">
          <p className="text-[12.5px] font-semibold text-[#8A93AD]">
            {filtro === "cobrado"
              ? "Todavía no cobraste a nadie hoy."
              : filtro === "pendiente"
                ? "No te queda nadie pendiente 🎉"
                : filtro === "no_pago"
                  ? "Ningún cliente quedó sin pagar todavía."
                  : "No hay clientes en esta vista."}
          </p>
          {filtro !== "todos" && (
            <button
              type="button"
              onClick={() => setFiltro("todos")}
              className="min-h-11 rounded-full bg-[#EEF3FF] px-4 text-[12.5px] font-bold text-azul"
            >
              Ver todos mis clientes
            </button>
          )}
        </div>
      )}

      {visibles.map((it, idx) => {
        // ── Encabezados de grupo (solo en "Todos" sin búsqueda) ──
        // El orden ya pone primero las paradas por cobrar y al final las
        // resueltas/fuera del día; el separador HACE VISIBLE ese corte. Sin él,
        // el cobrador leía una lista plana y contaba su día a ojo (pedido de
        // Carlos, 08-13: "que aparezcan los que son para cobrar de forma
        // organizada").
        const resuelto = (x: ItemRutaVista) =>
          cerrado(x.estadoHoy) || !!x.sinCuotaHoy || x.estadoHoy === "sin_credito";
        const conGrupos = !buscando && filtro === "todos";
        const encabezado: "pendientes" | "resueltos" | null = !conGrupos
          ? null
          : idx === 0
            ? resuelto(it)
              ? "resueltos"
              : "pendientes"
            : resuelto(it) && !resuelto(visibles[idx - 1])
              ? "resueltos"
              : null;
        // La cartera vencida NO es meta del día (la chip "Pendientes" y el arqueo
        // la excluyen): contar los tres números juntos daba "Para cobrar (13)"
        // arriba de una chip que decía 10 — dos verdades en la misma pantalla.
        const nPend = filtrados.filter((x) => !resuelto(x) && !x.plazoVencido).length;
        const nRecuperar = filtrados.filter((x) => !resuelto(x) && x.plazoVencido).length;
        // "Hoy no toca": el semanal/quincenal al día sin cuota hoy NO está
        // "Cobrado" (mentía a las 7 AM) — chip propio, neutro.
        // ATRASO PURO: no le vence cuota hoy pero debe de días anteriores (el
        // semanal que no pagó el lunes). Hay que pasar igual, pero no es "la cuota
        // de hoy" — si se etiquetara así, al semanal se le pediría cuota los 6 días.
        const soloAtraso =
          !it.plazoVencido && (it.atraso ?? 0) > 0 && it.cuota > 0 && it.atraso === it.cuota;
        const chip = it.sinCuotaHoy
          ? { label: "Hoy no toca", bg: "#EDF4FB", fg: "#4A6FA5", barra: "#B9CFE8" }
          : soloAtraso && it.estadoHoy === "pendiente"
            ? { label: "Atrasado", bg: "#FDF1DC", fg: "#B9770E", barra: "#E8A317" }
            : CHIP[it.estadoHoy];
        // Fallback de inicial: un cliente sin nombre no debe romper toda la
        // lista de la ruta (charAt sobre null/undefined tira). "—" si no hay.
        const inicial = (it.nombre ?? "").trim().charAt(0).toUpperCase() || "—";
        // El nº de paso es el orden de la RUTA; al buscar, `idx` es el índice del
        // filtrado (no el paso real) → se oculta mientras se busca.
        const mostrarPaso = ordenActivo && !cerrado(it.estadoHoy) && !buscando && !it.plazoVencido;
        const esCerrado = cerrado(it.estadoHoy);
        // Abono parcial: cuánto le falta para cubrir la cuota de hoy.
        const restaHoy = it.estadoHoy === "abono" ? Math.max(0, it.cuota - it.pagadoHoy) : 0;
        return (
          <Fragment key={it.id}>
          {encabezado === "pendientes" && (
            <span className="px-1 pt-1 text-[11px] font-bold tracking-[0.05em] text-[#6B7494] uppercase">
              Para cobrar ({nPend})
              {nRecuperar > 0 ? ` · ${nRecuperar} a recuperar` : ""}
            </span>
          )}
          {encabezado === "resueltos" && (
            <span className="px-1 pt-2 text-[11px] font-bold tracking-[0.05em] text-[#8A93AD] uppercase">
              Visitados y sin cuota hoy ({filtrados.length - nPend})
            </span>
          )}
          <div
            className="relative flex items-center gap-2 overflow-hidden rounded-[16px] bg-white py-2.5 pr-2 pl-4 shadow-[0_1px_3px_rgba(26,34,71,0.05)]"
            style={{ opacity: esCerrado ? 0.72 : 1 }}
          >
            {/* Franja de estado a la izquierda: se lee la ruta de un vistazo. */}
            <span
              aria-hidden="true"
              className="absolute top-0 bottom-0 left-0 w-1.5"
              style={{ background: chip.barra }}
            />
            {/* Área principal → detalle del cliente. */}
            <Link
              href={`/cobrador/cliente/${it.id}`}
              className="flex min-w-0 flex-1 items-center gap-3 py-1 active:scale-[0.99]"
              style={{ transition: "transform .1s" }}
            >
              <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] bg-[#2453DC] text-[16px] font-black text-white">
                {inicial}
                {mostrarPaso && (
                  <span className="absolute -top-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#0F1B3D] text-[10px] font-black text-white ring-2 ring-white">
                    {idx + 1}
                  </span>
                )}
                {/* Señal de RIESGO del cliente (la calificación ya reordena en
                    modo Prioridad; acá la hace visible). Solo para riesgo/regular. */}
                {(it.calificacion === "riesgo" || it.calificacion === "regular") && (
                  <span
                    aria-hidden="true"
                    title={it.calificacion === "riesgo" ? "Riesgo" : "Regular"}
                    className="absolute -right-1 -bottom-1 h-3.5 w-3.5 rounded-full ring-2 ring-white"
                    style={{ background: it.calificacion === "riesgo" ? "#D64545" : "#E8A317" }}
                  />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {/* ⚠️ NOMBRE COMPLETO, hasta DOS líneas (pedido de Carlos, 08-13:
                    "los nombres se cortan… debe aparecer nombre y apellido").
                    `truncate` dejaba "MARÍA FERNANDA RODRÍG…" y en la calle dos
                    clientas de la misma cuadra se confundían por el apellido. */}
                <span className="line-clamp-2 text-[15px] leading-[1.22] font-bold break-words text-tinta">
                  {it.nombre}
                </span>
                {it.plazoVencido ? (
                  (it.recuperadoHoy ?? 0) > 0 ? (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-[#157A50]">
                      ✓ Recuperaste {UYU(it.recuperadoHoy!)} hoy
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-[#B9770E]">
                      ⏳ Cartera vencida · a recuperar
                    </span>
                  )
                ) : soloAtraso && it.estadoHoy === "pendiente" ? (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-[#B9770E]">
                    ⏰ Debe de días anteriores · hoy no le vence cuota
                  </span>
                ) : (
                  <span className="truncate text-[12px] font-medium text-[#8A93AD]">
                    {it.direccion ?? "Sin dirección"}
                  </span>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                {it.cuota > 0 && (
                  <span className="text-[14px] font-extrabold text-tinta tabular-nums">
                    {UYU(it.cuota)}
                  </span>
                )}
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
                  style={{ background: chip.bg, color: chip.fg }}
                >
                  {!it.sinCuotaHoy && it.estadoHoy === "abono" ? `Abonó ${UYU(it.pagadoHoy)}` : chip.label}
                </span>
                {restaHoy > 0 && (
                  <span className="text-[10px] font-semibold text-[#B9770E] tabular-nums">
                    falta {UYU(restaHoy)}
                  </span>
                )}
              </div>
            </Link>
            {/* ⚠️ COBRAR DE UN TOQUE, sin abrir la ficha. Solo cuando no hay NADA
                que decidir: un solo crédito propio, cuota que vence hoy, parada sin
                resolver y no es cartera vencida. En cualquier otro caso se entra a
                la ficha, como siempre — la ficha no se reemplaza, se saltea cuando
                no aporta. Es lo que convierte dos horas de tipeo en veinte minutos. */}
            {cobradorId &&
              it.prestamoId &&
              it.creditosPropios === 1 &&
              it.estadoHoy === "pendiente" &&
              !it.sinCuotaHoy &&
              !it.plazoVencido &&
              it.cuota > 0 &&
              // ⚠️ SOLO SI LO QUE SE DEBE HOY ES UNA CUOTA ENTERA.
              // El atajo manda `monto: null` y el servidor cobra la `cuota_diaria`
              // completa. Cuando el cliente ya abonó parte (o es un semanal con un
              // resto), `it.cuota` es el OBJETIVO de hoy —lo que falta para estar al
              // día— y NO coincide: el botón decía "Cobrar $400" y el libro
              // registraba $4.000. Medido: 8 créditos hoy, hasta 10× de diferencia.
              //
              // No se arregla mandando el monto: si el atajo manda un número y la
              // ficha sigue mandando null, el candado anti doble-cobro del servidor
              // (que compara montos) deja de reconocerlos como el mismo cobro y se
              // abre el doble cobro entre los dos caminos. Se esconde el atajo y ese
              // resto se cobra desde la ficha, que ya tiene "Para ponerse al día".
              Math.abs(it.cuota - (it.cuotaCredito ?? it.cuota)) < 1 && (
                <CobroRapido
                  clienteId={it.id}
                  clienteNombre={it.nombre}
                  prestamoId={it.prestamoId}
                  cobradorId={cobradorId}
                  cuota={it.cuota}
                />
              )}
            {/* Ojito: vistazo rápido sin salir de la ruta. */}
            <OjitoCliente clienteId={it.id} nombre={it.nombre} />
          </div>
          </Fragment>
        );
      })}

      {/* Plegado: mostrar/ocultar el resto de la ruta (sin búsqueda activa). */}
      {!buscando && restantes > 0 && (
        <button
          type="button"
          onClick={() => setVerTodos(true)}
          className="mt-1 rounded-[12px] border border-[#DCE3F4] bg-white px-4 py-2.5 text-[13px] font-bold text-azul active:scale-[0.99]"
          style={{ transition: "transform .1s" }}
        >
          Ver los {restantes} clientes restantes ▾
        </button>
      )}
      {!buscando && verTodos && ordenados.length > TOPE_RUTA && (
        <button
          type="button"
          onClick={() => setVerTodos(false)}
          className="mt-1 rounded-[12px] border border-[#DCE3F4] bg-white px-4 py-2.5 text-[13px] font-bold text-gris active:scale-[0.99]"
          style={{ transition: "transform .1s" }}
        >
          Ver menos ▴
        </button>
      )}
    </div>
  );
}
