"use client";
// "Qué hay de nuevo" — una vez por VERSIÓN, por rol (lib/novedades.ts). Es el
// mecanismo que faltaba para que lo que deployamos se ENCUENTRE: cada línea
// lleva a la pantalla. Se cierra y no vuelve hasta la próxima versión.
import { useEffect, useState } from "react";
import Link from "next/link";
import { NOVEDADES, NOVEDADES_VERSION, type Novedad } from "@/lib/novedades";
import type { Rol } from "@/types/db";

export function NovedadesCard({ rol }: { rol: Rol }) {
  const items: Novedad[] = NOVEDADES[rol] ?? [];
  const clave = `py_novedades_${NOVEDADES_VERSION}_${rol}`;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      if (items.length > 0 && !window.localStorage.getItem(clave)) setVisible(true);
    } catch { /* sin storage: no molestamos */ }
  }, [clave, items.length]);
  if (!visible) return null;
  const cerrar = () => {
    try { window.localStorage.setItem(clave, "1"); } catch { /* sin storage */ }
    setVisible(false);
  };
  return (
    <section className="relative flex flex-col gap-2.5 rounded-[18px] border-2 border-[#6B8FF7] bg-[#EEF3FF] p-4">
      <button type="button" onClick={cerrar} aria-label="Cerrar novedades"
        className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/70 text-[13px] font-bold text-[#13308C]">
        ✕
      </button>
      <span className="text-[12px] font-extrabold tracking-[0.04em] text-[#1E47C8] uppercase">✨ Nuevo en la app</span>
      <ul className="flex flex-col gap-2 pr-6">
        {items.map((n, i) => (
          <li key={i}>
            <Link href={n.href} onClick={cerrar}
              className="flex items-start gap-2 rounded-[12px] bg-white/80 px-3 py-2.5 text-[13px] leading-[1.45] font-semibold text-[#13308C] active:scale-[0.99]">
              <span className="mt-0.5 flex-shrink-0 text-[#1E47C8]">→</span>
              <span>{n.texto}</span>
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" onClick={cerrar} className="self-end text-[12px] font-bold text-[#1E47C8]">Entendido</button>
    </section>
  );
}
