"use client";
// Envoltorio del mapa de cobranza con toggle: "Vista rápida" (SVG liviano, sin
// red, siempre disponible) vs "Mapa de calles" (Leaflet, navegable, carga lazy).
import { useState } from "react";
import dynamic from "next/dynamic";
import { MapaCobros } from "./MapaCobros";
import type { PuntoCobro } from "@/lib/data/control";

// Lazy: Leaflet + tiles solo se descargan cuando el gestor abre el mapa de calles.
const MapaCallesLeaflet = dynamic(() => import("./MapaCallesLeaflet"), {
  ssr: false,
  loading: () => (
    <div className="flex aspect-[5/4] w-full items-center justify-center rounded-[14px] bg-[#EAF1FB] text-[12px] font-medium text-gris">
      Cargando mapa de calles…
    </div>
  ),
});

export function MapaCobranza({ puntos }: { puntos: PuntoCobro[] }) {
  const [modo, setModo] = useState<"rapida" | "calles">("rapida");
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-1 self-start rounded-full bg-[#F0F3FA] p-0.5">
        {(["rapida", "calles"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModo(m)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors ${
              modo === m
                ? "bg-white text-azul shadow-[0_1px_2px_rgba(26,34,71,0.1)]"
                : "text-gris hover:text-tinta"
            }`}
          >
            {m === "rapida" ? "Vista rápida" : "Mapa de calles"}
          </button>
        ))}
      </div>
      {modo === "rapida" ? <MapaCobros puntos={puntos} /> : <MapaCallesLeaflet puntos={puntos} />}
    </div>
  );
}
