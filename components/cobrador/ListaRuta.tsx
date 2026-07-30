"use client";
// Lista de la ruta del cobrador con ORDEN por cercanía (opcional). Pide la
// ubicación del cobrador y, si la concede, reordena las paradas pendientes como
// un recorrido corto (vecino más cercano, lib/ruta.ts). Los ya cobrados / no-
// pago bajan al final. Progressive enhancement: sin permiso o sin JS, queda el
// orden original del servidor (por nombre).
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ordenarPorCercania } from "@/lib/ruta";
import type { EstadoHoy } from "@/lib/data/ruta";
import { UYU } from "@/lib/format";
import { OjitoCliente } from "./OjitoCliente";

export interface ItemRutaVista {
  id: string;
  nombre: string;
  direccion: string | null;
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

export function ListaRuta({ items }: { items: ItemRutaVista[] }) {
  const [origen, setOrigen] = useState<Origen>(null);
  const [modo, setModo] = useState<"cercania" | "prioridad" | "nombre">("cercania");
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
      pendiente: items.filter((i) => i.estadoHoy === "pendiente" && !i.plazoVencido).length,
      cobrado: items.filter((i) => (i.estadoHoy === "pagado" || i.estadoHoy === "abono") && !i.plazoVencido).length,
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

  // Intento silencioso al montar (si el permiso ya estaba concedido, resuelve
  // sin prompt; si no, el usuario puede tocar el botón).
  useEffect(() => {
    pedirUbicacion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ordenados = useMemo(() => {
    const pendientes = items.filter((i) => !cerrado(i.estadoHoy));
    const cerrados = items.filter((i) => cerrado(i.estadoHoy));
    let base = pendientes;
    if (modo === "cercania" && origen) base = ordenarPorCercania(pendientes, origen);
    else if (modo === "prioridad")
      base = [...pendientes].sort((a, b) => pesoPrio(a.calificacion) - pesoPrio(b.calificacion));
    // "nombre" (o cercanía sin ubicación) → orden del servidor (por nombre).
    return [...base, ...cerrados];
  }, [items, modo, origen]);
  // ¿Hay un orden de recorrido significativo (para numerar pasos + camino en Maps)?
  const ordenActivo = (modo === "cercania" && !!origen) || modo === "prioridad";

  // Filtro por estado (chips): recorta la ruta a la categoría elegida.
  const porEstado =
    filtro === "todos"
      ? ordenados
      : filtro === "cobrado"
        ? ordenados.filter((i) => (i.estadoHoy === "pagado" || i.estadoHoy === "abono") && !i.plazoVencido)
        : ordenados.filter((i) => i.estadoHoy === filtro && !i.plazoVencido);

  // Búsqueda por nombre: si hay término, filtra y muestra TODOS los que matchean.
  const buscando = q.trim().length > 0;
  const filtrados = buscando
    ? porEstado.filter((i) => norm(i.nombre ?? "").includes(norm(q)))
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
        placeholder="🔍 Buscar cliente por nombre…"
        className="rounded-[12px] border border-[#DCE3F4] bg-white px-3.5 py-2.5 text-[16px] outline-none focus:border-azul"
      />

      {/* Orden de la ruta (cercanía / prioridad de cobro / A-Z) + camino en Maps */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
        <div className="flex gap-0.5 rounded-full bg-[#EEF1F8] p-0.5">
          {(
            [
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
                  setModo(id);
                }}
                className={`rounded-full px-3 py-2 text-[12px] font-bold transition-colors ${
                  activo ? "bg-white text-azul shadow-[0_1px_2px_rgba(26,34,71,0.12)]" : "text-gris"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
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

      {modo === "cercania" && estadoGeo === "no" && (
        <p className="px-0.5 text-[11px] font-medium text-[#AEB6CC]">
          Sin ubicación: se usa el orden por nombre. Probá <b>⚡ Prioridad</b> para cobrar primero a los de riesgo.
        </p>
      )}

      {buscando && filtrados.length === 0 && (
        <p className="px-0.5 py-3 text-center text-[12.5px] font-medium text-[#8A93AD]">
          Ningún cliente coincide con “{q}”.
        </p>
      )}

      {visibles.map((it, idx) => {
        const chip = CHIP[it.estadoHoy];
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
          <div
            key={it.id}
            className="relative flex items-center gap-2 overflow-hidden rounded-[16px] bg-white py-2 pr-2 pl-4 shadow-[0_1px_3px_rgba(26,34,71,0.05)]"
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
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14.5px] font-bold text-tinta">
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
                  {it.estadoHoy === "abono" ? `Abonó ${UYU(it.pagadoHoy)}` : chip.label}
                </span>
                {restaHoy > 0 && (
                  <span className="text-[10px] font-semibold text-[#B9770E] tabular-nums">
                    falta {UYU(restaHoy)}
                  </span>
                )}
              </div>
            </Link>
            {/* Ojito: vistazo rápido sin salir de la ruta. */}
            <OjitoCliente clienteId={it.id} nombre={it.nombre} />
          </div>
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
