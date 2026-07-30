"use client";
// Selector de canales VERTICAL, agrupado, con búsqueda y COLAPSO. Reemplaza la
// tira horizontal (inusable con 47+ hilos de cobrador). Grupos: General (equipo/
// supervisores), Zonas y Conversaciones (hilos por cobrador). Cada grupo muestra
// hasta 7 y COLAPSA el resto detrás de "Ver N más". Al buscar, muestra todos los
// que matchean. En escritorio es la columna izquierda de un layout de dos paneles;
// en mobile va arriba (visible, sin esconderse tras un tap → antes se sentía roto).
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

// Cuántos canales muestra cada grupo antes de colapsar el resto.
const TOPE = 7;

// Normaliza para buscar sin distinguir mayúsculas ni acentos (quita las marcas
// diacríticas combinantes U+0300–U+036F por code-point → fuente ASCII).
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
  const [expandido, setExpandido] = useState<Record<string, boolean>>({});
  const activo = canales.find((c) => c.key === canalActivo) ?? canales[0];
  const buscando = q.trim().length > 0;

  const filtro = buscando ? canales.filter((c) => norm(c.titulo).includes(norm(q))) : canales;
  const grupos = GRUPOS.map((g) => ({
    ...g,
    items: filtro.filter((c) => g.ambitos.includes(c.ambito)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-2 md:sticky md:top-4">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar canal o persona…"
        className="rounded-[12px] border border-borde bg-tarjeta px-3 py-2 text-[16px] outline-none focus:border-azul"
      />
      <div className="flex flex-col gap-3">
        {grupos.length === 0 && (
          <p className="px-1 text-[12px] font-medium text-gris">Sin resultados para “{q}”.</p>
        )}
        {grupos.map((g) => {
          // Al buscar, se muestran todos los que matchean; si no, tope de 7.
          const abierto = buscando || expandido[g.titulo];
          const visibles = abierto ? g.items : g.items.slice(0, TOPE);
          const resto = g.items.length - visibles.length;
          return (
            <div key={g.titulo} className="flex flex-col gap-1">
              <span className="px-1 text-[10.5px] font-bold tracking-wide text-gris uppercase">
                {g.titulo}
                {g.items.length > TOPE && <span className="text-tenue"> · {g.items.length}</span>}
              </span>
              <div className="flex flex-col gap-0.5">
                {visibles.map((c) => {
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
              {/* Colapso: el resto del grupo detrás de "Ver N más". */}
              {!buscando && g.items.length > TOPE && (
                <button
                  type="button"
                  onClick={() => setExpandido((e) => ({ ...e, [g.titulo]: !e[g.titulo] }))}
                  className="self-start rounded-full px-2.5 py-1 text-[11.5px] font-bold text-azul hover:bg-[#EEF3FF]"
                >
                  {expandido[g.titulo] ? "Ver menos" : `Ver ${resto} más`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
