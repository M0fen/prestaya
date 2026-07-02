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

export interface ItemRutaVista {
  id: string;
  nombre: string;
  direccion: string | null;
  cuota: number;
  estadoHoy: EstadoHoy;
  lat: number | null;
  lng: number | null;
}

const CHIP: Record<EstadoHoy, { label: string; bg: string; fg: string }> = {
  pagado: { label: "Cobrado", bg: "#E4F5EC", fg: "#157A50" },
  no_pago: { label: "No pago", bg: "#FBE4E2", fg: "#C0392B" },
  pendiente: { label: "Pendiente", bg: "#EEF1F8", fg: "#6B7494" },
  sin_credito: { label: "Sin crédito", bg: "#F2F0FA", fg: "#7A6BA8" },
};

/** Una parada "cerrada" (ya cobrada o marcada no-pago) baja al final. */
const cerrado = (e: EstadoHoy): boolean => e === "pagado" || e === "no_pago";

type Origen = { lat: number; lng: number } | null;

export function ListaRuta({ items }: { items: ItemRutaVista[] }) {
  const [origen, setOrigen] = useState<Origen>(null);
  const [porCercania, setPorCercania] = useState(false);
  const [estadoGeo, setEstadoGeo] = useState<"idle" | "pidiendo" | "ok" | "no">("idle");

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

  return (
    <div className="flex flex-col gap-2">
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

      {ordenados.map((it, idx) => {
        const chip = CHIP[it.estadoHoy];
        const inicial = it.nombre.charAt(0).toUpperCase();
        const mostrarPaso = porCercania && origen && !cerrado(it.estadoHoy);
        return (
          <Link
            key={it.id}
            href={`/cobrador/cliente/${it.id}`}
            className="flex items-center gap-3 rounded-[16px] bg-white px-3.5 py-3 shadow-[0_1px_3px_rgba(26,34,71,0.05)] active:scale-[0.99]"
            style={{ transition: "transform .1s", opacity: cerrado(it.estadoHoy) ? 0.6 : 1 }}
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
                className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: chip.bg, color: chip.fg }}
              >
                {chip.label}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
