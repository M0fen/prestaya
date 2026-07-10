"use client";
// Selector de canales VERTICAL, agrupado y con búsqueda. Reemplaza la tira
// horizontal (inusable con 47+ hilos de cobrador). Grupos: General (equipo/
// supervisores), Zonas y Conversaciones (hilos por cobrador). En escritorio es
// la columna izquierda de un layout de dos paneles; en mobile es un desplegable
// compacto que se cierra solo al elegir (la navegación resetea el estado).
import { useState } from "react";
import Link from "next/link";
import type { Canal } from "@/lib/data/chat";
import type { AmbitoMensaje } from "@/types/db";

const ICONO: Record<AmbitoMensaje, string> = {
  general: "👥",
  supervisores: "🎖️",
  zona: "🗺️",
  cobrador: "💬",
};

const GRUPOS: { titulo: string; ambitos: AmbitoMensaje[] }[] = [
  { titulo: "General", ambitos: ["general", "supervisores"] },
  { titulo: "Zonas", ambitos: ["zona"] },
  { titulo: "Conversaciones", ambitos: ["cobrador"] },
];

// Normaliza para buscar sin distinguir mayúsculas ni acentos (quita las marcas
// diacríticas combinantes U+0300–U+036F por code-point → fuente ASCII, sin líos
// de codificación del archivo).
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c < 0x300 || c > 0x36f;
    })
    .join("");

export function SelectorCanales({
  canales,
  canalActivo,
  basePath,
}: {
  canales: Canal[];
  canalActivo: string;
  basePath: string;
}) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const activo = canales.find((c) => c.key === canalActivo) ?? canales[0];
  const totalNoLeidos = canales.reduce((s, c) => s + c.noLeidos, 0);

  const filtro = q.trim() ? canales.filter((c) => norm(c.titulo).includes(norm(q))) : canales;
  const grupos = GRUPOS.map((g) => ({
    ...g,
    items: filtro.filter((c) => g.ambitos.includes(c.ambito)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-2 md:sticky md:top-4">
      {/* Mobile: barra que muestra el canal activo y abre la lista. */}
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-2 rounded-[14px] border border-borde bg-tarjeta px-3.5 py-2.5 md:hidden"
      >
        <span className="text-[15px]">{activo ? ICONO[activo.ambito] : "💬"}</span>
        <span className="flex-1 truncate text-left text-[13.5px] font-bold text-tinta">
          {activo?.titulo ?? "Chat"}
        </span>
        {!abierto && totalNoLeidos > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E06A6A] px-1.5 text-[10px] font-black text-white">
            {totalNoLeidos > 9 ? "9+" : totalNoLeidos}
          </span>
        )}
        <span className={`text-[11px] text-gris transition-transform ${abierto ? "rotate-90" : ""}`}>▶</span>
      </button>

      {/* Panel: oculto en mobile hasta abrir; siempre visible en escritorio. */}
      <div className={`${abierto ? "flex" : "hidden"} flex-col gap-2 md:flex`}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar canal o persona…"
          className="rounded-[12px] border border-borde bg-tarjeta px-3 py-2 text-[13px] outline-none focus:border-azul"
        />
        <div className="flex flex-col gap-3">
          {grupos.length === 0 && (
            <p className="px-1 text-[12px] font-medium text-gris">Sin resultados para “{q}”.</p>
          )}
          {grupos.map((g) => (
            <div key={g.titulo} className="flex flex-col gap-1">
              <span className="px-1 text-[10.5px] font-bold tracking-wide text-gris uppercase">
                {g.titulo} {g.items.length > 3 && <span className="text-tenue">· {g.items.length}</span>}
              </span>
              {/* La lista de conversaciones puede ser larga (47 cobradores) → scroll propio. */}
              <div className={`flex flex-col gap-0.5 ${g.ambitos.includes("cobrador") ? "max-h-[42vh] overflow-y-auto pr-0.5 md:max-h-[46vh]" : ""}`}>
                {g.items.map((c) => {
                  const sel = c.key === activo?.key;
                  return (
                    <Link
                      key={c.key}
                      href={`${basePath}?c=${encodeURIComponent(c.key)}`}
                      scroll={false}
                      className={`flex items-center gap-2 rounded-[11px] px-2.5 py-2 text-[13px] font-semibold transition-colors ${
                        sel ? "bg-[#2453DC] text-white" : "text-cuerpo hover:bg-[#EEF3FF]"
                      }`}
                    >
                      <span className="text-[14px]">{ICONO[c.ambito]}</span>
                      <span className="flex-1 truncate">{c.titulo}</span>
                      {c.noLeidos > 0 && (
                        <span
                          className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-black ${
                            sel ? "bg-white text-[#2453DC]" : "bg-[#E06A6A] text-white"
                          }`}
                        >
                          {c.noLeidos > 9 ? "9+" : c.noLeidos}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
