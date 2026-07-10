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
}

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
  const [porCercania, setPorCercania] = useState(false);
  const [estadoGeo, setEstadoGeo] = useState<"idle" | "pidiendo" | "ok" | "no">("idle");
  const [verTodos, setVerTodos] = useState(false);
  const [q, setQ] = useState("");

  const pedirUbicacion = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setEstadoGeo("no");
      return;
    }
    setEstadoGeo("pidiendo");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setOrigen({ lat: p.coords.latitude, lng: p.coords.longitude });
        setPorCercania(true);
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
    const base =
      porCercania && origen ? ordenarPorCercania(pendientes, origen) : pendientes;
    return [...base, ...cerrados];
  }, [items, porCercania, origen]);

  // Búsqueda por nombre: si hay término, filtra y muestra TODOS los que matchean.
  const buscando = q.trim().length > 0;
  const filtrados = buscando
    ? ordenados.filter((i) => norm(i.nombre ?? "").includes(norm(q)))
    : ordenados;
  // Plegado: sin búsqueda, solo las primeras TOPE_RUTA paradas (las más
  // relevantes, ya ordenadas). El resto queda detrás de "Ver los N restantes".
  const visibles = verTodos || buscando ? filtrados : filtrados.slice(0, TOPE_RUTA);
  const restantes = filtrados.length - visibles.length;

  return (
    <div className="flex flex-col gap-2">
      {/* Buscar cliente por nombre */}
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="🔍 Buscar cliente por nombre…"
        className="rounded-[12px] border border-[#DCE3F4] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-azul"
      />

      {/* Barra de orden */}
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[12px] font-semibold text-[#8A93AD]">
          {porCercania && origen
            ? "Ordenado por cercanía"
            : "Orden por nombre"}
        </span>
        {origen ? (
          <button
            type="button"
            onClick={() => setPorCercania((v) => !v)}
            className="rounded-full bg-[#EEF3FF] px-3 py-1.5 text-[12px] font-bold text-azul active:scale-95"
            style={{ transition: "transform .1s" }}
          >
            {porCercania ? "Ver orden original" : "Ordenar por cercanía"}
          </button>
        ) : (
          <button
            type="button"
            onClick={pedirUbicacion}
            disabled={estadoGeo === "pidiendo"}
            className="rounded-full bg-[#EEF3FF] px-3 py-1.5 text-[12px] font-bold text-azul active:scale-95 disabled:opacity-50"
            style={{ transition: "transform .1s" }}
          >
            {estadoGeo === "pidiendo" ? "Ubicando…" : "📍 Ordenar por cercanía"}
          </button>
        )}
      </div>

      {estadoGeo === "no" && (
        <p className="px-0.5 text-[11px] font-medium text-[#AEB6CC]">
          Sin ubicación disponible: se mantiene el orden por nombre.
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
        const mostrarPaso = porCercania && origen && !cerrado(it.estadoHoy);
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
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14.5px] font-bold text-tinta">
                  {it.nombre}
                </span>
                <span className="truncate text-[12px] font-medium text-[#8A93AD]">
                  {it.direccion ?? "Sin dirección"}
                </span>
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
